import { Router, type IRouter } from "express";
import { db, leadIntelligenceTable, changelogTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { randomUUID } from "crypto";
import { generateIntelligence } from "../../lib/intelligenceService";

const ALLOWED_FIELDS = [
  "qualification_status", "higher_rate_taxpayer", "capital_available",
  "self_directed", "open_to_early_stage_risk", "qualification_notes",
  "cluster", "ifa_involved", "already_done_eis", "estate_above_2m",
  "assets_abroad", "vct_aim_experience", "hot_button", "hot_button_confirmed",
  "hot_button_quote", "spin_situation", "spin_problem", "spin_implication",
  "spin_need_payoff", "readiness_status", "primary_blocker", "blocker_type",
  "recommended_action", "profile_summary",
];

const router: IRouter = Router();

router.post("/leads/:leadId/intelligence/generate", async (req, res): Promise<void> => {
  const { leadId } = req.params;

  try {
    const { intelligence } = await generateIntelligence(leadId);
    res.json({ intelligence });
  } catch (err: any) {
    const message = err.message || "Failed to generate intelligence";
    const status = message.includes("not found") ? 404 : message.includes("no notes") ? 400 : 500;
    res.status(status).json({ error: message });
  }
});

router.get("/leads/:leadId/intelligence", async (req, res): Promise<void> => {
  const { leadId } = req.params;

  try {
    const [row] = await db
      .select()
      .from(leadIntelligenceTable)
      .where(eq(leadIntelligenceTable.lead_id, leadId));

    res.json({ intelligence: row || null });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch intelligence" });
  }
});

router.patch("/leads/:leadId/intelligence", async (req, res): Promise<void> => {
  const { leadId } = req.params;

  try {
    const updates: any = {};
    for (const key of ALLOWED_FIELDS) {
      if (req.body[key] !== undefined) {
        updates[key] = req.body[key];
      }
    }
    updates.last_updated = new Date();

    const [existing] = await db
      .select()
      .from(leadIntelligenceTable)
      .where(eq(leadIntelligenceTable.lead_id, leadId));

    let row;

    if (existing) {
      const [updated] = await db
        .update(leadIntelligenceTable)
        .set(updates)
        .where(eq(leadIntelligenceTable.id, existing.id))
        .returning();
      row = updated;
    } else {
      const [created] = await db
        .insert(leadIntelligenceTable)
        .values({ lead_id: leadId, ...updates })
        .returning();
      row = created;
    }

    await db.insert(changelogTable).values({
      id: randomUUID(),
      action: "INTELLIGENCE_UPDATED",
      lead_id: leadId,
      details: "Intelligence record updated",
      triggered_by: "operator",
    });

    res.json({ intelligence: row });
  } catch (err) {
    res.status(500).json({ error: "Failed to update intelligence" });
  }
});

export default router;
