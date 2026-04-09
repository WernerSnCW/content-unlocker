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

  // Fetch existing intelligence for merge context
  const [existing] = await db.select().from(leadIntelligenceTable)
    .where(eq(leadIntelligenceTable.lead_id, leadId));

  let inputSections = `INVESTOR NAME: ${lead.name}\n`;
  if (notes && notes.trim() !== "") {
    inputSections += `\nOPERATOR NOTES:\n${notes}\n`;
  }
  if (transcriptText && transcriptText.trim() !== "") {
    inputSections += `\nCALL TRANSCRIPT:\n${transcriptText}\n`;
  }

  // Build existing profile context for merge
  let existingProfileContext = "";
  if (existing) {
    const profileFields: Record<string, any> = {};
    for (const key of ALLOWED_FIELDS) {
      const val = (existing as any)[key];
      if (val !== null && val !== undefined) {
        profileFields[key] = val;
      }
    }
    if (Object.keys(profileFields).length > 0) {
      existingProfileContext = `
EXISTING INTELLIGENCE PROFILE (from previous analysis):
${JSON.stringify(profileFields, null, 2)}

MERGE RULES — CRITICAL:
- This investor has been analysed before. The existing profile above contains established intelligence.
- PRESERVE all existing non-null values UNLESS the new transcript explicitly contradicts them.
- If the new transcript provides no signal for a field, return "__KEEP__" to preserve the existing value.
- If the new transcript provides NEW information for a field that was previously null, set it.
- If the new transcript CONTRADICTS an existing value (e.g. investor previously said they have an IFA but now says they do not), update it.
- NEVER overwrite an established field with null just because it was not mentioned in this transcript.
- For profile_summary: merge new insights with existing summary, do not replace it entirely.
- For hot_button: only change if new transcript reveals a different or stronger emotional driver.
- For SPIN fields: append or refine, do not erase.
`;
    }
  }

  const message = await claudeWithTimeout(anthropic, {
    model: "claude-sonnet-4-6",
    max_tokens: 8192,
    messages: [{
      role: "user",
      content: `You are analysing investor profile information to produce a structured intelligence record.

${inputSections}
${existingProfileContext}
Produce a structured JSON intelligence profile. Return JSON only — no other text.

{
  "qualification_status": "QUALIFIED | DISQUALIFIED | INSUFFICIENT_DATA",
  "higher_rate_taxpayer": true | false | null | "__KEEP__",
  "capital_available": true | false | null | "__KEEP__",
  "self_directed": true | false | null | "__KEEP__",
  "open_to_early_stage_risk": true | false | null | "__KEEP__",
  "qualification_notes": "string | null | __KEEP__",
  "cluster": "growth_seeker | preserver | legacy_builder | null | __KEEP__",
  "ifa_involved": true | false | null | "__KEEP__",
  "already_done_eis": true | false | null | "__KEEP__",
  "estate_above_2m": true | false | null | "__KEEP__",
  "assets_abroad": true | false | null | "__KEEP__",
  "vct_aim_experience": true | false | null | "__KEEP__",
  "hot_button": "family_security | freedom | legacy | relief | significance | null | __KEEP__",
  "hot_button_confirmed": true | false | "__KEEP__",
  "hot_button_quote": "exact quote from transcript if detected | null | __KEEP__",
  "spin_situation": "their current situation in one sentence | null | __KEEP__",
  "spin_problem": "the core problem they face | null | __KEEP__",
  "spin_implication": "what happens if they don't act | null | __KEEP__",
  "spin_need_payoff": "what success looks like for them | null | __KEEP__",
  "readiness_status": "READY_TO_CLOSE | OBJECTION_TO_RESOLVE | INFORMATION_GAP | NEEDS_NURTURING | null | __KEEP__",
  "primary_blocker": "description of main blocker if any | null | __KEEP__",
  "blocker_type": "dispositional | correctable_misconception | null | __KEEP__",
  "recommended_action": "specific recommended next action | null | __KEEP__",
  "profile_summary": "2-3 sentence plain English summary merging existing and new insights"
}

Rules:
- Use "__KEEP__" for any field where the existing value should be preserved (no new signal in this transcript).
- Use null ONLY for fields where you have no information AND there is no existing value to preserve.
- qualification_status: QUALIFIED = higher rate taxpayer, capital available, self-directed, open to risk. DISQUALIFIED = clear disqualifier present. INSUFFICIENT_DATA = not enough info.
- cluster: growth_seeker = focused on upside and returns. preserver = focused on capital protection and risk. legacy_builder = focused on IHT, estate, family wealth.
- ifa_involved: true if the investor mentions ANY financial adviser, wealth manager, or platform relationship (e.g. Hargreaves Lansdown, St James's Place, a private wealth manager). This is about whether they have an existing advisory relationship, not whether that adviser handles EIS specifically.
- hot_button: the emotional driver. family_security = protecting family. freedom = financial independence. legacy = leaving something behind. relief = reducing tax burden. significance = making an impact.
- profile_summary: write in plain English, third person, as if briefing a colleague before a call. If an existing profile exists, merge new insights with it.`,
    }],
  });

  const block = message.content[0];
  const text = block.type === "text" ? block.text : "";

  let parsed;
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("No JSON object found in Claude response");
  parsed = JSON.parse(jsonMatch[0]);

  // Build updates: skip __KEEP__ fields (preserve existing), skip null if existing has a value
  const updates: any = { last_updated: new Date() };
  for (const key of ALLOWED_FIELDS) {
    if (parsed[key] === undefined) continue;
    if (parsed[key] === "__KEEP__") continue; // Preserve existing value
    if (parsed[key] === null && existing && (existing as any)[key] !== null) continue; // Don't overwrite with null
    updates[key] = parsed[key];
  }

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
