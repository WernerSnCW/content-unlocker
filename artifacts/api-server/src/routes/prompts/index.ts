import { Router, type IRouter } from "express";
import { db, systemPromptsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const router: IRouter = Router();

router.get("/prompts", async (_req, res): Promise<void> => {
  const prompts = await db.select().from(systemPromptsTable);
  prompts.sort((a, b) => a.id.localeCompare(b.id));
  res.json(prompts);
});

router.get("/prompts/:id", async (req, res): Promise<void> => {
  const { id } = req.params;
  const [prompt] = await db.select().from(systemPromptsTable).where(eq(systemPromptsTable.id, id));
  if (!prompt) {
    res.status(404).json({ error: "Prompt not found" });
    return;
  }
  res.json(prompt);
});

export default router;
