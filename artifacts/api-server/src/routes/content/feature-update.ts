import { Router, type IRouter } from "express";
import { db, documentsTable, changelogTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { randomUUID } from "crypto";
import { anthropic } from "@workspace/integrations-anthropic-ai";
import { detectPropagationTargets } from "../../lib/propagation";

const router: IRouter = Router();

interface AffectedDocument {
  document_id: string;
  title: string;
  tier: number;
  detection_method: "tier1_propagation" | "semantic_match" | "type_match" | "compliance_match";
  relevance_reason: string;
  review_priority: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
  current_status: string;
}

function highestPriority(
  a: AffectedDocument["review_priority"],
  b: AffectedDocument["review_priority"]
): AffectedDocument["review_priority"] {
  const order = ["CRITICAL", "HIGH", "MEDIUM", "LOW"];
  return order.indexOf(a) <= order.indexOf(b) ? a : b;
}

router.post("/content/feature-update", async (req, res): Promise<void> => {
  try {
    const {
      title,
      description,
      affected_features,
      change_type,
      affects_compliance,
      affects_tier1,
    } = req.body;

    if (!title || !description) {
      res.status(400).json({ error: "title and description are required" });
      return;
    }

    const updateId = `fupd_${randomUUID().slice(0, 8)}`;
    const allDocs = await db.select().from(documentsTable);
    const docMap = new Map<string, AffectedDocument>();

    function addOrMerge(doc: AffectedDocument) {
      const existing = docMap.get(doc.document_id);
      if (existing) {
        existing.review_priority = highestPriority(existing.review_priority, doc.review_priority);
        if (!existing.relevance_reason.includes(doc.relevance_reason)) {
          existing.relevance_reason += `; ${doc.relevance_reason}`;
        }
        if (existing.detection_method !== doc.detection_method) {
          (existing as any).detection_methods = (existing as any).detection_methods || [existing.detection_method];
          if (!(existing as any).detection_methods.includes(doc.detection_method)) {
            (existing as any).detection_methods.push(doc.detection_method);
          }
        }
      } else {
        (doc as any).detection_methods = [doc.detection_method];
        docMap.set(doc.document_id, doc);
      }
    }

    if (affects_tier1) {
      const tier1Docs = allDocs.filter((d) => d.tier === 1);
      for (const t1 of tier1Docs) {
        addOrMerge({
          document_id: t1.id,
          title: t1.name,
          tier: t1.tier,
          detection_method: "tier1_propagation",
          relevance_reason: `Tier 1 document directly affected by feature update: ${title}`,
          review_priority: "CRITICAL",
          current_status: t1.review_state,
        });

        const targets = await detectPropagationTargets(t1.id);

        for (const target of targets) {
          const priority = target.cascade_level === "direct" ? "HIGH" as const : "MEDIUM" as const;
          addOrMerge({
            document_id: target.document_id,
            title: target.title,
            tier: target.tier,
            detection_method: "tier1_propagation",
            relevance_reason: target.cascade_level === "direct"
              ? `Direct dependent of Tier 1 document "${t1.name}"`
              : `Second-order dependent via Tier 1 document "${t1.name}"`,
            review_priority: priority,
            current_status: target.pre_flag_review_state,
          });
        }
      }
    }

    if (affects_compliance) {
      const complianceDocs = allDocs.filter((d) => {
        const typeNorm = d.type.toLowerCase();
        return (
          typeNorm.includes("compliance") ||
          typeNorm.includes("risk") ||
          typeNorm.includes("legal") ||
          typeNorm.includes("pricing") ||
          typeNorm.includes("terms")
        );
      });
      for (const cd of complianceDocs) {
        addOrMerge({
          document_id: cd.id,
          title: cd.name,
          tier: cd.tier,
          detection_method: "type_match",
          relevance_reason: `Compliance/pricing document automatically flagged due to compliance-affecting change`,
          review_priority: "CRITICAL",
          current_status: cd.review_state,
        });
      }

      if (affected_features && affected_features.length > 0) {
        for (const doc of allDocs) {
          if (docMap.has(doc.id)) continue;
          const content = (doc.content || "").toLowerCase();
          const desc = (doc.description || "").toLowerCase();
          for (const feature of affected_features) {
            const featureLower = feature.toLowerCase();
            if (content.includes(featureLower) || desc.includes(featureLower)) {
              addOrMerge({
                document_id: doc.id,
                title: doc.name,
                tier: doc.tier,
                detection_method: "compliance_match",
                relevance_reason: `Document references "${feature}" which was affected by this compliance change`,
                review_priority: "HIGH",
                current_status: doc.review_state,
              });
              break;
            }
          }
        }
      }
    }

    try {
      const docSummaries = allDocs
        .filter((d) => !docMap.has(d.id))
        .map(
          (d) =>
            `ID: ${d.id} | Title: ${d.name} | Type: ${d.type} | Tier: ${d.tier} | Description: ${d.description?.slice(0, 100) || "N/A"}`
        )
        .join("\n");

      if (docSummaries.length > 0) {
        const semanticMessage = await anthropic.messages.create({
          model: "claude-sonnet-4-6",
          max_tokens: 4096,
          messages: [
            {
              role: "user",
              content: `You are analysing a document registry for Unlock, a UK portfolio intelligence platform.

A feature update has been submitted:
TITLE: ${title}
DESCRIPTION: ${description}
AFFECTED FEATURES: ${(affected_features || []).join(", ")}
CHANGE TYPE: ${change_type || "modification"}

The following documents have NOT yet been flagged by other detection methods. Identify which of these documents are semantically related to this feature change.

DOCUMENTS:
${docSummaries.slice(0, 6000)}

For each document that IS affected, return its ID and a specific reason. Only include HIGH or MEDIUM confidence matches. Exclude anything with LOW confidence.

Return ONLY valid JSON:
{
  "matches": [
    {
      "document_id": "<id>",
      "confidence": "HIGH" | "MEDIUM",
      "reason": "<specific reason this document is affected>"
    }
  ]
}

Return ONLY the JSON. If no documents are affected, return {"matches": []}.`,
            },
          ],
        });

        const semBlock = semanticMessage.content[0];
        const semText = semBlock.type === "text" ? semBlock.text : "";

        let semanticResult;
        try {
          const cleaned = semText.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
          semanticResult = JSON.parse(cleaned);
        } catch {
          semanticResult = { matches: [] };
        }

        for (const match of semanticResult.matches || []) {
          const doc = allDocs.find((d) => d.id === match.document_id);
          if (!doc) continue;
          addOrMerge({
            document_id: doc.id,
            title: doc.name,
            tier: doc.tier,
            detection_method: "semantic_match",
            relevance_reason: match.reason,
            review_priority: match.confidence === "HIGH" ? "HIGH" : "MEDIUM",
            current_status: doc.review_state,
          });
        }
      }
    } catch (err: any) {
      req.log.warn({ err }, "Semantic match failed, continuing with other methods");
    }

    const affectedDocs = Array.from(docMap.values());

    const priorityOrder = ["CRITICAL", "HIGH", "MEDIUM", "LOW"];
    affectedDocs.sort((a, b) => {
      const pa = priorityOrder.indexOf(a.review_priority);
      const pb = priorityOrder.indexOf(b.review_priority);
      if (pa !== pb) return pa - pb;
      return a.tier - b.tier;
    });

    const reviewQueue = affectedDocs.map((d) => d.document_id);

    for (const ad of affectedDocs) {
      await db
        .update(documentsTable)
        .set({ review_state: "REQUIRES_REVIEW" })
        .where(eq(documentsTable.id, ad.document_id));

      await db.insert(changelogTable).values({
        id: randomUUID(),
        action: "FLAGGED_FOR_FEATURE_UPDATE",
        document_id: ad.document_id,
        details: `Feature update "${title}" (${updateId}): ${ad.relevance_reason}`,
        triggered_by: "feature_update_engine",
      });
    }

    const parentChangelogId = randomUUID();
    await db.insert(changelogTable).values({
      id: parentChangelogId,
      action: "FEATURE_UPDATE_SUBMITTED",
      details: `Feature update: ${title}. ${description}. ${affectedDocs.length} documents affected.`,
      triggered_by: "feature_update_engine",
    });

    const criticalCount = affectedDocs.filter(
      (d) => d.review_priority === "CRITICAL"
    ).length;
    const highCount = affectedDocs.filter(
      (d) => d.review_priority === "HIGH"
    ).length;

    res.json({
      update_id: updateId,
      affected_documents: affectedDocs.map((d) => ({
        ...d,
        detection_methods: (d as any).detection_methods || [d.detection_method],
      })),
      review_queue: reviewQueue,
      summary: {
        total_affected: affectedDocs.length,
        critical_count: criticalCount,
        high_count: highCount,
        changelog_entry_id: parentChangelogId,
      },
    });
  } catch (err: any) {
    req.log.error({ err }, "Feature update processing failed");
    res.status(500).json({ error: "Feature update processing failed" });
  }
});

router.get("/content/feature-update/:updateId/queue", async (req, res): Promise<void> => {
  try {
    const { updateId } = req.params;

    const entries = await db.select().from(changelogTable);
    const flagEntries = entries.filter(
      (e) =>
        e.action === "FLAGGED_FOR_FEATURE_UPDATE" &&
        e.details?.includes(updateId)
    );

    const docIds = flagEntries
      .map((e) => e.document_id)
      .filter(Boolean) as string[];
    const uniqueIds = [...new Set(docIds)];

    const docs = await db.select().from(documentsTable);
    const pendingDocs = docs.filter(
      (d) => uniqueIds.includes(d.id) && d.review_state === "REQUIRES_REVIEW"
    );
    const completedDocs = docs.filter(
      (d) => uniqueIds.includes(d.id) && d.review_state !== "REQUIRES_REVIEW"
    );

    res.json({
      update_id: updateId,
      total: uniqueIds.length,
      pending: pendingDocs.length,
      completed: completedDocs.length,
      pending_documents: pendingDocs.map((d) => ({
        id: d.id,
        name: d.name,
        tier: d.tier,
        type: d.type,
        review_state: d.review_state,
        lifecycle_status: d.lifecycle_status,
      })),
      completed_documents: completedDocs.map((d) => ({
        id: d.id,
        name: d.name,
        tier: d.tier,
        type: d.type,
        review_state: d.review_state,
        lifecycle_status: d.lifecycle_status,
      })),
    });
  } catch (err: any) {
    req.log.error({ err }, "Queue retrieval failed");
    res.status(500).json({ error: "Queue retrieval failed" });
  }
});

export default router;
