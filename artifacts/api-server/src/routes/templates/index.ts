import { Router, type IRouter } from "express";
import { db, outputTemplatesTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const router: IRouter = Router();

router.get("/templates", async (_req, res): Promise<void> => {
  const templates = await db.select().from(outputTemplatesTable);
  templates.sort((a, b) => a.name.localeCompare(b.name));
  res.json(templates);
});

router.get("/templates/:id", async (req, res): Promise<void> => {
  const { id } = req.params;
  const [template] = await db.select().from(outputTemplatesTable).where(eq(outputTemplatesTable.id, id));
  if (!template) {
    res.status(404).json({ error: "Template not found" });
    return;
  }

  let composedSections = template.sections as any[];
  if (template.parent_template_id) {
    const [parent] = await db.select().from(outputTemplatesTable).where(eq(outputTemplatesTable.id, template.parent_template_id));
    if (parent) {
      composedSections = [...(composedSections || []), ...(parent.sections as any[])];
    }
  }

  res.json({ ...template, composed_sections: composedSections });
});

export default router;
