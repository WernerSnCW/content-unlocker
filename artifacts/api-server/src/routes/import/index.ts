import { Router } from "express";
import multer from "multer";
import { randomUUID } from "crypto";
import { eq, ne, and, desc } from "drizzle-orm";
import { db, importSessionsTable, documentsTable, changelogTable } from "@workspace/db";
import { parseImportFile, computeFileHash } from "../../lib/importParser";

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

router.get("/import", async (_req, res) => {
  try {
    const sessions = await db
      .select()
      .from(importSessionsTable)
      .orderBy(desc(importSessionsTable.created_at))
      .limit(20);
    res.json({ sessions });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/import/parse", (req, res, next) => {
  upload.single("file")(req, res, (err: any) => {
    if (err) {
      if (err.code === "LIMIT_FILE_SIZE") {
        res.status(413).json({ error: "File exceeds 10MB limit" });
        return;
      }
      res.status(400).json({ error: err.message });
      return;
    }
    next();
  });
}, async (req, res): Promise<void> => {
  try {
    if (!req.file) {
      res.status(400).json({ error: "No file uploaded" });
      return;
    }

    const originalName = req.file.originalname || "";
    if (!originalName.toLowerCase().endsWith(".md")) {
      res.status(400).json({ error: "Only .md files are accepted" });
      return;
    }

    const fileContent = req.file.buffer.toString("utf-8");
    const fileHash = computeFileHash(fileContent);

    const existing = await db
      .select()
      .from(importSessionsTable)
      .where(
        and(
          eq(importSessionsTable.file_hash, fileHash),
          ne(importSessionsTable.status, "FAILED")
        )
      )
      .limit(1);

    if (existing.length > 0) {
      res.status(409).json({
        error: "This file has already been imported",
        existing_session_id: existing[0].id,
      });
      return;
    }

    const parsed = parseImportFile(fileContent);
    const sessionId = randomUUID();

    const storedBlocks = parsed.blocks.map((b) => ({
      index: b.index,
      destination: b.destination,
      action: b.action,
      id: b.id,
      key: b.key,
      title: b.title,
      output_type: b.output_type,
      tier: b.tier,
      category: b.category,
      lifecycle_status: b.lifecycle_status,
      send_status: b.send_status,
      content: b.content,
      status: b.status,
      error: b.error,
    }));

    await db.insert(importSessionsTable).values({
      id: sessionId,
      file_name: originalName,
      file_hash: fileHash,
      status: "PARSED",
      total_blocks: parsed.totalBlocks,
      valid_blocks: parsed.validBlocks,
      rejected_blocks: parsed.rejectedBlocks,
      executed_blocks: 0,
      failed_blocks: 0,
      block_results: storedBlocks,
    });

    res.json({
      session_id: sessionId,
      file_name: originalName,
      file_hash: fileHash,
      file_header: parsed.fileHeader,
      total_blocks: parsed.totalBlocks,
      valid_blocks: parsed.validBlocks,
      rejected_blocks: parsed.rejectedBlocks,
      blocks: parsed.blocks,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/import/:session_id", async (req, res): Promise<void> => {
  try {
    const rows = await db
      .select()
      .from(importSessionsTable)
      .where(eq(importSessionsTable.id, req.params.session_id))
      .limit(1);

    if (rows.length === 0) {
      res.status(404).json({ error: "Session not found" });
      return;
    }
    res.json(rows[0]);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/import/:session_id/execute", async (req, res): Promise<void> => {
  try {
    const { confirmed } = req.body;
    if (confirmed !== true) {
      res.status(400).json({ error: "Execution must be explicitly confirmed with { confirmed: true }" });
      return;
    }

    const rows = await db
      .select()
      .from(importSessionsTable)
      .where(eq(importSessionsTable.id, req.params.session_id))
      .limit(1);

    if (rows.length === 0) {
      res.status(404).json({ error: "Session not found" });
      return;
    }

    const session = rows[0];

    if (session.status !== "PARSED") {
      res.status(409).json({
        error: `Session status is ${session.status}, expected PARSED`,
        status: session.status,
      });
      return;
    }

    await db
      .update(importSessionsTable)
      .set({ status: "EXECUTING" })
      .where(eq(importSessionsTable.id, session.id));

    const blockResults: any[] = (session.block_results as any[]) || [];
    const validBlocks = blockResults.filter((b: any) => b.status === "VALID");

    let executedCount = 0;
    let failedCount = 0;
    const updatedResults = [...blockResults];

    for (const block of validBlocks) {
      const blockIndex = block.index as number;
      const content = (block.content as string) || "";
      const action = block.action as string;
      const title = (block.title as string) || "Untitled Import";

      try {
        if (action === "create") {
          const newId = randomUUID();
          const now = new Date().toISOString().split("T")[0];

          await db.insert(documentsTable).values({
            id: newId,
            file_code: `IMPORT_${newId.substring(0, 8).toUpperCase()}`,
            type: "imported",
            name: title,
            filename: `import_${newId.substring(0, 8)}.md`,
            tier: block.tier ?? 3,
            category: block.category || "imported",
            lifecycle_status: block.lifecycle_status || "DRAFT",
            review_state: "CLEAN",
            version: 1,
            last_reviewed: now,
            description: title,
            pipeline_stage_relevance: [],
            persona_relevance: [],
            upstream_dependencies: [],
            downstream_dependents: [],
            is_generated: false,
            source_trace: [],
            content: content,
            qc_history: [],
            output_type: block.output_type || "whitepaper",
          });

          await db.insert(changelogTable).values({
            id: randomUUID(),
            action: "DOCUMENT_IMPORTED",
            document_id: newId,
            details: JSON.stringify({ title, source: "import", session_id: session.id }),
            triggered_by: "import",
          });

          const idx = updatedResults.findIndex((r: any) => r.index === blockIndex);
          if (idx !== -1) updatedResults[idx] = { ...updatedResults[idx], status: "EXECUTED" };
          executedCount++;
        } else if (action === "update") {
          let targetDoc: any = null;

          if (block.id) {
            const docs = await db.select().from(documentsTable).where(eq(documentsTable.id, block.id)).limit(1);
            targetDoc = docs[0] || null;
          } else if (block.key) {
            let docs = await db.select().from(documentsTable).where(eq(documentsTable.file_code, block.key)).limit(1);
            if (docs.length === 0) {
              docs = await db.select().from(documentsTable).where(eq(documentsTable.name, block.key));
              if (docs.length > 1) {
                const idx = updatedResults.findIndex((r: any) => r.index === blockIndex);
                if (idx !== -1) updatedResults[idx] = { ...updatedResults[idx], status: "FAILED", error: "Ambiguous key match — use id instead" };
                failedCount++;
                continue;
              }
              targetDoc = docs[0] || null;
            } else {
              targetDoc = docs[0];
            }
          }

          if (!targetDoc) {
            const identifier = block.id || block.key || "(no identifier)";
            const idx = updatedResults.findIndex((r: any) => r.index === blockIndex);
            if (idx !== -1) updatedResults[idx] = { ...updatedResults[idx], status: "FAILED", error: `Document not found: ${identifier}` };
            failedCount++;
            continue;
          }

          await db.update(documentsTable)
            .set({ content: content })
            .where(eq(documentsTable.id, targetDoc.id));

          await db.insert(changelogTable).values({
            id: randomUUID(),
            action: "DOCUMENT_UPDATED_VIA_IMPORT",
            document_id: targetDoc.id,
            details: JSON.stringify({ title: targetDoc.name, session_id: session.id }),
            triggered_by: "import",
          });

          const idx = updatedResults.findIndex((r: any) => r.index === blockIndex);
          if (idx !== -1) updatedResults[idx] = { ...updatedResults[idx], status: "EXECUTED" };
          executedCount++;
        }
      } catch (blockErr: any) {
        const idx = updatedResults.findIndex((r: any) => r.index === blockIndex);
        if (idx !== -1) updatedResults[idx] = { ...updatedResults[idx], status: "FAILED", error: blockErr.message };
        failedCount++;
      }
    }

    let finalStatus = "COMPLETE";
    if (executedCount === 0 && failedCount > 0) finalStatus = "FAILED";
    else if (failedCount > 0 && executedCount > 0) finalStatus = "PARTIAL";

    await db
      .update(importSessionsTable)
      .set({
        status: finalStatus,
        executed_blocks: executedCount,
        failed_blocks: failedCount,
        block_results: updatedResults,
        completed_at: new Date(),
      })
      .where(eq(importSessionsTable.id, session.id));

    res.json({
      session_id: session.id,
      status: finalStatus,
      executed_blocks: executedCount,
      failed_blocks: failedCount,
      block_results: updatedResults,
    });
  } catch (err: any) {
    await db
      .update(importSessionsTable)
      .set({ status: "FAILED", completed_at: new Date() })
      .where(eq(importSessionsTable.id, req.params.session_id))
      .catch(() => {});
    res.status(500).json({ error: err.message });
  }
});

export default router;
