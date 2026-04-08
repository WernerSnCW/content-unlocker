import { db, acuTable, acuCandidatesTable, acuContradictionsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { randomUUID } from "crypto";
import { anthropic } from "@workspace/integrations-anthropic-ai";
import { claudeWithTimeout } from "./claudeTimeout";

interface ContradictionResult {
  unit_a_id: string;
  unit_b_id: string;
  unit_a_content: string;
  unit_b_content: string;
  conflict_description: string;
  severity: string;
  rule_type?: string;
}

interface ContentUnit {
  id: string;
  type: string;
  content: string;
  source: string;
  topics: string[];
  requires_qualifier: string | null;
  supersedes: string | null;
  status: string;
  variant_audience: string | null;
}

function extractNumbers(text: string): number[] {
  const matches = text.match(/\d+\.?\d*%?/g);
  if (!matches) return [];
  return matches.map(m => parseFloat(m.replace("%", "")));
}

function runRuleBasedChecks(units: ContentUnit[]): ContradictionResult[] {
  const results: ContradictionResult[] = [];
  const prohibitedIds = new Set(
    units.filter(u => u.type === "prohibited" || (u.topics && u.topics.some(t => t.startsWith("prohibited_")))).map(u => u.id)
  );

  for (let i = 0; i < units.length; i++) {
    for (let j = i + 1; j < units.length; j++) {
      const a = units[i];
      const b = units[j];

      const aTopics = a.topics || [];
      const bTopics = b.topics || [];
      const sharedTopics = aTopics.filter(t => bTopics.includes(t));

      if (sharedTopics.length > 0) {
        const aNums = extractNumbers(a.content);
        const bNums = extractNumbers(b.content);
        if (aNums.length > 0 && bNums.length > 0) {
          const aSet = new Set(aNums.map(String));
          const bSet = new Set(bNums.map(String));
          const hasDiff = [...bSet].some(n => !aSet.has(n)) || [...aSet].some(n => !bSet.has(n));
          if (hasDiff) {
            results.push({
              unit_a_id: a.id,
              unit_b_id: b.id,
              unit_a_content: a.content,
              unit_b_content: b.content,
              conflict_description: `R1: Numeric mismatch on shared topic(s) [${sharedTopics.join(", ")}]. Unit A contains [${aNums.join(", ")}], Unit B contains [${bNums.join(", ")}].`,
              severity: "CRITICAL",
              rule_type: "R1_numeric_mismatch",
            });
          }
        }
      }

      if (prohibitedIds.has(a.id) && !prohibitedIds.has(b.id)) {
        if (b.content.includes(a.content) || a.content.includes(b.content)) {
          results.push({
            unit_a_id: a.id,
            unit_b_id: b.id,
            unit_a_content: a.content,
            unit_b_content: b.content,
            conflict_description: `R2: Prohibited content from [${a.id}] appears verbatim in non-prohibited unit [${b.id}].`,
            severity: "CRITICAL",
            rule_type: "R2_prohibited_leak",
          });
        }
      }
      if (prohibitedIds.has(b.id) && !prohibitedIds.has(a.id)) {
        if (a.content.includes(b.content) || b.content.includes(a.content)) {
          results.push({
            unit_a_id: b.id,
            unit_b_id: a.id,
            unit_a_content: b.content,
            unit_b_content: a.content,
            conflict_description: `R2: Prohibited content from [${b.id}] appears verbatim in non-prohibited unit [${a.id}].`,
            severity: "CRITICAL",
            rule_type: "R2_prohibited_leak",
          });
        }
      }
    }

    const a = units[i];
    if (a.requires_qualifier) {
      const qualifierExists = units.some(u => u.id === a.requires_qualifier);
      if (!qualifierExists) {
        results.push({
          unit_a_id: a.id,
          unit_b_id: a.requires_qualifier!,
          unit_a_content: a.content,
          unit_b_content: `[MISSING QUALIFIER: ${a.requires_qualifier}]`,
          conflict_description: `R3: Unit [${a.id}] requires qualifier [${a.requires_qualifier}] but it is not present in the content set.`,
          severity: "HIGH",
          rule_type: "R3_missing_qualifier",
        });
      }
    }

    if (a.supersedes) {
      const superseded = units.find(u => u.id === a.supersedes);
      if (superseded && superseded.status !== "RETIRED") {
        results.push({
          unit_a_id: a.id,
          unit_b_id: superseded.id,
          unit_a_content: a.content,
          unit_b_content: superseded.content,
          conflict_description: `R4: Unit [${a.id}] supersedes [${superseded.id}] but the superseded unit is still active (status: ${superseded.status}).`,
          severity: "HIGH",
          rule_type: "R4_superseded_active",
        });
      }
    }

    if (a.variant_audience && a.variant_audience !== "all") {
      const coldVariant = a.variant_audience === "cold";
      const warmVariant = a.variant_audience === "warm";
      const hotVariant = a.variant_audience === "hot";

      for (const other of units) {
        if (other.id === a.id) continue;
        const otherTopics = other.topics || [];
        const isWarmContext = otherTopics.some(t => t.includes("warm") || t.includes("nurture"));
        const isHotContext = otherTopics.some(t => t.includes("hot") || t.includes("conversion"));
        const isColdContext = otherTopics.some(t => t.includes("cold") || t.includes("awareness"));

        if (coldVariant && (isWarmContext || isHotContext)) {
          results.push({
            unit_a_id: a.id,
            unit_b_id: other.id,
            unit_a_content: a.content,
            unit_b_content: other.content,
            conflict_description: `R5: Expression variant [${a.id}] is audience="${a.variant_audience}" but appears alongside content tagged for warm/hot context.`,
            severity: "MEDIUM",
            rule_type: "R5_channel_variant_mismatch",
          });
          break;
        }
        if (warmVariant && isColdContext) {
          results.push({
            unit_a_id: a.id,
            unit_b_id: other.id,
            unit_a_content: a.content,
            unit_b_content: other.content,
            conflict_description: `R5: Expression variant [${a.id}] is audience="${a.variant_audience}" but appears alongside cold-context content.`,
            severity: "MEDIUM",
            rule_type: "R5_channel_variant_mismatch",
          });
          break;
        }
      }
    }
  }

  return results;
}

export async function detectContradictions(): Promise<{
  contradictions_found: number;
  new_contradictions: number;
  rule_based_count: number;
  llm_count: number;
  results: ContradictionResult[];
}> {
  const lockedACUs = await db.select().from(acuTable).where(eq(acuTable.status, "LOCKED"));
  const candidates = await db.select().from(acuCandidatesTable)
    .where(eq(acuCandidatesTable.status, "PENDING_REVIEW"));

  const allUnits: ContentUnit[] = [
    ...lockedACUs.map(u => ({
      id: u.id,
      type: u.type,
      content: u.content,
      source: "LOCKED_ACU",
      topics: (u.topics as string[]) || [],
      requires_qualifier: u.requires_qualifier,
      supersedes: u.supersedes,
      status: u.status,
      variant_audience: u.variant_audience,
    })),
    ...candidates.map(c => ({
      id: c.id,
      type: c.type,
      content: c.content,
      source: "CANDIDATE",
      topics: (c.topics as string[]) || [],
      requires_qualifier: null,
      supersedes: null,
      status: c.status,
      variant_audience: null,
    })),
  ];

  if (allUnits.length < 2) {
    return { contradictions_found: 0, new_contradictions: 0, rule_based_count: 0, llm_count: 0, results: [] };
  }

  const ruleResults = runRuleBasedChecks(allUnits);

  const criticalPairs = new Set(
    ruleResults
      .filter(r => r.severity === "CRITICAL")
      .map(r => [r.unit_a_id, r.unit_b_id].sort().join("::"))
  );

  const unitList = allUnits.map(u =>
    `[${u.id}] (${u.type}, ${u.source}, topics: [${u.topics.join(",")}]): ${u.content}`
  ).join("\n\n");

  const prompt = `You are reviewing a set of content units from an investor communication platform.
Your job is to identify contradictions, tensions, and inconsistencies.

CONTENT UNITS:
${unitList}

ALREADY FLAGGED PAIRS (skip these — they have been caught by rule-based checks):
${[...criticalPairs].join("\n")}

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

  let llmResults: ContradictionResult[] = [];
  try {
    const response = await claudeWithTimeout(anthropic, {
      model: "claude-sonnet-4-6",
      max_tokens: 8192,
      messages: [{ role: "user", content: prompt }],
    });

    const text = response.content[0].type === "text" ? response.content[0].text : "";
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      llmResults = JSON.parse(jsonMatch[0]);
    }
  } catch (e) {
    console.error("Failed to parse contradiction detector response:", e);
  }

  const allResults = [...ruleResults, ...llmResults];

  let newCount = 0;
  for (const c of allResults) {
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
    contradictions_found: allResults.length,
    new_contradictions: newCount,
    rule_based_count: ruleResults.length,
    llm_count: llmResults.length,
    results: allResults,
  };
}
