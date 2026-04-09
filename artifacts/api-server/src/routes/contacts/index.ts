import { Router, type IRouter } from "express";
import { db, contactsTable, uploadSessionsTable, stagedContactsTable } from "@workspace/db";
import { eq, or, sql, and, ilike, desc } from "drizzle-orm";
import {
  parseCsvRows, detectColumns, stageUpload, commitUpload,
  type ColumnMapping,
} from "../../lib/contactIngestionService";

const router: IRouter = Router();

// ==================== Contacts ====================

// GET /contacts — paginated list
router.get("/contacts", async (req, res): Promise<void> => {
  try {
    const search = typeof req.query.search === "string" ? req.query.search : undefined;
    const status = typeof req.query.dispatch_status === "string" ? req.query.dispatch_status : undefined;
    const source = typeof req.query.source_list === "string" ? req.query.source_list : undefined;
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(req.query.page_size as string) || 25));

    const conditions = [];
    if (search) conditions.push(or(ilike(contactsTable.first_name, `%${search}%`), ilike(contactsTable.last_name, `%${search}%`))!);
    if (status) conditions.push(eq(contactsTable.dispatch_status, status));
    if (source) conditions.push(eq(contactsTable.source_list, source));
    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const [totalResult] = await db.select({ count: sql<number>`count(*)` }).from(contactsTable).where(whereClause);
    const total = Number(totalResult.count);
    const offset = (page - 1) * pageSize;

    const contacts = await db.select().from(contactsTable)
      .where(whereClause).orderBy(contactsTable.created_at).limit(pageSize).offset(offset);

    res.json({ data: contacts, pagination: { page, page_size: pageSize, total, total_pages: Math.ceil(total / pageSize) } });
  } catch (err: any) {
    res.status(500).json({ error: "Failed to fetch contacts" });
  }
});

// GET /contacts/sources — distinct source lists
router.get("/contacts/sources", async (req, res): Promise<void> => {
  try {
    const sources = await db.selectDistinct({ source_list: contactsTable.source_list }).from(contactsTable);
    res.json({ sources: sources.map(s => s.source_list).filter(Boolean) });
  } catch (err: any) {
    res.status(500).json({ error: "Failed to fetch sources" });
  }
});

// GET /contacts/stats — pool statistics
router.get("/contacts/stats", async (req, res): Promise<void> => {
  try {
    const stats = await db.select({ dispatch_status: contactsTable.dispatch_status, count: sql<number>`count(*)` })
      .from(contactsTable).groupBy(contactsTable.dispatch_status);
    const total = stats.reduce((sum, s) => sum + Number(s.count), 0);
    res.json({ total, by_status: Object.fromEntries(stats.map(s => [s.dispatch_status, Number(s.count)])) });
  } catch (err: any) {
    res.status(500).json({ error: "Failed to fetch contact stats" });
  }
});

// ==================== Upload Sessions ====================

// GET /contacts/uploads — list upload sessions
router.get("/contacts/uploads", async (req, res): Promise<void> => {
  try {
    const sessions = await db.select().from(uploadSessionsTable).orderBy(desc(uploadSessionsTable.created_at));
    res.json({ sessions });
  } catch (err: any) {
    res.status(500).json({ error: "Failed to fetch upload sessions" });
  }
});

// POST /contacts/uploads — start a new upload (parse CSV, stage contacts)
router.post("/contacts/uploads", async (req, res): Promise<void> => {
  try {
    const { csv_text, column_mapping, source_list } = req.body;

    if (!csv_text || typeof csv_text !== "string") {
      res.status(400).json({ error: "csv_text is required" });
      return;
    }
    if (!source_list || typeof source_list !== "string") {
      res.status(400).json({ error: "source_list name is required" });
      return;
    }

    // Auto-detect columns if not provided
    let mapping: ColumnMapping;
    if (column_mapping) {
      mapping = column_mapping;
    } else {
      const rows = parseCsvRows(csv_text);
      if (rows.length < 2) {
        res.status(400).json({ error: "CSV must have a header row and at least one data row" });
        return;
      }
      const detected = detectColumns(rows[0]);
      if (!detected) {
        res.json({
          needs_mapping: true,
          headers: rows[0],
          row_count: rows.length - 1,
          message: "Could not auto-detect column mapping. Please specify which columns map to first_name, last_name, email, phone, company.",
        });
        return;
      }
      mapping = detected;
    }

    const sessionId = await stageUpload(csv_text, mapping, source_list);

    // Return session with staged data
    const [session] = await db.select().from(uploadSessionsTable).where(eq(uploadSessionsTable.id, sessionId));
    const staged = await db.select().from(stagedContactsTable).where(eq(stagedContactsTable.session_id, sessionId));

    res.json({
      session,
      staged: staged.map(s => ({
        id: s.id,
        row_number: s.row_number,
        first_name: s.first_name,
        last_name: s.last_name,
        email: s.email,
        phone: s.phone,
        company: s.company,
        dedup_status: s.dedup_status,
        match_reason: s.match_reason,
        matched_contact_id: s.matched_contact_id,
        matched_details: s.matched_details,
        decision: s.decision,
        invalid_reason: s.invalid_reason,
      })),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Failed to stage upload" });
  }
});

// GET /contacts/uploads/:sessionId — get session with staged contacts
router.get("/contacts/uploads/:sessionId", async (req, res): Promise<void> => {
  try {
    const { sessionId } = req.params;
    const [session] = await db.select().from(uploadSessionsTable).where(eq(uploadSessionsTable.id, sessionId));
    if (!session) { res.status(404).json({ error: "Session not found" }); return; }

    const staged = await db.select().from(stagedContactsTable).where(eq(stagedContactsTable.session_id, sessionId));

    res.json({ session, staged });
  } catch (err: any) {
    res.status(500).json({ error: "Failed to fetch session" });
  }
});

// PATCH /contacts/uploads/:sessionId/decisions — set decisions for possible matches
router.patch("/contacts/uploads/:sessionId/decisions", async (req, res): Promise<void> => {
  try {
    const { sessionId } = req.params;
    const { decisions } = req.body; // { staged_contact_id: "skip" | "update" | "create" }

    if (!decisions || typeof decisions !== "object") {
      res.status(400).json({ error: "decisions object is required" });
      return;
    }

    for (const [stagedId, decision] of Object.entries(decisions)) {
      await db.update(stagedContactsTable)
        .set({ decision: decision as string })
        .where(eq(stagedContactsTable.id, stagedId));
    }

    res.json({ success: true, updated: Object.keys(decisions).length });
  } catch (err: any) {
    res.status(500).json({ error: "Failed to update decisions" });
  }
});

// POST /contacts/uploads/:sessionId/commit — import approved contacts
router.post("/contacts/uploads/:sessionId/commit", async (req, res): Promise<void> => {
  try {
    const { sessionId } = req.params;
    const result = await commitUpload(sessionId);
    res.json({ success: true, ...result });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Failed to commit upload" });
  }
});

// POST /contacts/uploads/:sessionId/cancel — cancel an upload session
router.post("/contacts/uploads/:sessionId/cancel", async (req, res): Promise<void> => {
  try {
    const { sessionId } = req.params;
    await db.update(uploadSessionsTable)
      .set({ status: "cancelled" })
      .where(eq(uploadSessionsTable.id, sessionId));
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: "Failed to cancel session" });
  }
});

export default router;
