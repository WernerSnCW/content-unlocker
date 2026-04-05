import { db, acuTable, outputTemplatesTable } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import { anthropic } from "@workspace/integrations-anthropic-ai";

interface GenerationRequest {
  template_id: string;
  context?: Record<string, string>;
  channel_temperature?: "cold" | "warm" | "hot";
}

interface TemplateComplianceResult {
  pass: boolean;
  issues: string[];
}

function checkTemplateCompliance(
  generated: Record<string, string>,
  sections: any[],
  requiredAcuIds: string[],
  prohibitedAcuIds: string[],
  lockedContent: Map<string, string>,
): TemplateComplianceResult {
  const issues: string[] = [];

  for (const section of sections) {
    if (section.required && !generated[section.id]) {
      issues.push(`Missing required section: ${section.id}`);
      continue;
    }

    const content = generated[section.id];
    if (!content) continue;

    if (section.max_words) {
      const wordCount = content.split(/\s+/).length;
      if (wordCount > section.max_words * 1.05) {
        issues.push(`Section [${section.id}] exceeds word limit: ${wordCount}/${section.max_words}`);
      }
    }

    if (section.max_sentences) {
      const sentenceCount = content.split(/[.!?]+/).filter(Boolean).length;
      if (sentenceCount > section.max_sentences) {
        issues.push(`Section [${section.id}] exceeds sentence limit: ${sentenceCount}/${section.max_sentences}`);
      }
    }

    if (section.max_chars) {
      if (content.length > section.max_chars * 1.05) {
        issues.push(`Section [${section.id}] exceeds character limit: ${content.length}/${section.max_chars}`);
      }
    }
  }

  for (const acuId of requiredAcuIds) {
    const acuContent = lockedContent.get(acuId);
    if (acuContent) {
      const allContent = Object.values(generated).join(" ");
      const words = acuContent.split(/\s+/);
      const matchedWords = words.filter(w => allContent.toLowerCase().includes(w.toLowerCase()));
      const matchRate = matchedWords.length / words.length;
      if (matchRate < 0.95) {
        issues.push(`Required ACU [${acuId}] not sufficiently present (${Math.round(matchRate * 100)}% match)`);
      }
    }
  }

  for (const acuId of prohibitedAcuIds) {
    const acuContent = lockedContent.get(acuId);
    if (acuContent) {
      const allContent = Object.values(generated).join(" ").toLowerCase();
      if (allContent.includes(acuContent.toLowerCase())) {
        issues.push(`Prohibited ACU [${acuId}] content found in output`);
      }
    }
  }

  return { pass: issues.length === 0, issues };
}

export async function generateFromTemplate(request: GenerationRequest): Promise<{
  template_id: string;
  output: Record<string, string>;
  compliance_check: TemplateComplianceResult;
  metadata: Record<string, any>;
}> {
  const [template] = await db.select().from(outputTemplatesTable)
    .where(eq(outputTemplatesTable.id, request.template_id));

  if (!template) {
    throw new Error(`Template not found: ${request.template_id}`);
  }

  let composedSections = template.sections as any[];
  let parentSections: any[] = [];

  if (template.parent_template_id) {
    const [parent] = await db.select().from(outputTemplatesTable)
      .where(eq(outputTemplatesTable.id, template.parent_template_id));
    if (parent) {
      parentSections = parent.sections as any[];
    }
  }

  let requiredAcuIds = (template.required_acus as string[]) || [];
  let prohibitedAcuIds = (template.prohibited_acus as string[]) || [];

  if (template.parent_template_id) {
    const [parent] = await db.select().from(outputTemplatesTable)
      .where(eq(outputTemplatesTable.id, template.parent_template_id));
    if (parent) {
      requiredAcuIds = [...requiredAcuIds, ...((parent.required_acus as string[]) || [])];
      prohibitedAcuIds = [...prohibitedAcuIds, ...((parent.prohibited_acus as string[]) || [])];
    }
  }

  const allRequiredIds = [
    ...requiredAcuIds,
    ...composedSections.flatMap((s: any) => s.required_acu_ids || []),
  ];
  const uniqueRequiredIds = [...new Set(allRequiredIds)];
  const uniqueProhibitedIds = [...new Set(prohibitedAcuIds)];

  let lockedACUs: any[] = [];
  if (uniqueRequiredIds.length > 0) {
    lockedACUs = await db.select().from(acuTable).where(inArray(acuTable.id, uniqueRequiredIds));
  }

  let prohibitedACUs: any[] = [];
  if (uniqueProhibitedIds.length > 0) {
    prohibitedACUs = await db.select().from(acuTable).where(inArray(acuTable.id, uniqueProhibitedIds));
  }

  const lockedContent = new Map<string, string>();
  lockedACUs.forEach(acu => lockedContent.set(acu.id, acu.content));
  prohibitedACUs.forEach(acu => lockedContent.set(acu.id, acu.content));

  const lockedBlocks = lockedACUs.map(acu =>
    `[LOCKED ACU: ${acu.id}]\n${acu.content}\n[END LOCKED ACU]`
  ).join("\n\n");

  const sectionDefs = composedSections.map((s: any) => {
    let def = `## Section: ${s.id} (${s.label || s.id})`;
    if (s.required) def += " [REQUIRED]";
    if (s.max_words) def += `\nMax words: ${s.max_words}`;
    if (s.max_sentences) def += `\nMax sentences: ${s.max_sentences}`;
    if (s.max_chars) def += `\nMax characters: ${s.max_chars}`;
    if (s.narrative_guidance) def += `\nGuidance: ${s.narrative_guidance}`;
    if (s.required_acu_ids) def += `\nRequired ACUs (inject verbatim): ${s.required_acu_ids.join(", ")}`;
    if (s.injection_mode) def += `\nInjection mode: ${s.injection_mode}`;
    if (s.accepted_topics) def += `\nAccepted topics: ${s.accepted_topics.join(", ")}`;
    if (s.structure) def += `\nStructure template: ${s.structure}`;
    return def;
  }).join("\n\n");

  if (parentSections.length > 0) {
    const parentDefs = parentSections.map((s: any) => {
      let def = `## Parent Section: ${s.id} (${s.label || s.id}) [REQUIRED — from parent template]`;
      if (s.narrative_guidance) def += `\nGuidance: ${s.narrative_guidance}`;
      if (s.required_acu_ids) def += `\nRequired ACUs (inject verbatim): ${s.required_acu_ids.join(", ")}`;
      return def;
    }).join("\n\n");
    composedSections = [...composedSections, ...parentSections];
  }

  const promptParts: string[] = [];

  if (template.generation_prompt_prefix) {
    promptParts.push(template.generation_prompt_prefix);
  } else {
    promptParts.push(`Generate content for the "${template.name}" template. Follow the section structure exactly. Tone: institutional, intelligence-forward, never salesy.`);
  }

  promptParts.push(`\nTEMPLATE SECTIONS:\n${sectionDefs}`);

  if (parentSections.length > 0) {
    promptParts.push(`\nPARENT COMPLIANCE SECTIONS (must appear at the end):\n${parentSections.map((s: any) => `- ${s.id}: ${s.label || s.id}`).join("\n")}`);
  }

  if (lockedBlocks) {
    promptParts.push(`\nLOCKED CONTENT BLOCKS (use verbatim where required):\n${lockedBlocks}`);
  }

  if (uniqueProhibitedIds.length > 0) {
    const prohibitedDescriptions = prohibitedACUs.map(a => `${a.id}: ${a.content}`).join("\n");
    promptParts.push(`\nPROHIBITED CONTENT (must NOT appear in output in any form):\n${prohibitedDescriptions}`);
  }

  const formattingRules = template.formatting_rules as Record<string, any>;
  if (formattingRules) {
    promptParts.push(`\nFORMATTING RULES:\n${JSON.stringify(formattingRules, null, 2)}`);
  }

  if (request.context) {
    promptParts.push(`\nADDITIONAL CONTEXT:\n${JSON.stringify(request.context, null, 2)}`);
  }

  promptParts.push(`\nReturn a JSON object with each section ID as a key and the generated content as the value. Each section value must be a plain text or markdown prose string — never a JSON object, array, or structured data type. Include a _metadata key with template_id, word_counts, acus_used, and compliance_check status.`);

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 8192,
    messages: [{ role: "user", content: promptParts.join("\n") }],
  });

  let output: Record<string, any> = {};
  try {
    const text = response.content[0].type === "text" ? response.content[0].text : "";
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      output = JSON.parse(jsonMatch[0]);
    }
  } catch (e) {
    console.error("Failed to parse generation response:", e);
    throw new Error("Generation failed — could not parse LLM response");
  }

  const metadata = output._metadata || {};
  delete output._metadata;

  const stringOutput: Record<string, string> = {};
  for (const [key, val] of Object.entries(output)) {
    if (typeof val === "string") {
      stringOutput[key] = val;
    } else if (val != null) {
      stringOutput[key] = JSON.stringify(val);
    }
  }

  const compliance = checkTemplateCompliance(
    stringOutput,
    composedSections,
    uniqueRequiredIds,
    uniqueProhibitedIds,
    lockedContent,
  );

  return {
    template_id: request.template_id,
    output: stringOutput,
    compliance_check: compliance,
    metadata: {
      ...metadata,
      template_name: template.name,
      parent_template_id: template.parent_template_id,
      sections_count: composedSections.length,
    },
  };
}
