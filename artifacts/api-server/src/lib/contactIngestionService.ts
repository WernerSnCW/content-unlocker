import { db, contactsTable } from "@workspace/db";
import { eq, or, ilike, sql } from "drizzle-orm";

export interface ColumnMapping {
  name: string;       // CSV column name for contact name
  email?: string;     // CSV column name for email
  phone?: string;     // CSV column name for phone
  company?: string;   // CSV column name for company
}

export interface ParsedContact {
  name: string;
  email: string | null;
  phone: string | null;
  company: string | null;
  row_number: number;
}

export interface DedupResult {
  status: "new" | "exact_duplicate" | "possible_match";
  matched_contact_id?: string;
  matched_name?: string;
  match_reason?: string;
  parsed: ParsedContact;
}

export interface IngestionPreview {
  new_contacts: DedupResult[];
  exact_duplicates: DedupResult[];
  possible_matches: DedupResult[];
  invalid: Array<{ row_number: number; reason: string }>;
  total_rows: number;
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
  // Strip everything except digits and leading +
  let cleaned = phone.replace(/[^\d+]/g, "");
  if (!cleaned || cleaned.length < 7) return null;

  // UK number normalisation
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
  // Basic email validation
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) return null;
  return trimmed;
}

export function normaliseName(name: string): string {
  return name
    .trim()
    .replace(/\s+/g, " ")
    .split(" ")
    .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
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

  const nameIdx = lower.findIndex(h => h === "name" || h === "fullname" || h === "contactname");
  if (nameIdx === -1) return null;

  const emailIdx = lower.findIndex(h => h === "email" || h === "emailaddress" || h === "mail");
  const phoneIdx = lower.findIndex(h => h === "phone" || h === "phonenumber" || h === "telephone" || h === "mobile" || h === "tel");
  const companyIdx = lower.findIndex(h => h === "company" || h === "organisation" || h === "organization" || h === "org" || h === "companyname");

  return {
    name: headers[nameIdx],
    email: emailIdx >= 0 ? headers[emailIdx] : undefined,
    phone: phoneIdx >= 0 ? headers[phoneIdx] : undefined,
    company: companyIdx >= 0 ? headers[companyIdx] : undefined,
  };
}

export function applyMapping(rows: string[][], headers: string[], mapping: ColumnMapping): { contacts: ParsedContact[]; invalid: Array<{ row_number: number; reason: string }> } {
  const nameIdx = headers.indexOf(mapping.name);
  const emailIdx = mapping.email ? headers.indexOf(mapping.email) : -1;
  const phoneIdx = mapping.phone ? headers.indexOf(mapping.phone) : -1;
  const companyIdx = mapping.company ? headers.indexOf(mapping.company) : -1;

  const contacts: ParsedContact[] = [];
  const invalid: Array<{ row_number: number; reason: string }> = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rawName = nameIdx >= 0 ? row[nameIdx] : "";
    const rawEmail = emailIdx >= 0 ? row[emailIdx] : "";
    const rawPhone = phoneIdx >= 0 ? row[phoneIdx] : "";
    const rawCompany = companyIdx >= 0 ? row[companyIdx] : "";

    if (!rawName || rawName.trim().length === 0) {
      invalid.push({ row_number: i + 2, reason: "Missing name" }); // +2 for header row + 0-index
      continue;
    }

    const name = normaliseName(rawName);
    const email = normaliseEmail(rawEmail);
    const phone = normalisePhone(rawPhone);

    if (!phone && !email) {
      invalid.push({ row_number: i + 2, reason: "No valid phone or email" });
      continue;
    }

    contacts.push({
      name,
      email,
      phone,
      company: rawCompany?.trim() || null,
      row_number: i + 2,
    });
  }

  return { contacts, invalid };
}

// ==================== Deduplication ====================

export async function checkDuplicates(contacts: ParsedContact[]): Promise<DedupResult[]> {
  const existing = await db.select({
    id: contactsTable.id,
    name: contactsTable.name,
    email: contactsTable.email,
    phone: contactsTable.phone,
    company: contactsTable.company,
  }).from(contactsTable);

  // Build lookup maps
  const emailMap = new Map<string, { id: string; name: string }>();
  const phoneMap = new Map<string, { id: string; name: string }>();
  for (const e of existing) {
    if (e.email) emailMap.set(e.email.toLowerCase(), { id: e.id, name: e.name });
    if (e.phone) phoneMap.set(e.phone, { id: e.id, name: e.name });
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
          matched_name: match.name,
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
          matched_name: match.name,
          match_reason: "Phone number match",
          parsed: contact,
        });
        continue;
      }
    }

    // 3. Fuzzy name + company match
    const nameLower = contact.name.toLowerCase();
    const companyLower = contact.company?.toLowerCase() || "";
    let bestMatch: { id: string; name: string; score: number } | null = null;

    for (const e of existing) {
      const existingNameLower = e.name.toLowerCase();
      const existingCompanyLower = (e.company || "").toLowerCase();

      // Exact name match
      if (existingNameLower === nameLower) {
        // Same name, check company
        if (companyLower && existingCompanyLower && companyLower === existingCompanyLower) {
          bestMatch = { id: e.id, name: e.name, score: 0.95 };
          break;
        } else if (!companyLower || !existingCompanyLower) {
          // Name matches but can't confirm company
          if (!bestMatch || bestMatch.score < 0.7) {
            bestMatch = { id: e.id, name: e.name, score: 0.7 };
          }
        }
      }

      // Last name match with same company
      const nameWords = nameLower.split(" ");
      const existingWords = existingNameLower.split(" ");
      if (nameWords.length >= 2 && existingWords.length >= 2) {
        const lastNameMatch = nameWords[nameWords.length - 1] === existingWords[existingWords.length - 1];
        const firstNameMatch = nameWords[0] === existingWords[0];
        if (lastNameMatch && firstNameMatch && companyLower === existingCompanyLower && companyLower) {
          if (!bestMatch || bestMatch.score < 0.8) {
            bestMatch = { id: e.id, name: e.name, score: 0.8 };
          }
        }
      }
    }

    if (bestMatch && bestMatch.score >= 0.7) {
      results.push({
        status: "possible_match",
        matched_contact_id: bestMatch.id,
        matched_name: bestMatch.name,
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
  decisions: Record<number, "skip" | "update" | "merge"> // keyed by row_number for possible matches
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
            name: result.parsed.name,
            email: result.parsed.email,
            phone: result.parsed.phone,
            company: result.parsed.company,
            source_list: sourceList,
          }).where(eq(contactsTable.id, result.matched_contact_id));
          updated++;
          continue;
        }
        // merge = create new (fall through to create)
      }

      // Create new contact
      await db.insert(contactsTable).values({
        name: result.parsed.name,
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
