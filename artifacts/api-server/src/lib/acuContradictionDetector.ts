import { db, acuTable, acuCandidatesTable, acuContradictionsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { randomUUID } from "crypto";
import { anthropic } from "@workspace/integrations-anthropic-ai";

interface ContradictionResult {
  unit_a_id: string;
  unit_b_id: string;
  unit_a_content: string;
  unit_b_content: string;
  conflict_description: string;
  severity: string;
}

export async function detectContradictions(): Promise<{
  contradictions_found: number;
  new_contradictions: number;
  results: ContradictionResult[];
}> {
  const lockedACUs = await db.select().from(acuTable).where(eq(acuTable.status, "LOCKED"));
  const candidates = await db.select().from(acuCandidatesTable)
    .where(eq(acuCandidatesTable.status, "PENDING_REVIEW"));

  const allUnits = [
    ...lockedACUs.map(u => ({ id: u.id, type: u.type, content: u.content, source: "LOCKED_ACU" })),
    ...candidates.map(c => ({ id: c.id, type: c.type, content: c.content, source: "CANDIDATE" })),
  ];

  if (allUnits.length < 2) {
    return { contradictions_found: 0, new_contradictions: 0, results: [] };
  }

  const unitList = allUnits.map(u => `[${u.id}] (${u.type}, ${u.source}): ${u.content}`).join("\n\n");

  const prompt = `You are reviewing a set of content units from an investor communication platform.
Your job is to identify contradictions, tensions, and inconsistencies.

CONTENT UNITS:
${unitList}

For each pair of units that address the same topic, determine:
1. Direct contradiction: Do they state opposite things about the same fact?
2. Logical tension: Are they individually correct but in tension when read together?
3. Qualifier inconsistency: Does one have a required qualifier that the other is missing?
4. Version conflict: Does one appear to supersede the other?

SEVERITY LEVELS:
- CRITICAL: Direct factual contradiction. Compliance risk.
- HIGH: Logical tension that an investor would notice.
- MEDIUM: Inconsistent framing that weakens the argument.
- LOW: Minor inconsistency in emphasis or tone.

Do not flag stylistic differences as contradictions.
Do not flag units that cover different aspects of the same topic.
Only flag genuine conflicts where an investor reading both units would notice the inconsistency.

Return a JSON array of contradictions found:
[
  {
    "unit_a_id": "id of first unit",
    "unit_b_id": "id of second unit",
    "unit_a_content": "relevant text from unit A",
    "unit_b_content": "relevant text from unit B",
    "conflict_description": "plain English explanation of the conflict",
    "severity": "CRITICAL|HIGH|MEDIUM|LOW"
  }
]

If no contradictions found, return an empty array: []

Return ONLY the JSON array, no other text.`;

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 8192,
    messages: [{ role: "user", content: prompt }],
  });

  let results: ContradictionResult[] = [];
  try {
    const text = response.content[0].type === "text" ? response.content[0].text : "";
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      results = JSON.parse(jsonMatch[0]);
    }
  } catch (e) {
    console.error("Failed to parse contradiction detector response:", e);
  }

  let newCount = 0;
  for (const c of results) {
    const existing = await db.select().from(acuContradictionsTable);
    const alreadyExists = existing.find(e =>
      (e.unit_a_id === c.unit_a_id && e.unit_b_id === c.unit_b_id) ||
      (e.unit_a_id === c.unit_b_id && e.unit_b_id === c.unit_a_id)
    );

    if (!alreadyExists) {
      await db.insert(acuContradictionsTable).values({
        id: `contra_${randomUUID().substring(0, 8)}`,
        unit_a_id: c.unit_a_id,
        unit_b_id: c.unit_b_id,
        unit_a_content: c.unit_a_content,
        unit_b_content: c.unit_b_content,
        conflict_description: c.conflict_description,
        severity: c.severity,
        status: "UNRESOLVED",
      });
      newCount++;
    }
  }

  return {
    contradictions_found: results.length,
    new_contradictions: newCount,
    results,
  };
}
