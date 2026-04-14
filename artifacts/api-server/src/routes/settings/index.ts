import { Router, type IRouter } from "express";
import { db, integrationConfigsTable, agentsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const router: IRouter = Router();

// ==================== Integration Configs ====================

// GET /settings/integrations — list all integrations
router.get("/settings/integrations", async (req, res): Promise<void> => {
  try {
    const configs = await db.select().from(integrationConfigsTable);
    // Mask sensitive fields in response
    const masked = configs.map(c => ({
      ...c,
      config: maskSensitiveFields(c.provider, c.config as Record<string, any>),
    }));
    res.json({ integrations: masked });
  } catch (err: any) {
    res.status(500).json({ error: "Failed to fetch integrations" });
  }
});

// GET /settings/integrations/:provider — get single integration config
router.get("/settings/integrations/:provider", async (req, res): Promise<void> => {
  const { provider } = req.params;
  try {
    const [config] = await db.select().from(integrationConfigsTable)
      .where(eq(integrationConfigsTable.provider, provider));
    if (!config) {
      res.json({ integration: { provider, config: {}, enabled: false, exists: false } });
      return;
    }
    res.json({
      integration: {
        ...config,
        config: maskSensitiveFields(config.provider, config.config as Record<string, any>),
        exists: true,
      },
    });
  } catch (err: any) {
    res.status(500).json({ error: "Failed to fetch integration config" });
  }
});

// POST /settings/integrations/:provider — create or update integration config
router.post("/settings/integrations/:provider", async (req, res): Promise<void> => {
  const { provider } = req.params;
  const { config, enabled } = req.body;

  const validProviders = ["aircall", "pipedrive", "fireflies", "google_calendar"];
  if (!validProviders.includes(provider)) {
    res.status(400).json({ error: `Invalid provider. Must be one of: ${validProviders.join(", ")}` });
    return;
  }

  try {
    const [existing] = await db.select().from(integrationConfigsTable)
      .where(eq(integrationConfigsTable.provider, provider));

    let row;
    if (existing) {
      // Merge config — don't overwrite fields not provided
      const mergedConfig = { ...(existing.config as Record<string, any>), ...config };
      const updates: any = { config: mergedConfig };
      if (enabled !== undefined) updates.enabled = enabled;

      const [updated] = await db.update(integrationConfigsTable)
        .set(updates)
        .where(eq(integrationConfigsTable.id, existing.id))
        .returning();
      row = updated;
    } else {
      const [created] = await db.insert(integrationConfigsTable)
        .values({ provider, config: config || {}, enabled: enabled ?? false })
        .returning();
      row = created;
    }

    res.json({
      integration: {
        ...row,
        config: maskSensitiveFields(row.provider, row.config as Record<string, any>),
      },
    });
  } catch (err: any) {
    res.status(500).json({ error: "Failed to save integration config" });
  }
});

// POST /settings/integrations/aircall/test-connection — validate Aircall credentials
router.post("/settings/integrations/aircall/test-connection", async (req, res): Promise<void> => {
  try {
    const [config] = await db.select().from(integrationConfigsTable)
      .where(eq(integrationConfigsTable.provider, "aircall"));

    if (!config) {
      res.status(400).json({ error: "Aircall integration not configured" });
      return;
    }

    const aircallConfig = config.config as Record<string, any>;
    const apiId = aircallConfig.api_id;
    const apiToken = aircallConfig.api_token;

    if (!apiId || !apiToken) {
      res.status(400).json({ error: "Aircall API ID and Token are required" });
      return;
    }

    const authHeader = Buffer.from(`${apiId}:${apiToken}`).toString("base64");
    const response = await fetch("https://api.aircall.io/v1/company", {
      headers: { Authorization: `Basic ${authHeader}` },
    });

    if (response.ok) {
      const data = await response.json() as any;
      res.json({
        success: true,
        company: data.company?.name || "Connected",
      });
    } else {
      const body = await response.text().catch(() => "");
      res.json({
        success: false,
        error: `Aircall returned ${response.status}: ${response.statusText}`,
        aircall_status: response.status,
        aircall_body: body.slice(0, 400),
        api_id_prefix: apiId ? apiId.slice(0, 8) + "…" : null,
        hint: response.status === 401 ? "Credentials rejected — regenerate the API key in Aircall dashboard and re-save here"
            : response.status === 403 ? "Forbidden — key lacks required scope or plan feature not enabled"
            : response.status === 429 ? "Rate limited — wait a minute and try again"
            : response.status >= 500 ? "Aircall service error — retry later"
            : "Check credentials",
      });
    }
  } catch (err: any) {
    res.json({ success: false, error: err.message });
  }
});

// GET /settings/integrations/aircall/users — fetch Aircall users for agent mapping
router.get("/settings/integrations/aircall/users", async (req, res): Promise<void> => {
  try {
    const [config] = await db.select().from(integrationConfigsTable)
      .where(eq(integrationConfigsTable.provider, "aircall"));

    if (!config) {
      res.status(400).json({ error: "Aircall integration not configured" });
      return;
    }

    const aircallConfig = config.config as Record<string, any>;
    const apiId = aircallConfig.api_id;
    const apiToken = aircallConfig.api_token;

    if (!apiId || !apiToken) {
      res.status(400).json({ error: "Aircall API ID and Token are required" });
      return;
    }

    const authHeader = Buffer.from(`${apiId}:${apiToken}`).toString("base64");
    const response = await fetch("https://api.aircall.io/v1/users", {
      headers: { Authorization: `Basic ${authHeader}` },
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      // Surface the exact Aircall error so we can diagnose (401 vs 403 vs 429 vs 5xx)
      res.status(502).json({
        error: `Aircall returned ${response.status}`,
        aircall_status: response.status,
        aircall_body: body.slice(0, 400),
        api_id_prefix: apiId ? apiId.slice(0, 8) + "…" : null,
        hint: response.status === 401 ? "Credentials rejected — check api_id/api_token or regenerate in Aircall dashboard"
            : response.status === 403 ? "Forbidden — key lacks required scope or plan feature not enabled"
            : response.status === 429 ? "Rate limited — try again shortly"
            : response.status >= 500 ? "Aircall service error — retry later"
            : "Unexpected error",
      });
      return;
    }

    const data = await response.json() as any;
    const users = (data.users || []).map((u: any) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      available: u.availability_status === "available",
    }));

    res.json({ users });
  } catch (err: any) {
    res.status(500).json({ error: "Failed to fetch Aircall users" });
  }
});

// ==================== Agents ====================

// GET /settings/agents — list all agents
router.get("/settings/agents", async (req, res): Promise<void> => {
  try {
    const agents = await db.select().from(agentsTable);
    res.json({ agents });
  } catch (err: any) {
    res.status(500).json({ error: "Failed to fetch agents" });
  }
});

// POST /settings/agents — create agent
router.post("/settings/agents", async (req, res): Promise<void> => {
  const { name, email, aircall_user_id } = req.body;

  if (!name || typeof name !== "string" || name.trim().length === 0) {
    res.status(400).json({ error: "name is required" });
    return;
  }

  try {
    const [created] = await db.insert(agentsTable)
      .values({
        name: name.trim(),
        email: email?.trim() || null,
        aircall_user_id: aircall_user_id || null,
      })
      .returning();

    res.json({ agent: created });
  } catch (err: any) {
    if (err.message?.includes("unique")) {
      res.status(409).json({ error: "An agent with this Aircall user ID already exists" });
      return;
    }
    res.status(500).json({ error: "Failed to create agent" });
  }
});

// PATCH /settings/agents/:id — update agent
router.patch("/settings/agents/:id", async (req, res): Promise<void> => {
  const { id } = req.params;
  const { name, email, aircall_user_id, active } = req.body;

  try {
    const updates: any = {};
    if (name !== undefined) updates.name = name.trim();
    if (email !== undefined) updates.email = email?.trim() || null;
    if (aircall_user_id !== undefined) updates.aircall_user_id = aircall_user_id;
    if (active !== undefined) updates.active = active;

    if (Object.keys(updates).length === 0) {
      res.status(400).json({ error: "No fields to update" });
      return;
    }

    const [updated] = await db.update(agentsTable)
      .set(updates)
      .where(eq(agentsTable.id, id))
      .returning();

    if (!updated) {
      res.status(404).json({ error: "Agent not found" });
      return;
    }

    res.json({ agent: updated });
  } catch (err: any) {
    if (err.message?.includes("unique")) {
      res.status(409).json({ error: "An agent with this Aircall user ID already exists" });
      return;
    }
    res.status(500).json({ error: "Failed to update agent" });
  }
});

// DELETE /settings/agents/:id — remove agent
router.delete("/settings/agents/:id", async (req, res): Promise<void> => {
  const { id } = req.params;
  try {
    const [deleted] = await db.delete(agentsTable)
      .where(eq(agentsTable.id, id))
      .returning();

    if (!deleted) {
      res.status(404).json({ error: "Agent not found" });
      return;
    }

    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: "Failed to delete agent" });
  }
});

// ==================== Helpers ====================

function maskSensitiveFields(provider: string, config: Record<string, any>): Record<string, any> {
  const masked = { ...config };
  const sensitiveKeys = ["api_token", "api_key", "webhook_token", "webhook_secret",
    "client_secret", "access_token", "refresh_token", "transcription_api_key"];

  for (const key of sensitiveKeys) {
    if (masked[key] && typeof masked[key] === "string" && masked[key].length > 4) {
      masked[key] = "****" + masked[key].slice(-4);
    }
  }
  return masked;
}

export default router;
