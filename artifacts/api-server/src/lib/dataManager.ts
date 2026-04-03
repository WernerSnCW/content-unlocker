import { db, leadsTable, documentsTable, changelogTable } from "@workspace/db";
import { eq, ilike, and, desc } from "drizzle-orm";
import { randomUUID } from "crypto";
import registryData from "../data/registry.json" with { type: "json" };
import leadsData from "../data/leads.json" with { type: "json" };
import complianceData from "../data/compliance_constants.json" with { type: "json" };
import { logger } from "./logger";

export async function seedDatabase() {
  const existingLeads = await db.select({ id: leadsTable.id }).from(leadsTable).limit(1);
  if (existingLeads.length > 0) {
    logger.info("Database already seeded, skipping");
    return;
  }

  logger.info("Seeding database...");

  for (const doc of (registryData as any).documents) {
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
      content: null,
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

  await db.insert(changelogTable).values({
    id: randomUUID(),
    action: "SYSTEM_INITIALIZED",
    details: "Platform initialized with seed data",
    triggered_by: "system",
  });

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
