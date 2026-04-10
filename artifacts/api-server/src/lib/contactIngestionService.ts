import { db, contactsTable, uploadSessionsTable, stagedContactsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

export interface ColumnMapping {
  first_name: string;
  last_name: string;
  name?: string;
  email?: string;
  phone?: string;
  company?: string;
}

export interface ParsedContact {
  first_name: string;
  last_name: string;
  email: string | null;
  phone: string | null;
  company: string | null;
  row_number: number;
}

// ==================== Normalisation ====================

export function normalisePhone(phone: string): string | null {
  if (!phone) return null;
  let cleaned = phone.replace(/[^\d+]/g, "");
  if (!cleaned || cleaned.length < 7) return null;
  if (cleaned.startsWith("0")) cleaned = "+44" + cleaned.slice(1);
  else if (cleaned.startsWith("44") && !cleaned.startsWith("+")) cleaned = "+" + cleaned;
  else if (!cleaned.startsWith("+")) cleaned = "+" + cleaned;
  return cleaned;
}

export function normaliseEmail(email: string): string | null {
  if (!email) return null;
  const trimmed = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) return null;
  return trimmed;
}

export function normaliseName(name: string): string {
  return name.trim().replace(/\s+/g, " ")
    .split(" ").map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(" ");
}

export function splitFullName(fullName: string): { first_name: string; last_name: string } {
  const parts = fullName.trim().replace(/\s+/g, " ").split(" ");
  if (parts.length === 1) return { first_name: normaliseName(parts[0]), last_name: "" };
  const last = parts.pop()!;
  return { first_name: normaliseName(parts.join(" ")), last_name: normaliseName(last) };
}

// ==================== CSV Parsing ====================

export function parseCsvRows(csvText: string): string[][] {
  const lines = csvText.trim().split("\n").filter(l => l.trim());
  return lines.map(line => {
    const result: string[] = [];
    let current = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
        else { inQuotes = !inQuotes; }
      } else if (ch === "," && !inQuotes) {
        result.push(current.trim());
        current = "";
      } else { current += ch; }
    }
    result.push(current.trim());
    return result;
  });
}

// Synonyms for each target field — scored by specificity
const FIELD_SYNONYMS: Record<string, { exact: string[]; partial: string[] }> = {
  first_name: {
    exact: ["firstname", "first", "givenname", "forename", "fname"],
    partial: ["first", "given", "fore"],
  },
  last_name: {
    exact: ["lastname", "last", "surname", "familyname", "lname", "sname"],
    partial: ["last", "sur", "family"],
  },
  name: {
    exact: ["name", "fullname", "contactname", "contact", "investor", "investorname", "person"],
    partial: ["name", "contact", "investor"],
  },
  email: {
    exact: ["email", "emailaddress", "mail", "emailaddr", "emal", "emailid"],
    partial: ["email", "mail"],
  },
  phone: {
    exact: ["phone", "phonenumber", "telephone", "mobile", "tel", "cell", "cellphone",
            "mobilenumber", "phoneno", "telnumber", "contactnumber", "directdial", "directline"],
    partial: ["phone", "mobile", "tel", "cell", "dial", "direct"],
  },
  company: {
    exact: ["company", "companyname", "organisation", "organization", "org", "firm",
            "employer", "business", "businessname", "corp", "entity"],
    partial: ["company", "org", "firm", "business", "employer"],
  },
};

export interface ColumnSuggestion {
  header: string;
  suggested_field: string | null; // first_name, last_name, name, email, phone, company, or null
  confidence: "high" | "medium" | "low" | "none";
  alternatives: string[]; // other possible field matches
}

export function suggestColumnMapping(headers: string[]): ColumnSuggestion[] {
  const suggestions: ColumnSuggestion[] = [];
  const usedFields = new Set<string>();

  // Score each header against each field
  const scored: Array<{ headerIdx: number; field: string; score: number }> = [];

  for (let i = 0; i < headers.length; i++) {
    const normalised = headers[i].toLowerCase().replace(/[_\-\s.]+/g, "").replace(/[^a-z0-9]/g, "");

    for (const [field, synonyms] of Object.entries(FIELD_SYNONYMS)) {
      let score = 0;

      // Exact match on normalised header
      if (synonyms.exact.includes(normalised)) {
        score = 1.0;
      }
      // Partial match — header contains a synonym
      else if (synonyms.partial.some(p => normalised.includes(p))) {
        score = 0.6;
      }
      // Reverse partial — synonym contains the header
      else if (synonyms.partial.some(p => p.includes(normalised)) && normalised.length >= 3) {
        score = 0.4;
      }

      if (score > 0) {
        scored.push({ headerIdx: i, field, score });
      }
    }
  }

  // Sort by score descending, then greedily assign best matches
  scored.sort((a, b) => b.score - a.score);

  const headerAssignments = new Map<number, { field: string; score: number; alternatives: string[] }>();

  for (const s of scored) {
    if (usedFields.has(s.field) && s.field !== "name") continue; // name can coexist if no first/last
    if (headerAssignments.has(s.headerIdx)) {
      // Add as alternative
      const existing = headerAssignments.get(s.headerIdx)!;
      if (!existing.alternatives.includes(s.field)) {
        existing.alternatives.push(s.field);
      }
      continue;
    }

    headerAssignments.set(s.headerIdx, { field: s.field, score: s.score, alternatives: [] });
    usedFields.add(s.field);
  }

  // If we have first_name and last_name, remove name from assignments
  const assignedFields = new Set([...headerAssignments.values()].map(a => a.field));
  if (assignedFields.has("first_name") && assignedFields.has("last_name")) {
    for (const [idx, assignment] of headerAssignments) {
      if (assignment.field === "name") {
        headerAssignments.delete(idx);
        break;
      }
    }
  }

  // Build suggestions for all headers
  for (let i = 0; i < headers.length; i++) {
    const assignment = headerAssignments.get(i);
    if (assignment) {
      suggestions.push({
        header: headers[i],
        suggested_field: assignment.field,
        confidence: assignment.score >= 0.9 ? "high" : assignment.score >= 0.5 ? "medium" : "low",
        alternatives: assignment.alternatives,
      });
    } else {
      suggestions.push({
        header: headers[i],
        suggested_field: null,
        confidence: "none",
        alternatives: [],
      });
    }
  }

  return suggestions;
}

// Convert suggestions to a ColumnMapping (for backward compatibility)
export function suggestionsToMapping(suggestions: ColumnSuggestion[]): ColumnMapping | null {
  const map: Record<string, string> = {};
  for (const s of suggestions) {
    if (s.suggested_field) map[s.suggested_field] = s.header;
  }

  if (map.first_name && map.last_name) {
    return {
      first_name: map.first_name, last_name: map.last_name,
      email: map.email, phone: map.phone, company: map.company,
    };
  }
  if (map.name) {
    return {
      first_name: "", last_name: "", name: map.name,
      email: map.email, phone: map.phone, company: map.company,
    };
  }
  return null;
}

// Keep backward compat
export function detectColumns(headers: string[]): ColumnMapping | null {
  return suggestionsToMapping(suggestColumnMapping(headers));
}

export function applyMapping(rows: string[][], headers: string[], mapping: ColumnMapping): { contacts: ParsedContact[]; invalid: Array<{ row_number: number; reason: string }> } {
  const firstNameIdx = mapping.first_name ? headers.indexOf(mapping.first_name) : -1;
  const lastNameIdx = mapping.last_name ? headers.indexOf(mapping.last_name) : -1;
  const fullNameIdx = mapping.name ? headers.indexOf(mapping.name) : -1;
  const emailIdx = mapping.email ? headers.indexOf(mapping.email) : -1;
  const phoneIdx = mapping.phone ? headers.indexOf(mapping.phone) : -1;
  const companyIdx = mapping.company ? headers.indexOf(mapping.company) : -1;

  const contacts: ParsedContact[] = [];
  const invalid: Array<{ row_number: number; reason: string }> = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    let firstName = "", lastName = "";
    if (firstNameIdx >= 0 && lastNameIdx >= 0) {
      firstName = normaliseName(row[firstNameIdx] || "");
      lastName = normaliseName(row[lastNameIdx] || "");
    } else if (fullNameIdx >= 0) {
      const split = splitFullName(row[fullNameIdx] || "");
      firstName = split.first_name;
      lastName = split.last_name;
    }
    if (!firstName && !lastName) { invalid.push({ row_number: i + 2, reason: "Missing name" }); continue; }

    const email = normaliseEmail(row[emailIdx] || "");
    const phone = normalisePhone(row[phoneIdx] || "");
    if (!phone && !email) { invalid.push({ row_number: i + 2, reason: "No valid phone or email" }); continue; }

    contacts.push({ first_name: firstName, last_name: lastName, email, phone, company: row[companyIdx]?.trim() || null, row_number: i + 2 });
  }
  return { contacts, invalid };
}

// ==================== Stage Upload ====================

export async function stageUpload(
  csvText: string,
  mapping: ColumnMapping,
  sourceList: string,
): Promise<string> {
  const rows = parseCsvRows(csvText);
  if (rows.length < 2) throw new Error("CSV must have a header row and at least one data row");

  const headers = rows[0];
  const dataRows = rows.slice(1);
  const { contacts: parsed, invalid } = applyMapping(dataRows, headers, mapping);

  // Load existing contacts for dedup
  const existing = await db.select({
    id: contactsTable.id,
    first_name: contactsTable.first_name,
    last_name: contactsTable.last_name,
    email: contactsTable.email,
    phone: contactsTable.phone,
    company: contactsTable.company,
  }).from(contactsTable);

  const emailMap = new Map<string, typeof existing[0]>();
  const phoneMap = new Map<string, typeof existing[0]>();
  for (const e of existing) {
    if (e.email) emailMap.set(e.email.toLowerCase(), e);
    if (e.phone) phoneMap.set(e.phone, e);
  }

  // Create session
  const [session] = await db.insert(uploadSessionsTable).values({
    source_list: sourceList,
    status: "processing",
    total_rows: dataRows.length,
  }).returning();

  let newCount = 0, dupCount = 0, matchCount = 0;

  // Stage each parsed contact
  for (const contact of parsed) {
    let dedupStatus = "new";
    let matchReason: string | null = null;
    let matchedContactId: string | null = null;
    let matchedDetails: Record<string, any> = {};

    // 1. Exact email match
    if (contact.email) {
      const match = emailMap.get(contact.email);
      if (match) {
        dedupStatus = "exact_duplicate";
        matchReason = "Exact email match";
        matchedContactId = match.id;
        matchedDetails = { first_name: match.first_name, last_name: match.last_name, email: match.email, phone: match.phone, company: match.company };
        dupCount++;
        await db.insert(stagedContactsTable).values({
          session_id: session.id, row_number: contact.row_number,
          first_name: contact.first_name, last_name: contact.last_name,
          email: contact.email, phone: contact.phone, company: contact.company,
          dedup_status: dedupStatus, match_reason: matchReason,
          matched_contact_id: matchedContactId, matched_details: matchedDetails,
        });
        continue;
      }
    }

    // 2. Normalised phone match
    if (contact.phone) {
      const match = phoneMap.get(contact.phone);
      if (match) {
        dedupStatus = "exact_duplicate";
        matchReason = "Phone number match";
        matchedContactId = match.id;
        matchedDetails = { first_name: match.first_name, last_name: match.last_name, email: match.email, phone: match.phone, company: match.company };
        dupCount++;
        await db.insert(stagedContactsTable).values({
          session_id: session.id, row_number: contact.row_number,
          first_name: contact.first_name, last_name: contact.last_name,
          email: contact.email, phone: contact.phone, company: contact.company,
          dedup_status: dedupStatus, match_reason: matchReason,
          matched_contact_id: matchedContactId, matched_details: matchedDetails,
        });
        continue;
      }
    }

    // 3. Fuzzy name + company
    const lastLower = contact.last_name.toLowerCase();
    const firstLower = contact.first_name.toLowerCase();
    const companyLower = contact.company?.toLowerCase() || "";
    let bestMatch: { record: typeof existing[0]; score: number } | null = null;

    for (const e of existing) {
      const eLastLower = e.last_name.toLowerCase();
      const eFirstLower = e.first_name.toLowerCase();
      const eCompanyLower = (e.company || "").toLowerCase();

      if (eFirstLower === firstLower && eLastLower === lastLower) {
        if (companyLower && eCompanyLower && companyLower === eCompanyLower) {
          bestMatch = { record: e, score: 0.95 }; break;
        } else if (!companyLower || !eCompanyLower) {
          if (!bestMatch || bestMatch.score < 0.7) bestMatch = { record: e, score: 0.7 };
        }
      }
      if (eLastLower === lastLower && companyLower && eCompanyLower === companyLower) {
        if (!bestMatch || bestMatch.score < 0.6) bestMatch = { record: e, score: 0.6 };
      }
    }

    if (bestMatch && bestMatch.score >= 0.6) {
      dedupStatus = "possible_match";
      matchReason = `Fuzzy name match (${Math.round(bestMatch.score * 100)}% confidence)`;
      matchedContactId = bestMatch.record.id;
      matchedDetails = { first_name: bestMatch.record.first_name, last_name: bestMatch.record.last_name, email: bestMatch.record.email, phone: bestMatch.record.phone, company: bestMatch.record.company };
      matchCount++;
    } else {
      newCount++;
    }

    await db.insert(stagedContactsTable).values({
      session_id: session.id, row_number: contact.row_number,
      first_name: contact.first_name, last_name: contact.last_name,
      email: contact.email, phone: contact.phone, company: contact.company,
      dedup_status: dedupStatus, match_reason: matchReason,
      matched_contact_id: matchedContactId, matched_details: matchedDetails,
    });
  }

  // Stage invalid rows
  for (const inv of invalid) {
    await db.insert(stagedContactsTable).values({
      session_id: session.id, row_number: inv.row_number,
      first_name: "", last_name: "",
      dedup_status: "invalid", invalid_reason: inv.reason,
    });
  }

  // Update session counts
  await db.update(uploadSessionsTable).set({
    status: "ready_for_review",
    new_count: newCount,
    duplicate_count: dupCount,
    possible_match_count: matchCount,
    invalid_count: invalid.length,
  }).where(eq(uploadSessionsTable.id, session.id));

  return session.id;
}

// ==================== Commit Upload ====================

export async function commitUpload(sessionId: string): Promise<{ created: number; updated: number; skipped: number; errors: number }> {
  const staged = await db.select().from(stagedContactsTable)
    .where(eq(stagedContactsTable.session_id, sessionId));

  const [session] = await db.select().from(uploadSessionsTable)
    .where(eq(uploadSessionsTable.id, sessionId));

  if (!session || session.status === "committed") {
    throw new Error("Session not found or already committed");
  }

  let created = 0, updated = 0, skipped = 0, errors = 0;

  for (const row of staged) {
    try {
      if (row.dedup_status === "invalid") { skipped++; continue; }
      if (row.dedup_status === "exact_duplicate") { skipped++; continue; }

      if (row.dedup_status === "possible_match") {
        const decision = row.decision || "skip";
        if (decision === "skip") { skipped++; continue; }
        if (decision === "update" && row.matched_contact_id) {
          await db.update(contactsTable).set({
            first_name: row.first_name, last_name: row.last_name,
            email: row.email, phone: row.phone, company: row.company,
            source_list: session.source_list,
          }).where(eq(contactsTable.id, row.matched_contact_id));
          updated++;
          continue;
        }
        // decision === "create" — fall through
      }

      // New or create decision
      await db.insert(contactsTable).values({
        first_name: row.first_name, last_name: row.last_name,
        email: row.email, phone: row.phone, company: row.company,
        source_list: session.source_list,
        upload_batch: sessionId,
        dedup_status: "clean",
        dispatch_status: "pool",
      });
      created++;
    } catch (err: any) {
      errors++;
    }
  }

  await db.update(uploadSessionsTable).set({
    status: "committed",
    committed_count: created + updated,
  }).where(eq(uploadSessionsTable.id, sessionId));

  return { created, updated, skipped, errors };
}
