import { Router, type IRouter } from "express";
import { db, agentsTable, usersTable, integrationConfigsTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { requireAdmin } from "../../middlewares/requireAdmin";
import { logger } from "../../lib/logger";

const router: IRouter = Router();

// All admin routes require an authenticated user with role=admin.
router.use(requireAdmin);

// ==================== Agents ====================

// GET /api/admin/agents — list all agents with linked user info (if any)
router.get("/admin/agents", async (_req, res) => {
  try {
    const rows = await db
      .select({
        id: agentsTable.id,
        name: agentsTable.name,
        email: agentsTable.email,
        aircall_user_id: agentsTable.aircall_user_id,
        active: agentsTable.active,
        user_id: agentsTable.user_id,
        created_at: agentsTable.created_at,
        updated_at: agentsTable.updated_at,
        user_email: usersTable.email,
        user_role: usersTable.role,
        user_last_login_at: usersTable.last_login_at,
      })
      .from(agentsTable)
      .leftJoin(usersTable, eq(usersTable.id, agentsTable.user_id))
      .orderBy(desc(agentsTable.created_at));

    res.json({ agents: rows });
  } catch (err: any) {
    logger.error({ err: err.message }, "admin/agents list failed");
    res.status(500).json({ error: "list_failed" });
  }
});

// POST /api/admin/agents — create a new agent.
// Body: { name, email, aircall_user_id?, active? }
router.post("/admin/agents", async (req, res) => {
  const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
  const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
  const aircallRaw = req.body?.aircall_user_id;
  const aircall_user_id =
    aircallRaw == null || aircallRaw === ""
      ? null
      : Number(aircallRaw);
  const active = req.body?.active !== false;

  if (!name) {
    res.status(400).json({ error: "name_required" });
    return;
  }
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    res.status(400).json({ error: "valid_email_required" });
    return;
  }
  if (aircall_user_id !== null && (!Number.isFinite(aircall_user_id) || aircall_user_id <= 0)) {
    res.status(400).json({ error: "aircall_user_id_invalid" });
    return;
  }

  try {
    // Refuse to create a duplicate email — agent.email must be unique for SSO
    // to pick the right row at login.
    const [existing] = await db.select().from(agentsTable).where(eq(agentsTable.email, email));
    if (existing) {
      res.status(409).json({ error: "email_already_exists", existing_id: existing.id });
      return;
    }

    const [created] = await db
      .insert(agentsTable)
      .values({ name, email, aircall_user_id: aircall_user_id ?? undefined, active })
      .returning();

    logger.info({ id: created.id, email }, "admin created agent");
    res.json({ agent: created });
  } catch (err: any) {
    logger.error({ err: err.message }, "admin create agent failed");
    res.status(500).json({ error: "create_failed" });
  }
});

// PATCH /api/admin/agents/:id — update name / aircall_user_id / active.
// Email is intentionally NOT updatable — changing it would orphan the Google
// SSO binding. Delete + recreate if email needs to change.
router.patch("/admin/agents/:id", async (req, res) => {
  const { id } = req.params;

  const updates: Partial<{
    name: string;
    aircall_user_id: number | null;
    active: boolean;
  }> = {};

  if (typeof req.body?.name === "string") {
    const n = req.body.name.trim();
    if (!n) {
      res.status(400).json({ error: "name_required" });
      return;
    }
    updates.name = n;
  }
  if ("aircall_user_id" in (req.body || {})) {
    const raw = req.body.aircall_user_id;
    if (raw == null || raw === "") {
      updates.aircall_user_id = null;
    } else {
      const n = Number(raw);
      if (!Number.isFinite(n) || n <= 0) {
        res.status(400).json({ error: "aircall_user_id_invalid" });
        return;
      }
      updates.aircall_user_id = n;
    }
  }
  if (typeof req.body?.active === "boolean") {
    updates.active = req.body.active;
  }

  if (Object.keys(updates).length === 0) {
    res.status(400).json({ error: "nothing_to_update" });
    return;
  }

  try {
    const [updated] = await db
      .update(agentsTable)
      .set(updates as any)
      .where(eq(agentsTable.id, id))
      .returning();
    if (!updated) {
      res.status(404).json({ error: "agent_not_found" });
      return;
    }
    logger.info({ id, updates }, "admin updated agent");
    res.json({ agent: updated });
  } catch (err: any) {
    logger.error({ err: err.message }, "admin update agent failed");
    res.status(500).json({ error: "update_failed" });
  }
});

// ==================== Aircall users picker ====================

// GET /api/admin/aircall/users — proxy to Aircall to fetch their user list
// so the admin UI can offer a dropdown instead of free-text numeric IDs.
router.get("/admin/aircall/users", async (_req, res) => {
  try {
    const [config] = await db
      .select()
      .from(integrationConfigsTable)
      .where(eq(integrationConfigsTable.provider, "aircall"));
    if (!config) {
      res.status(400).json({ error: "aircall_not_configured" });
      return;
    }
    const aircallConfig = config.config as Record<string, any>;
    const apiId = aircallConfig.api_id;
    const apiToken = aircallConfig.api_token;
    if (!apiId || !apiToken) {
      res.status(400).json({ error: "aircall_credentials_missing" });
      return;
    }

    const authHeader = Buffer.from(`${apiId}:${apiToken}`).toString("base64");
    const response = await fetch("https://api.aircall.io/v1/users", {
      headers: { Authorization: `Basic ${authHeader}` },
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      res.status(502).json({
        error: `aircall_returned_${response.status}`,
        aircall_status: response.status,
        aircall_body: body.slice(0, 400),
      });
      return;
    }

    const data = (await response.json()) as { users?: any[] };
    const users = (data.users || []).map((u) => ({
      id: u.id,
      email: u.email,
      name: [u.first_name, u.last_name].filter(Boolean).join(" ") || u.email,
      available: u.available,
    }));
    res.json({ users });
  } catch (err: any) {
    logger.error({ err: err.message }, "admin aircall users fetch failed");
    res.status(500).json({ error: "aircall_fetch_failed" });
  }
});

export default router;
