import { db, leadIntelligenceTable, changelogTable, leadsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { randomUUID } from "crypto";
import { anthropic } from "@workspace/integrations-anthropic-ai";
import { claudeWithTimeout } from "./claudeTimeout";

const ALLOWED_FIELDS = [
  "qualification_status", "higher_rate_taxpayer", "capital_available",
  "self_directed", "open_to_early_stage_risk", "qualification_notes",
  "cluster", "ifa_involved", "already_done_eis", "estate_above_2m",
  "assets_abroad", "vct_aim_experience", "hot_button", "hot_button_confirmed",
  "hot_button_quote", "spin_situation", "spin_problem", "spin_implication",
  "spin_need_payoff", "readiness_status", "primary_blocker", "blocker_type",
  "recommended_action", "profile_summary",
];

export interface IntelligenceResult {
  intelligence: any;
  isNew: boolean;
}

export async function generateIntelligence(leadId: string): Promise<IntelligenceResult> {
  const [lead] = await db.select().from(leadsTable).where(eq(leadsTable.id, leadId));
  if (!lead) {
    throw new Error("Lead not found");
  }

  const notes = lead.notes;
  const transcriptText = lead.transcript_text;

  if ((!notes || notes.trim() === "") && (!transcriptText || transcriptText.trim() === "")) {
    throw new Error("Lead has no notes or transcript to analyse");
  }

  let inputSections = `INVESTOR NAME: ${lead.name}\n`;
  if (notes && notes.trim() !== "") {
    inputSections += `\nOPERATOR NOTES:\n${notes}\n`;
  }
  if (transcriptText && transcriptText.trim() !== "") {
    inputSections += `\nCALL TRANSCRIPT:\n${transcriptText}\n`;
  }

  const message = await claudeWithTimeout(anthropic, {
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
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("No JSON object found in Claude response");
  parsed = JSON.parse(jsonMatch[0]);

  const updates: any = { last_updated: new Date() };
  for (const key of ALLOWED_FIELDS) {
    if (parsed[key] !== undefined) {
      updates[key] = parsed[key];
    }
  }

  const [existing] = await db.select().from(leadIntelligenceTable)
    .where(eq(leadIntelligenceTable.lead_id, leadId));

  let row;
  let isNew = false;
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
    isNew = true;
  }

  await db.insert(changelogTable).values({
    id: randomUUID(),
    action: "INTELLIGENCE_GENERATED",
    lead_id: leadId,
    details: "Intelligence profile generated by Claude",
    triggered_by: "claude_analysis",
  });

  return { intelligence: row, isNew };
}
