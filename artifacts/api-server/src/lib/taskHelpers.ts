import { PropagationTarget } from "./propagation";
import { db, tasksTable, changelogTable } from "@workspace/db";
import { eq, and, ne } from "drizzle-orm";
import { randomUUID } from "crypto";

export async function createReviewTasksForPropagation(targets: PropagationTarget[]): Promise<void> {
  for (const target of targets) {
    try {
      const existing = await db
        .select()
        .from(tasksTable)
        .where(
          and(
            eq(tasksTable.linked_document_id, target.document_id),
            eq(tasksTable.type, "Review"),
            ne(tasksTable.status, "Done")
          )
        );

      if (existing.length > 0) continue;

      await db.insert(tasksTable).values({
        id: randomUUID(),
        title: "Review: " + target.title,
        status: "Open",
        type: "Review",
        linked_document_id: target.document_id,
      });

      await db.insert(changelogTable).values({
        id: randomUUID(),
        action: "TASK_CREATED",
        document_id: target.document_id,
        details: "Review task auto-created: " + target.title,
        triggered_by: "propagation",
      });
    } catch (err) {
      console.error("taskHelpers: failed to create review task for document", target.document_id, err);
    }
  }
}
