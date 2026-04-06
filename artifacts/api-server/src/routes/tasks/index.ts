import { Router } from "express";
import { randomUUID } from "crypto";
import { eq, ne, asc } from "drizzle-orm";
import { db, tasksTable, documentsTable, changelogTable } from "@workspace/db";

const router = Router();

const VALID_STATUSES = ["Open", "In Progress", "Done"];
const VALID_TYPES = ["Review", "Build", "Import", "General"];

router.get("/tasks", async (_req, res): Promise<void> => {
  try {
    const rows = await db
      .select({
        id: tasksTable.id,
        title: tasksTable.title,
        status: tasksTable.status,
        type: tasksTable.type,
        linked_document_id: tasksTable.linked_document_id,
        linked_document_name: documentsTable.name,
        created_at: tasksTable.created_at,
        updated_at: tasksTable.updated_at,
      })
      .from(tasksTable)
      .leftJoin(documentsTable, eq(documentsTable.id, tasksTable.linked_document_id))
      .orderBy(asc(tasksTable.created_at));

    res.json({ tasks: rows });
  } catch (err: any) {
    res.status(500).json({ error: "Failed to fetch tasks" });
  }
});

router.post("/tasks", async (req, res): Promise<void> => {
  try {
    const { title, type, linked_document_id } = req.body;

    if (!title || typeof title !== "string" || title.trim() === "") {
      res.status(400).json({ error: "title is required" });
      return;
    }

    const taskType = type || "General";
    if (!VALID_TYPES.includes(taskType)) {
      res.status(400).json({ error: "Invalid type" });
      return;
    }

    const id = randomUUID();
    const [task] = await db
      .insert(tasksTable)
      .values({
        id,
        title: title.trim(),
        status: "Open",
        type: taskType,
        linked_document_id: linked_document_id || null,
      })
      .returning();

    await db.insert(changelogTable).values({
      id: randomUUID(),
      action: "TASK_CREATED",
      details: `Task created: ${title.trim()}`,
      triggered_by: "operator",
    });

    res.status(201).json(task);
  } catch (err: any) {
    res.status(500).json({ error: "Failed to create task" });
  }
});

router.get("/tasks/summary", async (_req, res): Promise<void> => {
  try {
    const openTasks = await db
      .select({
        id: tasksTable.id,
        title: tasksTable.title,
        status: tasksTable.status,
        type: tasksTable.type,
        linked_document_id: tasksTable.linked_document_id,
        linked_document_name: documentsTable.name,
        created_at: tasksTable.created_at,
        updated_at: tasksTable.updated_at,
      })
      .from(tasksTable)
      .leftJoin(documentsTable, eq(documentsTable.id, tasksTable.linked_document_id))
      .where(ne(tasksTable.status, "Done"))
      .orderBy(asc(tasksTable.created_at));

    const top_tasks = openTasks.slice(0, 3);

    res.json({ open_count: openTasks.length, top_tasks });
  } catch (err: any) {
    res.status(500).json({ error: "Failed to fetch task summary" });
  }
});

router.patch("/tasks/:id", async (req, res): Promise<void> => {
  try {
    const { id } = req.params;
    const { status, title, type } = req.body;

    if (status !== undefined && !VALID_STATUSES.includes(status)) {
      res.status(400).json({ error: "Invalid status" });
      return;
    }

    if (type !== undefined && !VALID_TYPES.includes(type)) {
      res.status(400).json({ error: "Invalid type" });
      return;
    }

    const existing = await db.select().from(tasksTable).where(eq(tasksTable.id, id));
    if (existing.length === 0) {
      res.status(404).json({ error: "Task not found" });
      return;
    }

    const updates: Record<string, any> = {};
    if (status !== undefined) updates.status = status;
    if (title !== undefined) updates.title = title;
    if (type !== undefined) updates.type = type;

    const [updated] = await db
      .update(tasksTable)
      .set(updates)
      .where(eq(tasksTable.id, id))
      .returning();

    if (updated.status === "Done" && updated.type === "Review" && updated.linked_document_id) {
      await db.update(documentsTable)
        .set({ review_state: "CLEAN" })
        .where(eq(documentsTable.id, updated.linked_document_id));
    }

    await db.insert(changelogTable).values({
      id: randomUUID(),
      action: "TASK_UPDATED",
      details: `Task updated: ${updated.title}`,
      triggered_by: "operator",
    });

    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ error: "Failed to update task" });
  }
});

router.delete("/tasks/:id", async (req, res): Promise<void> => {
  try {
    const { id } = req.params;

    const existing = await db.select().from(tasksTable).where(eq(tasksTable.id, id));
    if (existing.length === 0) {
      res.status(404).json({ error: "Task not found" });
      return;
    }

    const taskTitle = existing[0].title;

    await db.delete(tasksTable).where(eq(tasksTable.id, id));

    await db.insert(changelogTable).values({
      id: randomUUID(),
      action: "TASK_DELETED",
      details: `Task deleted: ${taskTitle}`,
      triggered_by: "operator",
    });

    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: "Failed to delete task" });
  }
});

export default router;
