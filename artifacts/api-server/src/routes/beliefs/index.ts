import { Router, type IRouter } from "express";
import { db, beliefRegistryTable } from "@workspace/db";
import { asc } from "drizzle-orm";

const router: IRouter = Router();

router.get("/beliefs", async (_req, res): Promise<void> => {
  try {
    const beliefs = await db
      .select()
      .from(beliefRegistryTable)
      .orderBy(asc(beliefRegistryTable.id));

    res.json({ beliefs });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch beliefs" });
  }
});

export default router;
