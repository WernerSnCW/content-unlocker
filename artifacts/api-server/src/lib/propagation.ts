import { db, documentsTable, changelogTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { randomUUID } from "crypto";

export interface PropagationTarget {
  document_id: string;
  title: string;
  tier: number;
  cascade_level: "direct" | "second_order";
  pre_flag_review_state: string;
}

export interface PropagationResult {
  flagged_document_ids: string[];
  changelog_entry_ids: string[];
  targets: PropagationTarget[];
}

export async function detectPropagationTargets(
  sourceDocId: string
): Promise<PropagationTarget[]> {
  const [sourceDoc] = await db
    .select()
    .from(documentsTable)
    .where(eq(documentsTable.id, sourceDocId));

  if (!sourceDoc) {
    return [];
  }

  const allDocs = await db.select().from(documentsTable);
  const targets: PropagationTarget[] = [];
  const seen = new Set<string>();

  const directDependents = allDocs.filter((d) =>
    (d.upstream_dependencies as string[])?.includes(sourceDocId)
  );

  for (const dep of directDependents) {
    if (seen.has(dep.id)) continue;
    seen.add(dep.id);
    targets.push({
      document_id: dep.id,
      title: dep.name,
      tier: dep.tier,
      cascade_level: "direct",
      pre_flag_review_state: dep.review_state,
    });

    if (sourceDoc.tier === 1) {
      const tier3Deps = allDocs.filter(
        (d) =>
          (d.upstream_dependencies as string[])?.includes(dep.id) &&
          d.tier === 3
      );
      for (const t3 of tier3Deps) {
        if (!seen.has(t3.id)) {
          seen.add(t3.id);
          targets.push({
            document_id: t3.id,
            title: t3.name,
            tier: t3.tier,
            cascade_level: "second_order",
            pre_flag_review_state: t3.review_state,
          });
        }
      }
    }
  }

  return targets;
}

export async function propagateFromDocument(
  sourceDocId: string,
  triggeredBy: string
): Promise<PropagationResult> {
  const targets = await detectPropagationTargets(sourceDocId);
  const flagged: string[] = [];
  const changelogEntries: string[] = [];

  for (const target of targets) {
    await db
      .update(documentsTable)
      .set({ review_state: "REQUIRES_REVIEW" })
      .where(eq(documentsTable.id, target.document_id));
    flagged.push(target.document_id);

    const entryId = randomUUID();
    const details =
      target.cascade_level === "direct"
        ? `Flagged for review due to update in upstream document ${sourceDocId}`
        : `Flagged for review (cascade from Tier 1 update: ${sourceDocId} → indirect → ${target.document_id})`;

    await db.insert(changelogTable).values({
      id: entryId,
      action: "FLAGGED_FOR_REVIEW",
      document_id: target.document_id,
      details,
      triggered_by: triggeredBy,
    });
    changelogEntries.push(entryId);
  }

  return {
    flagged_document_ids: flagged,
    changelog_entry_ids: changelogEntries,
    targets,
  };
}
