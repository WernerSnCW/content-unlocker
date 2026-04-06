import { Router } from "express";
import { db, workQueueSessionsTable } from "@workspace/db";
import { desc, notInArray } from "drizzle-orm";

const router = Router();

router.get("/work-queue/status", async (_req, res) => {
  try {
    const [session] = await db
      .select()
      .from(workQueueSessionsTable)
      .where(notInArray(workQueueSessionsTable.status, ["COMPLETE", "FAILED"]))
      .orderBy(desc(workQueueSessionsTable.started_at))
      .limit(1);

    if (session) {
      return res.json({
        session,
        findings_ready: session.status === "READY" || session.status === "COMPLETE",
      });
    }

    return res.json({ session: null, findings_ready: false });
  } catch (error) {
    console.error("Failed to fetch queue status:", error);
    return res.status(500).json({ error: "Failed to fetch queue status" });
  }
});

export default router;
