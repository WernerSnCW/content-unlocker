import { Router, type IRouter } from "express";
import { db, leadIntelligenceTable, changelogTable, leadsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { randomUUID } from "crypto";
import { anthropic } from "@workspace/integrations-anthropic-ai";

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
    const [lead] = await db.select().from(leadsTable).where(eq(leadsTable.id, leadId));
    if (!lead) {
      res.status(404).json({ error: "Lead not found" });
      return;
    }

    const notes = lead.notes;
    const transcriptText = lead.transcript_text;

    if ((!notes || notes.trim() === "") && (!transcriptText || transcriptText.trim() === "")) {
      res.status(400).json({ error: "Lead has no notes or transcript to analyse" });
      return;
    }

    let inputSections = `INVESTOR NAME: ${lead.name}\n`;
    if (notes && notes.trim() !== "") {
      inputSections += `\nOPERATOR NOTES:\n${notes}\n`;
    }
    if (transcriptText && transcriptText.trim() !== "") {
      inputSections += `\nCALL TRANSCRIPT:\n${transcriptText}\n`;
    }

    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 8192,
      messages: [{
        role: "user",
        content: `You are analysing investor profile information to produce a structured intelligence record.

${inputSections}
Produce a structured JSON intelligence profile. Return JSON only — no other text.

{
  "qualification_status": "QUALIFIED | DISQUALIFIED | INSUFFICIENT_DATA",
  "higher_rate_taxpayer": true | false | null,
  "capital_available": true | false | null,
  "self_directed": true | false | null,
  "open_to_early_stage_risk": true | false | null,
  "qualification_notes": "string | null",
  "cluster": "growth_seeker | preserver | legacy_builder | null",
  "ifa_involved": true | false | null,
  "already_done_eis": true | false | null,
  "estate_above_2m": true | false | null,
  "assets_abroad": true | false | null,
  "vct_aim_experience": true | false | null,
  "hot_button": "family_security | freedom | legacy | relief | significance | null",
  "hot_button_confirmed": false,
  "hot_button_quote": "exact quote from transcript if detected | null",
  "spin_situation": "their current situation in one sentence | null",
  "spin_problem": "the core problem they face | null",
  "spin_implication": "what happens if they don't act | null",
  "spin_need_payoff": "what success looks like for them | null",
  "readiness_status": "READY_TO_CLOSE | OBJECTION_TO_RESOLVE | INFORMATION_GAP | NEEDS_NURTURING | null",
  "primary_blocker": "description of main blocker if any | null",
  "blocker_type": "dispositional | correctable_misconception | null",
  "recommended_action": "specific recommended next action | null",
  "profile_summary": "2-3 sentence plain English summary of this investor's profile, motivations, and recommended approach"
}

Rules:
- Use null for any field where you have insufficient information.
- qualification_status: QUALIFIED = higher rate taxpayer, capital available, self-directed, open to risk. DISQUALIFIED = clear disqualifier present. INSUFFICIENT_DATA = not enough info.
- cluster: growth_seeker = focused on upside and returns. preserver = focused on capital protection and risk. legacy_builder = focused on IHT, estate, family wealth.
- hot_button: the emotional driver. family_security = protecting family. freedom = financial independence. legacy = leaving something behind. relief = reducing tax burden. significance = making an impact.
- profile_summary: write in plain English, third person, as if briefing a colleague before a call.`,
      }],
    });

    const block = message.content[0];
    const text = block.type === "text" ? block.text : "";

    let parsed;
    try {
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error("No JSON object found");
      parsed = JSON.parse(jsonMatch[0]);
    } catch {
      res.status(500).json({ error: "Failed to parse Claude response" });
      return;
    }

    const updates: any = { last_updated: new Date() };
    for (const key of ALLOWED_FIELDS) {
      if (parsed[key] !== undefined) {
        updates[key] = parsed[key];
      }
    }

    const [existing] = await db.select().from(leadIntelligenceTable)
      .where(eq(leadIntelligenceTable.lead_id, leadId));

    let row;
    if (existing) {
      const [updated] = await db.update(leadIntelligenceTable)
        .set(updates)
        .where(eq(leadIntelligenceTable.id, existing.id))
        .returning();
      row = updated;
    } else {
      const [created] = await db.insert(leadIntelligenceTable)
        .values({ lead_id: leadId, ...updates })
        .returning();
      row = created;
    }

    await db.insert(changelogTable).values({
      id: randomUUID(),
      action: "INTELLIGENCE_GENERATED",
      lead_id: leadId,
      details: "Intelligence profile generated by Claude",
      triggered_by: "claude_analysis",
    });

    res.json({ intelligence: row });
  } catch (err) {
    res.status(500).json({ error: "Failed to generate intelligence" });
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
