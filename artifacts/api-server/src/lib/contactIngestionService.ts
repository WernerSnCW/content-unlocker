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

export function detectColumns(headers: string[]): ColumnMapping | null {
  const lower = headers.map(h => h.toLowerCase().replace(/[_\-\s]+/g, ""));
  const firstNameIdx = lower.findIndex(h => h === "firstname" || h === "first");
  const lastNameIdx = lower.findIndex(h => h === "lastname" || h === "last" || h === "surname");
  const fullNameIdx = lower.findIndex(h => h === "name" || h === "fullname" || h === "contactname");
  if (firstNameIdx === -1 && lastNameIdx === -1 && fullNameIdx === -1) return null;

  const emailIdx = lower.findIndex(h => h === "email" || h === "emailaddress" || h === "mail");
  const phoneIdx = lower.findIndex(h => h === "phone" || h === "phonenumber" || h === "telephone" || h === "mobile" || h === "tel");
  const companyIdx = lower.findIndex(h => h === "company" || h === "organisation" || h === "organization" || h === "org" || h === "companyname");

  if (firstNameIdx >= 0 && lastNameIdx >= 0) {
    return {
      first_name: headers[firstNameIdx], last_name: headers[lastNameIdx],
      email: emailIdx >= 0 ? headers[emailIdx] : undefined,
      phone: phoneIdx >= 0 ? headers[phoneIdx] : undefined,
      company: companyIdx >= 0 ? headers[companyIdx] : undefined,
    };
  }
  if (fullNameIdx >= 0) {
    return {
      first_name: "", last_name: "", name: headers[fullNameIdx],
      email: emailIdx >= 0 ? headers[emailIdx] : undefined,
      phone: phoneIdx >= 0 ? headers[phoneIdx] : undefined,
      company: companyIdx >= 0 ? headers[companyIdx] : undefined,
    };
  }
  return null;
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
