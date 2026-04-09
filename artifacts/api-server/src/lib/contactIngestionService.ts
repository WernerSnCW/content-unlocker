import { db, contactsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

export interface ColumnMapping {
  first_name: string;    // CSV column for first name
  last_name: string;     // CSV column for last name
  name?: string;         // CSV column for full name (if first/last not separate)
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

export interface DedupResult {
  status: "new" | "exact_duplicate" | "possible_match";
  matched_contact_id?: string;
  matched_first_name?: string;
  matched_last_name?: string;
  matched_email?: string;
  matched_phone?: string;
  matched_company?: string;
  match_reason?: string;
  parsed: ParsedContact;
}

export interface IngestionResult {
  created: number;
  skipped: number;
  updated: number;
  errors: number;
  upload_batch: string;
}

// ==================== Normalisation ====================

export function normalisePhone(phone: string): string | null {
  if (!phone) return null;
  let cleaned = phone.replace(/[^\d+]/g, "");
  if (!cleaned || cleaned.length < 7) return null;

  if (cleaned.startsWith("0")) {
    cleaned = "+44" + cleaned.slice(1);
  } else if (cleaned.startsWith("44") && !cleaned.startsWith("+")) {
    cleaned = "+" + cleaned;
  } else if (!cleaned.startsWith("+")) {
    cleaned = "+" + cleaned;
  }
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
      } else {
        current += ch;
      }
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

  // Need either first+last or full name
  if (firstNameIdx === -1 && lastNameIdx === -1 && fullNameIdx === -1) return null;

  const emailIdx = lower.findIndex(h => h === "email" || h === "emailaddress" || h === "mail");
  const phoneIdx = lower.findIndex(h => h === "phone" || h === "phonenumber" || h === "telephone" || h === "mobile" || h === "tel");
  const companyIdx = lower.findIndex(h => h === "company" || h === "organisation" || h === "organization" || h === "org" || h === "companyname");

  if (firstNameIdx >= 0 && lastNameIdx >= 0) {
    return {
      first_name: headers[firstNameIdx],
      last_name: headers[lastNameIdx],
      email: emailIdx >= 0 ? headers[emailIdx] : undefined,
      phone: phoneIdx >= 0 ? headers[phoneIdx] : undefined,
      company: companyIdx >= 0 ? headers[companyIdx] : undefined,
    };
  }

  if (fullNameIdx >= 0) {
    return {
      first_name: "",
      last_name: "",
      name: headers[fullNameIdx],
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
    let firstName = "";
    let lastName = "";

    if (firstNameIdx >= 0 && lastNameIdx >= 0) {
      firstName = normaliseName(row[firstNameIdx] || "");
      lastName = normaliseName(row[lastNameIdx] || "");
    } else if (fullNameIdx >= 0) {
      const split = splitFullName(row[fullNameIdx] || "");
      firstName = split.first_name;
      lastName = split.last_name;
    }

    if (!firstName && !lastName) {
      invalid.push({ row_number: i + 2, reason: "Missing name" });
      continue;
    }

    const email = normaliseEmail(row[emailIdx] || "");
    const phone = normalisePhone(row[phoneIdx] || "");

    if (!phone && !email) {
      invalid.push({ row_number: i + 2, reason: "No valid phone or email" });
      continue;
    }

    contacts.push({
      first_name: firstName,
      last_name: lastName,
      email,
      phone,
      company: row[companyIdx]?.trim() || null,
      row_number: i + 2,
    });
  }

  return { contacts, invalid };
}

// ==================== Deduplication ====================

export async function checkDuplicates(contacts: ParsedContact[]): Promise<DedupResult[]> {
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

  const results: DedupResult[] = [];

  for (const contact of contacts) {
    // 1. Exact email match
    if (contact.email) {
      const match = emailMap.get(contact.email);
      if (match) {
        results.push({
          status: "exact_duplicate",
          matched_contact_id: match.id,
          matched_first_name: match.first_name,
          matched_last_name: match.last_name,
          matched_email: match.email || undefined,
          matched_phone: match.phone || undefined,
          matched_company: match.company || undefined,
          match_reason: "Exact email match",
          parsed: contact,
        });
        continue;
      }
    }

    // 2. Normalised phone match
    if (contact.phone) {
      const match = phoneMap.get(contact.phone);
      if (match) {
        results.push({
          status: "exact_duplicate",
          matched_contact_id: match.id,
          matched_first_name: match.first_name,
          matched_last_name: match.last_name,
          matched_email: match.email || undefined,
          matched_phone: match.phone || undefined,
          matched_company: match.company || undefined,
          match_reason: "Phone number match",
          parsed: contact,
        });
        continue;
      }
    }

    // 3. Fuzzy name + company match
    const lastLower = contact.last_name.toLowerCase();
    const firstLower = contact.first_name.toLowerCase();
    const companyLower = contact.company?.toLowerCase() || "";
    let bestMatch: { record: typeof existing[0]; score: number } | null = null;

    for (const e of existing) {
      const eLastLower = e.last_name.toLowerCase();
      const eFirstLower = e.first_name.toLowerCase();
      const eCompanyLower = (e.company || "").toLowerCase();

      // Exact full name match
      if (eFirstLower === firstLower && eLastLower === lastLower) {
        if (companyLower && eCompanyLower && companyLower === eCompanyLower) {
          bestMatch = { record: e, score: 0.95 };
          break;
        } else if (!companyLower || !eCompanyLower) {
          if (!bestMatch || bestMatch.score < 0.7) {
            bestMatch = { record: e, score: 0.7 };
          }
        }
      }

      // Last name match with same company
      if (eLastLower === lastLower && companyLower && eCompanyLower === companyLower) {
        if (!bestMatch || bestMatch.score < 0.6) {
          bestMatch = { record: e, score: 0.6 };
        }
      }
    }

    if (bestMatch && bestMatch.score >= 0.6) {
      results.push({
        status: "possible_match",
        matched_contact_id: bestMatch.record.id,
        matched_first_name: bestMatch.record.first_name,
        matched_last_name: bestMatch.record.last_name,
        matched_email: bestMatch.record.email || undefined,
        matched_phone: bestMatch.record.phone || undefined,
        matched_company: bestMatch.record.company || undefined,
        match_reason: `Fuzzy name match (${Math.round(bestMatch.score * 100)}% confidence)`,
        parsed: contact,
      });
    } else {
      results.push({ status: "new", parsed: contact });
    }
  }

  return results;
}

// ==================== Import ====================

export async function importContacts(
  contacts: ParsedContact[],
  sourceList: string,
  decisions: Record<number, "skip" | "update" | "merge">
): Promise<IngestionResult> {
  const uploadBatch = `batch_${Date.now()}`;
  let created = 0, skipped = 0, updated = 0, errors = 0;

  const dedupResults = await checkDuplicates(contacts);

  for (const result of dedupResults) {
    try {
      if (result.status === "exact_duplicate") {
        skipped++;
        continue;
      }

      if (result.status === "possible_match") {
        const decision = decisions[result.parsed.row_number] || "skip";
        if (decision === "skip") {
          skipped++;
          continue;
        }
        if (decision === "update" && result.matched_contact_id) {
          await db.update(contactsTable).set({
            first_name: result.parsed.first_name,
            last_name: result.parsed.last_name,
            email: result.parsed.email,
            phone: result.parsed.phone,
            company: result.parsed.company,
            source_list: sourceList,
          }).where(eq(contactsTable.id, result.matched_contact_id));
          updated++;
          continue;
        }
        // merge = create new (fall through)
      }

      await db.insert(contactsTable).values({
        first_name: result.parsed.first_name,
        last_name: result.parsed.last_name,
        email: result.parsed.email,
        phone: result.parsed.phone,
        company: result.parsed.company,
        source_list: sourceList,
        upload_batch: uploadBatch,
        dedup_status: "clean",
        dispatch_status: "pool",
      });
      created++;
    } catch (err: any) {
      errors++;
    }
  }

  return { created, skipped, updated, errors, upload_batch: uploadBatch };
}
