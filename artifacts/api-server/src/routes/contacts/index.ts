import { Router, type IRouter } from "express";
import { db, contactsTable } from "@workspace/db";
import { eq, or, sql, and, ilike } from "drizzle-orm";
import {
  parseCsvRows,
  detectColumns,
  applyMapping,
  checkDuplicates,
  importContacts,
  type ColumnMapping,
} from "../../lib/contactIngestionService";

const router: IRouter = Router();

// GET /contacts — paginated list with search and filters
router.get("/contacts", async (req, res): Promise<void> => {
  try {
    const search = typeof req.query.search === "string" ? req.query.search : undefined;
    const status = typeof req.query.dispatch_status === "string" ? req.query.dispatch_status : undefined;
    const source = typeof req.query.source_list === "string" ? req.query.source_list : undefined;
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(req.query.page_size as string) || 25));

    const conditions = [];
    if (search) {
      conditions.push(
        or(
          ilike(contactsTable.first_name, `%${search}%`),
          ilike(contactsTable.last_name, `%${search}%`)
        )!
      );
    }
    if (status) conditions.push(eq(contactsTable.dispatch_status, status));
    if (source) conditions.push(eq(contactsTable.source_list, source));

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const [totalResult] = await db
      .select({ count: sql<number>`count(*)` })
      .from(contactsTable)
      .where(whereClause);

    const total = Number(totalResult.count);
    const totalPages = Math.ceil(total / pageSize);
    const offset = (page - 1) * pageSize;

    const contacts = await db.select().from(contactsTable)
      .where(whereClause)
      .orderBy(contactsTable.created_at)
      .limit(pageSize)
      .offset(offset);

    res.json({
      data: contacts,
      pagination: { page, page_size: pageSize, total, total_pages: totalPages },
    });
  } catch (err: any) {
    res.status(500).json({ error: "Failed to fetch contacts" });
  }
});

// GET /contacts/sources — list distinct source_list values for filtering
router.get("/contacts/sources", async (req, res): Promise<void> => {
  try {
    const sources = await db
      .selectDistinct({ source_list: contactsTable.source_list })
      .from(contactsTable);
    res.json({ sources: sources.map(s => s.source_list).filter(Boolean) });
  } catch (err: any) {
    res.status(500).json({ error: "Failed to fetch sources" });
  }
});

// POST /contacts/upload/preview — parse CSV, detect columns, run dedup preview
router.post("/contacts/upload/preview", async (req, res): Promise<void> => {
  try {
    const { csv_text, column_mapping, source_list } = req.body;

    if (!csv_text || typeof csv_text !== "string") {
      res.status(400).json({ error: "csv_text is required" });
      return;
    }

    const rows = parseCsvRows(csv_text);
    if (rows.length < 2) {
      res.status(400).json({ error: "CSV must have a header row and at least one data row" });
      return;
    }

    const headers = rows[0];
    const dataRows = rows.slice(1);

    // Auto-detect or use provided mapping
    let mapping: ColumnMapping;
    if (column_mapping) {
      mapping = column_mapping;
    } else {
      const detected = detectColumns(headers);
      if (!detected) {
        res.json({
          needs_mapping: true,
          headers,
          row_count: dataRows.length,
          message: "Could not auto-detect column mapping. Please specify which columns map to name, email, phone, company.",
        });
        return;
      }
      mapping = detected;
    }

    // Parse and normalise
    const { contacts: parsed, invalid } = applyMapping(dataRows, headers, mapping);

    // Run dedup check
    const dedupResults = await checkDuplicates(parsed);

    const newContacts = dedupResults.filter(r => r.status === "new");
    const exactDuplicates = dedupResults.filter(r => r.status === "exact_duplicate");
    const possibleMatches = dedupResults.filter(r => r.status === "possible_match");

    res.json({
      needs_mapping: false,
      mapping,
      headers,
      preview: {
        total_rows: dataRows.length,
        new_contacts: newContacts.length,
        exact_duplicates: exactDuplicates.length,
        possible_matches: possibleMatches.length,
        invalid: invalid.length,
      },
      new_contacts: newContacts.map(r => r.parsed),
      exact_duplicates: exactDuplicates.map(r => ({
        ...r.parsed,
        matched_contact_id: r.matched_contact_id,
        matched_first_name: r.matched_first_name,
        matched_last_name: r.matched_last_name,
        matched_email: r.matched_email,
        matched_phone: r.matched_phone,
        matched_company: r.matched_company,
        match_reason: r.match_reason,
      })),
      possible_matches: possibleMatches.map(r => ({
        ...r.parsed,
        matched_contact_id: r.matched_contact_id,
        matched_first_name: r.matched_first_name,
        matched_last_name: r.matched_last_name,
        matched_email: r.matched_email,
        matched_phone: r.matched_phone,
        matched_company: r.matched_company,
        match_reason: r.match_reason,
      })),
      invalid,
    });
  } catch (err: any) {
    res.status(500).json({ error: "Failed to preview upload" });
  }
});

// POST /contacts/upload/confirm — import contacts with dedup decisions
router.post("/contacts/upload/confirm", async (req, res): Promise<void> => {
  try {
    const { csv_text, column_mapping, source_list, decisions } = req.body;

    if (!csv_text || !column_mapping || !source_list) {
      res.status(400).json({ error: "csv_text, column_mapping, and source_list are required" });
      return;
    }

    const rows = parseCsvRows(csv_text);
    if (rows.length < 2) {
      res.status(400).json({ error: "CSV must have a header row and at least one data row" });
      return;
    }

    const headers = rows[0];
    const dataRows = rows.slice(1);

    const { contacts: parsed } = applyMapping(dataRows, headers, column_mapping);

    const result = await importContacts(parsed, source_list, decisions || {});

    res.json({
      success: true,
      ...result,
    });
  } catch (err: any) {
    res.status(500).json({ error: "Failed to import contacts" });
  }
});

// GET /contacts/stats — pool statistics
router.get("/contacts/stats", async (req, res): Promise<void> => {
  try {
    const stats = await db
      .select({
        dispatch_status: contactsTable.dispatch_status,
        count: sql<number>`count(*)`,
      })
      .from(contactsTable)
      .groupBy(contactsTable.dispatch_status);

    const total = stats.reduce((sum, s) => sum + Number(s.count), 0);

    res.json({
      total,
      by_status: Object.fromEntries(stats.map(s => [s.dispatch_status, Number(s.count)])),
    });
  } catch (err: any) {
    res.status(500).json({ error: "Failed to fetch contact stats" });
  }
});

export default router;
