import { Router, type IRouter } from "express";
import { db, videosTable, changelogTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { randomUUID } from "crypto";

const router: IRouter = Router();

router.get("/videos", async (_req, res): Promise<void> => {
  const videos = await db.select().from(videosTable);
  const current = videos.filter(v => v.lifecycle_status === "CURRENT");
  res.json(current);
});

router.post("/videos", async (req, res): Promise<void> => {
  try {
    const {
      id,
      title,
      description,
      script_content,
      duration_seconds,
      format,
      send_method,
      persona_relevance,
      stage_relevance,
      objections_addressed,
    } = req.body;

    if (!title || !description) {
      res.status(400).json({ error: "title and description are required" });
      return;
    }

    const videoId = id || `vid_${randomUUID().substring(0, 8)}`;
    const now = new Date().toISOString();

    const [video] = await db
      .insert(videosTable)
      .values({
        id: videoId,
        title,
        description,
        script_content: script_content || null,
        duration_seconds: duration_seconds || null,
        format: format || "portrait_mp4",
        send_method: send_method || "whatsapp",
        persona_relevance: persona_relevance || [],
        stage_relevance: stage_relevance || [],
        objections_addressed: objections_addressed || [],
        lifecycle_status: "DRAFT",
        review_state: "REQUIRES_REVIEW",
        created_at: now,
        updated_at: now,
      })
      .returning();

    await db.insert(changelogTable).values({
      id: randomUUID(),
      action: "VIDEO_CREATED",
      document_id: videoId,
      details: `Video created: ${title}`,
      triggered_by: "agent",
    });

    res.status(201).json(video);
  } catch (err: any) {
    res.status(500).json({ error: "Failed to create video", message: err.message });
  }
});

router.get("/videos/:id", async (req, res): Promise<void> => {
  const [video] = await db.select().from(videosTable).where(eq(videosTable.id, req.params.id));
  if (!video) {
    res.status(404).json({ error: "Video not found" });
    return;
  }
  res.json(video);
});

router.patch("/videos/:id", async (req, res): Promise<void> => {
  const [existing] = await db.select().from(videosTable).where(eq(videosTable.id, req.params.id));
  if (!existing) {
    res.status(404).json({ error: "Video not found" });
    return;
  }

  const updates: any = { updated_at: new Date().toISOString() };

  const allowedFields = [
    "title", "description", "script_content", "duration_seconds",
    "format", "send_method", "persona_relevance", "stage_relevance",
    "objections_addressed", "lifecycle_status", "review_state",
  ];

  for (const field of allowedFields) {
    if (req.body[field] !== undefined) {
      updates[field] = req.body[field];
    }
  }

  const [video] = await db
    .update(videosTable)
    .set(updates)
    .where(eq(videosTable.id, req.params.id))
    .returning();

  res.json(video);
});

router.post("/videos/:id/promote", async (req, res): Promise<void> => {
  const [existing] = await db.select().from(videosTable).where(eq(videosTable.id, req.params.id));
  if (!existing) {
    res.status(404).json({ error: "Video not found" });
    return;
  }

  const [video] = await db
    .update(videosTable)
    .set({
      lifecycle_status: "CURRENT",
      updated_at: new Date().toISOString(),
    })
    .where(eq(videosTable.id, req.params.id))
    .returning();

  await db.insert(changelogTable).values({
    id: randomUUID(),
    action: "VIDEO_PROMOTED",
    document_id: req.params.id,
    details: `Video promoted to CURRENT: ${video.title}`,
    triggered_by: "agent",
  });

  res.json(video);
});

export default router;
