import { Router } from "express";
import { randomUUID } from "crypto";
import { eq, desc } from "drizzle-orm";
import { db, leadsTable, changelogTable, sheetSyncSessionsTable } from "@workspace/db";
import { ReplitConnectors } from "@replit/connectors-sdk";
import { fuzzyMatchLeads } from "../../lib/fuzzyMatch";

const connectors = new ReplitConnectors();
const router = Router();

router.post("/sync", async (req, res): Promise<void> => {
  const { sheet_url } = req.body || {};

  if (!sheet_url || typeof sheet_url !== "string" || !sheet_url.startsWith("https://docs.google.com/spreadsheets/")) {
    res.status(400).json({ error: "Invalid Google Sheet URL" });
    return;
  }

  const spreadsheetMatch = sheet_url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (!spreadsheetMatch) {
    res.status(400).json({ error: "Could not extract spreadsheet ID from URL" });
    return;
  }
  const spreadsheetId = spreadsheetMatch[1];

  const sessionId = randomUUID();
  await db.insert(sheetSyncSessionsTable).values({
    id: sessionId,
    sheet_url,
    status: "RUNNING",
  });

  try {
    const sheetResp = await connectors.proxy(
      "google-drive",
      `/v4/spreadsheets/${spreadsheetId}/values/Sheet1`,
      { method: "GET" }
    );

    if (!sheetResp.ok) {
      const errText = await sheetResp.text();
      await db.update(sheetSyncSessionsTable)
        .set({ status: "FAILED", error_message: `Sheet read failed: ${errText}`, completed_at: new Date() })
        .where(eq(sheetSyncSessionsTable.id, sessionId));
      res.status(502).json({ error: "Could not read Google Sheet", session_id: sessionId });
      return;
    }

    const sheetData = await sheetResp.json();
    const rows: string[][] = sheetData.values || [];

    if (rows.length <= 1) {
      await db.update(sheetSyncSessionsTable)
        .set({ status: "COMPLETE", rows_found: 0, completed_at: new Date() })
        .where(eq(sheetSyncSessionsTable.id, sessionId));
      res.json({
        session_id: sessionId,
        status: "COMPLETE",
        rows_found: 0,
        leads_created: 0,
        leads_updated: 0,
        leads_skipped: 0,
        rows_failed: 0,
      });
      return;
    }

    const dataRows = rows.slice(1);
    const allLeads = await db.select().from(leadsTable);

    let leadsCreated = 0;
    let leadsUpdated = 0;
    let leadsSkipped = 0;
    let rowsFailed = 0;

    for (const row of dataRows) {
      const leadName = row[0]?.trim();
      const transcriptText = row[1]?.trim();

      if (!leadName || !transcriptText) {
        rowsFailed++;
        continue;
      }

      try {
        const matches = fuzzyMatchLeads(leadName, allLeads);
        const topMatch = matches.length > 0 && matches[0].confidence >= 0.4 ? matches[0] : null;

        if (topMatch) {
          const matchedLead = allLeads.find((l) => l.id === topMatch.lead_id);

          if (matchedLead && matchedLead.transcript_text) {
            leadsSkipped++;
          } else if (matchedLead) {
            await db.update(leadsTable)
              .set({ transcript_text: transcriptText, updated_at: new Date() })
              .where(eq(leadsTable.id, matchedLead.id));

            matchedLead.transcript_text = transcriptText;

            await db.insert(changelogTable).values({
              id: randomUUID(),
              action: "TRANSCRIPT_SYNCED_FROM_SHEET",
              lead_id: matchedLead.id,
              details: `Transcript synced from Google Sheet for "${matchedLead.name}" (${transcriptText.length} chars)`,
              triggered_by: "sheet_sync",
            });

            leadsUpdated++;
          }
        } else {
          const now = new Date().toISOString().split("T")[0];
          const newId = `lead_${randomUUID().slice(0, 8)}`;

          const [newLead] = await db.insert(leadsTable).values({
            id: newId,
            name: leadName,
            source: "sheet_sync",
            transcript_text: transcriptText,
            pipeline_stage: "Outreach",
            first_contact: now,
            last_contact: now,
            archived: false,
            send_log: [],
            stage_history: [{ stage: "Outreach", date: now, logged_by: "system" }],
            notes: [],
          }).returning();

          allLeads.push(newLead);

          await db.insert(changelogTable).values({
            id: randomUUID(),
            action: "LEAD_CREATED_FROM_SHEET",
            lead_id: newId,
            details: `Lead "${leadName}" created from Google Sheet sync with transcript (${transcriptText.length} chars)`,
            triggered_by: "sheet_sync",
          });

          leadsCreated++;
        }
      } catch {
        rowsFailed++;
      }
    }

    let finalStatus = "COMPLETE";
    if (leadsCreated === 0 && leadsUpdated === 0 && leadsSkipped === 0 && rowsFailed > 0) {
      finalStatus = "FAILED";
    } else if (rowsFailed > 0) {
      finalStatus = "PARTIAL";
    }

    await db.update(sheetSyncSessionsTable)
      .set({
        status: finalStatus,
        rows_found: dataRows.length,
        leads_created: leadsCreated,
        leads_updated: leadsUpdated,
        leads_skipped: leadsSkipped,
        rows_failed: rowsFailed,
        completed_at: new Date(),
      })
      .where(eq(sheetSyncSessionsTable.id, sessionId));

    res.json({
      session_id: sessionId,
      status: finalStatus,
      rows_found: dataRows.length,
      leads_created: leadsCreated,
      leads_updated: leadsUpdated,
      leads_skipped: leadsSkipped,
      rows_failed: rowsFailed,
    });
  } catch (err: any) {
    await db.update(sheetSyncSessionsTable)
      .set({ status: "FAILED", error_message: err.message, completed_at: new Date() })
      .where(eq(sheetSyncSessionsTable.id, sessionId))
      .catch(() => {});
    res.status(500).json({ error: err.message, session_id: sessionId });
  }
});

router.get("/sessions", async (_req, res): Promise<void> => {
  try {
    const sessions = await db
      .select()
      .from(sheetSyncSessionsTable)
      .orderBy(desc(sheetSyncSessionsTable.created_at))
      .limit(20);
    res.json({ sessions });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/sessions/:id", async (req, res): Promise<void> => {
  try {
    const [session] = await db
      .select()
      .from(sheetSyncSessionsTable)
      .where(eq(sheetSyncSessionsTable.id, req.params.id))
      .limit(1);

    if (!session) {
      res.status(404).json({ error: "Session not found" });
      return;
    }
    res.json(session);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
