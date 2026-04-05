import { db, leadsTable, documentsTable, changelogTable, acuTable, channelsTable } from "@workspace/db";
import { eq, ilike, and, desc } from "drizzle-orm";
import { randomUUID } from "crypto";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";
import registryData from "../data/registry.json" with { type: "json" };
import leadsData from "../data/leads.json" with { type: "json" };
import complianceData from "../data/compliance_constants.json" with { type: "json" };
import acuSeedData from "../data/acu-seed.json" with { type: "json" };
import channelSeedData from "../data/channels.json" with { type: "json" };
import { seedACURefactor } from "../data/seed-acu-refactor";
import { seedTemplates } from "../data/seed-templates";
import { seedPrompts } from "../data/seed-prompts";
import { logger } from "./logger";

export async function seedDatabase() {
  const existingLeads = await db.select({ id: leadsTable.id }).from(leadsTable).limit(1);
  if (existingLeads.length > 0) {
    logger.info("Database already seeded, running incremental seeds only");
    try {
      const acuResult = await seedACURefactor();
      logger.info({ ...acuResult }, "ACU refactor seed complete");
      const tmplResult = await seedTemplates();
      logger.info({ ...tmplResult }, "Template seed complete");
      const promptResult = await seedPrompts();
      logger.info({ ...promptResult }, "Prompt seed complete");
    } catch (err) {
      logger.error({ err }, "Incremental seed error (non-fatal)");
    }
    return;
  }

  logger.info("Seeding database...");

  const candidateDirs = [
    join(import.meta.dirname, "..", "src", "data", "content"),
    join(import.meta.dirname, "..", "data", "content"),
  ];
  let contentDir = "";
  let contentFiles: string[] = [];
  for (const dir of candidateDirs) {
    try {
      contentFiles = readdirSync(dir);
      contentDir = dir;
      logger.info(`Found content directory at ${dir} with ${contentFiles.length} files`);
      break;
    } catch {
      continue;
    }
  }
  if (!contentDir) {
    logger.warn("Content directory not found, all documents will have null content");
  }

  for (const doc of (registryData as any).documents) {
    let content: string | null = null;
    const matchingFile = contentFiles.find((f) => f.startsWith(`${doc.id}_`));
    if (matchingFile) {
      try {
        content = readFileSync(join(contentDir, matchingFile), "utf-8");
        logger.info(`Loaded content for ${doc.id} (${doc.name}) from ${matchingFile}`);
      } catch (err) {
        logger.warn(`Failed to read content file ${matchingFile} for ${doc.id}: ${err}`);
      }
    } else {
      logger.info(`No content file found for ${doc.id} (${doc.name}), setting content to null`);
    }

    await db.insert(documentsTable).values({
      id: doc.id,
      file_code: doc.file_code,
      type: doc.type,
      name: doc.name,
      filename: doc.filename,
      tier: doc.tier,
      category: doc.category,
      lifecycle_status: doc.lifecycle_status,
      review_state: doc.review_state,
      version: doc.version,
      last_reviewed: doc.last_reviewed,
      description: doc.description,
      pipeline_stage_relevance: doc.pipeline_stage_relevance || [],
      persona_relevance: doc.persona_relevance || [],
      upstream_dependencies: doc.upstream_dependencies || [],
      downstream_dependents: doc.downstream_dependents || [],
      is_generated: doc.is_generated || false,
      generation_brief_id: doc.generation_brief_id || null,
      generation_attempt: doc.generation_attempt || null,
      qc_report_id: doc.qc_report_id || null,
      source_trace: doc.source_trace || [],
      content,
      qc_history: [],
    }).onConflictDoNothing();
  }

  for (const lead of (leadsData as any).leads) {
    await db.insert(leadsTable).values({
      id: lead.id,
      name: lead.name,
      company: lead.company || null,
      pipeline_stage: lead.pipeline_stage,
      first_contact: lead.first_contact,
      last_contact: lead.last_contact,
      detected_persona: lead.detected_persona || null,
      archived: lead.archived || false,
      send_log: lead.send_log || [],
      stage_history: lead.stage_history || [],
      notes: lead.notes || [],
    }).onConflictDoNothing();
  }

  for (const acu of (acuSeedData as any[])) {
    await db.insert(acuTable).values({
      id: acu.id,
      type: acu.type,
      content: acu.content,
      status: acu.status || "DRAFT",
      source: acu.source || null,
      approved_by: acu.approved_by || null,
      approved_date: acu.approved_date || null,
      version: acu.version || 1,
      expression_variants: acu.expression_variants || [],
      documents_referencing: acu.documents_referencing || [],
      cascade_on_change: acu.cascade_on_change !== undefined ? acu.cascade_on_change : true,
      notes: acu.notes || null,
    }).onConflictDoNothing();
  }
  logger.info(`Seeded ${(acuSeedData as any[]).length} ACUs`);

  for (const ch of (channelSeedData as any[])) {
    await db.insert(channelsTable).values({
      id: ch.id,
      name: ch.name,
      format: ch.format,
      max_words: ch.max_words || null,
      max_links: ch.max_links || null,
      max_ctas: ch.max_ctas || null,
      max_lines: ch.max_lines || null,
      max_sentences: ch.max_sentences || null,
      max_duration_seconds: ch.max_duration_seconds || null,
      headline_max_chars: ch.headline_max_chars || null,
      body_max_chars: ch.body_max_chars || null,
      subject_max_words: ch.subject_max_words || null,
      subject_max_chars: ch.subject_max_chars || null,
      prohibited: ch.prohibited || [],
      formats: ch.formats || [],
      cta_options: ch.cta_options || [],
      requires_meta_approval: ch.requires_meta_approval || false,
      requires_cta_button: ch.requires_cta_button || false,
      video_thumbnail: ch.video_thumbnail || false,
      from_address: ch.from_address || null,
      goal: ch.goal || null,
      max_objection_responses: ch.max_objection_responses || null,
      notes: ch.notes || null,
    }).onConflictDoNothing();
  }
  logger.info(`Seeded ${(channelSeedData as any[]).length} channels`);

  await db.insert(changelogTable).values({
    id: randomUUID(),
    action: "SYSTEM_INITIALIZED",
    details: "Platform initialized with seed data",
    triggered_by: "system",
  });

  try {
    const acuResult = await seedACURefactor();
    logger.info({ ...acuResult }, "ACU refactor seed complete");
    const tmplResult = await seedTemplates();
    logger.info({ ...tmplResult }, "Template seed complete");
    const promptResult = await seedPrompts();
    logger.info({ ...promptResult }, "Prompt seed complete");
  } catch (err) {
    logger.error({ err }, "Post-seed incremental seed error (non-fatal)");
  }

  logger.info("Database seeded successfully");
}

export function getComplianceConstants() {
  return {
    version: (complianceData as any).version,
    constants: (complianceData as any).constants,
  };
}

export function validateSeedData(): { valid: boolean; errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  const docs = (registryData as any).documents;
  const validStatuses = ["CURRENT", "DRAFT", "SUPERSEDED"];
  const validReviewStates = ["CLEAN", "REQUIRES_REVIEW", "REVIEWED"];
  const validStages = ["Outreach", "Called", "Demo Booked", "Demo Complete", "Decision"];
  const validPersonas = [
    "Growth Seeker", "Preserver", "Legacy Builder",
    "Tax Optimizer", "Portfolio Consolidator", "Yield Seeker",
    "Impact Investor", "Tech-Savvy Self-Director", "Risk-Averse Retiree",
    "Wealth Preserver", "Estate Planner", "Active Trader",
    "Delegator", "Information Gatherer", "Skeptic",
    "Social Proof Seeker", "Deadline-Driven", "Family Wealth Manager", "Institutional Thinker"
  ];

  const docIds = new Set<string>();
  for (const doc of docs) {
    if (docIds.has(doc.id)) {
      errors.push(`Duplicate document ID: ${doc.id}`);
    }
    docIds.add(doc.id);

    if (!validStatuses.includes(doc.lifecycle_status)) {
      errors.push(`Invalid lifecycle_status '${doc.lifecycle_status}' for document ${doc.id}`);
    }
    if (!validReviewStates.includes(doc.review_state)) {
      errors.push(`Invalid review_state '${doc.review_state}' for document ${doc.id}`);
    }
    if (![1, 2, 3].includes(doc.tier)) {
      errors.push(`Invalid tier '${doc.tier}' for document ${doc.id}`);
    }

    for (const dep of (doc.upstream_dependencies || [])) {
      if (!docIds.has(dep) && !docs.find((d: any) => d.id === dep)) {
        errors.push(`Broken upstream dependency: document ${doc.id} references non-existent ${dep}`);
      }
    }

    if (doc.upstream_dependencies?.includes(doc.id)) {
      errors.push(`Self-reference in dependencies for document ${doc.id}`);
    }

    for (const stage of (doc.pipeline_stage_relevance || [])) {
      if (!validStages.includes(stage)) {
        errors.push(`Invalid pipeline_stage_relevance '${stage}' in document ${doc.id}`);
      }
    }
    for (const persona of (doc.persona_relevance || [])) {
      if (!validPersonas.includes(persona)) {
        warnings.push(`Unrecognized persona '${persona}' in document ${doc.id}`);
      }
    }
  }

  const constants = (complianceData as any).constants;
  const requiredKeys = ["bpr_cap", "bpr_effective_date", "vct_relief_rate", "pension_iht_change", "decumulation_planner_status", "access_framework_framing", "product_tagline"];
  for (const key of requiredKeys) {
    if (!constants.find((c: any) => c.key === key)) {
      errors.push(`Missing compliance constant: ${key}`);
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}

export async function getNextBestAction(lead: any): Promise<{ action: string; rationale: string; suggested_documents: string[] }> {
  const stage = lead.pipeline_stage;
  const sentDocIds = ((lead.send_log || []) as any[]).flatMap((s: any) => s.documents_sent || []);

  const allDocs = await db.select().from(documentsTable).orderBy(documentsTable.id);
  const eligible = allDocs.filter(
    (d) => d.lifecycle_status === "CURRENT" && d.review_state === "CLEAN"
  );

  function findUnsent(filter: (d: typeof eligible[0]) => boolean): string[] {
    return eligible
      .filter((d) => filter(d) && !sentDocIds.includes(d.id))
      .map((d) => d.id);
  }

  switch (stage) {
    case "Outreach": {
      const promos = findUnsent((d) =>
        d.category === "investor_docs" && d.type === "PROMO" &&
        (d.pipeline_stage_relevance as string[])?.includes("Outreach")
      );
      if (promos.length > 0) {
        return {
          action: "Call and send one-pager",
          rationale: "First contact — send a promotional overview to introduce Unlock",
          suggested_documents: [promos[0]],
        };
      }
      return {
        action: "Follow up on one-pager",
        rationale: "One-pager sent — follow up to book a call",
        suggested_documents: [],
      };
    }

    case "Called": {
      const promos = findUnsent((d) =>
        d.category === "investor_docs" && d.type === "PROMO" &&
        (d.pipeline_stage_relevance as string[])?.includes("Called")
      );
      if (promos.length > 0) {
        return {
          action: "Book demo and send three-pager",
          rationale: "Post-call follow-up — send detailed promotional material",
          suggested_documents: [promos[0]],
        };
      }
      return {
        action: "Book demo",
        rationale: "Key documents sent — focus on booking the demo",
        suggested_documents: [],
      };
    }

    case "Demo Booked":
      return {
        action: "Confirm attendance and prepare persona-matched talking points",
        rationale: "Demo booked — ensure attendance and prepare personalised content",
        suggested_documents: [],
      };

    case "Demo Complete": {
      const briefs = findUnsent((d) =>
        d.category === "investor_docs" && d.type === "BRIEF" &&
        (d.pipeline_stage_relevance as string[])?.includes("Demo Complete")
      );
      if (briefs.length > 0) {
        return {
          action: "Send Pack 1 with persona cover email",
          rationale: "Demo complete — send the founding investor brief",
          suggested_documents: [briefs[0]],
        };
      }

      if (lead.detected_persona === "Legacy Builder") {
        const planning = findUnsent((d) =>
          d.category === "investor_docs" && d.type === "PLANNING" &&
          (d.pipeline_stage_relevance as string[])?.includes("Demo Complete")
        );
        if (planning.length > 0) {
          return {
            action: "Send IHT planning document",
            rationale: "Legacy Builder persona — IHT planning document directly addresses their concerns",
            suggested_documents: [planning[0]],
          };
        }
      }

      const cases = findUnsent((d) =>
        d.category === "investor_docs" && d.type === "CASE" &&
        (d.pipeline_stage_relevance as string[])?.includes("Demo Complete")
      );
      if (cases.length > 0) {
        return {
          action: "Send EIS case studies",
          rationale: "Follow up with concrete worked examples to support the investment case",
          suggested_documents: [cases[0]],
        };
      }
      return {
        action: "Move to Decision stage",
        rationale: "All key Demo Complete documents sent — advance the conversation",
        suggested_documents: [],
      };
    }

    case "Decision": {
      const memos = findUnsent((d) =>
        d.category === "investor_docs" && d.type === "IIM" &&
        (d.pipeline_stage_relevance as string[])?.includes("Decision")
      );
      if (memos.length > 0) {
        return {
          action: "Send Pack 2 and initiate Instant Investment via SeedLegals",
          rationale: "Decision stage — send the full Information Memorandum",
          suggested_documents: [memos[0]],
        };
      }
      return {
        action: "Close — execute Instant Investment via SeedLegals",
        rationale: "All documents sent — proceed to investment execution",
        suggested_documents: [],
      };
    }

    default:
      return {
        action: "Review lead status",
        rationale: "Unknown pipeline stage — review and update manually",
        suggested_documents: [],
      };
  }
}
