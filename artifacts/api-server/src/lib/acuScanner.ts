import { db, acuTable, documentsTable, acuCandidatesTable, acuScanLogTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { randomUUID } from "crypto";
import { anthropic } from "@workspace/integrations-anthropic-ai";

interface ScanResult {
  document_id: string;
  document_title: string;
  scan_date: string;
  candidates_found: number;
  candidates: CandidateResult[];
}

interface CandidateResult {
  candidate_id: string;
  type: string;
  content: string;
  importance_level: number;
  importance_label: string;
  importance_rationale: string;
  source_context: string;
  already_locked_as: string | null;
  status: string;
}

export async function scanDocument(documentId: string): Promise<ScanResult> {
  const [doc] = await db.select().from(documentsTable).where(eq(documentsTable.id, documentId));
  if (!doc) throw new Error(`Document ${documentId} not found`);

  const lockedACUs = await db.select().from(acuTable).where(eq(acuTable.status, "LOCKED"));

  const lockedSummary = lockedACUs.map(u => `[${u.id}] (${u.type}): ${u.content}`).join("\n");

  const docContent = doc.content || "";
  if (!docContent.trim()) {
    return {
      document_id: documentId,
      document_title: doc.title || documentId,
      scan_date: new Date().toISOString().split("T")[0],
      candidates_found: 0,
      candidates: [],
    };
  }

  const prompt = `You are reviewing a document from Unlock, a UK fintech specialising in EIS/SEIS portfolio intelligence.

DOCUMENT:
Title: ${doc.title || documentId}
ID: ${documentId}
Content:
${docContent.substring(0, 12000)}

EXISTING LOCKED CONTENT UNITS (already managed — do not re-extract these):
${lockedSummary}

TASK:
Extract all candidate content units from this document. For each, identify:

1. Type: one of fact, framing, reference, qualifier
2. The exact content text (verbatim from document)
3. Source context (which section/paragraph)
4. Importance level (1=Foundational, 2=Structural, 3=Supporting, 4=Contextual)
5. Importance rationale (why this level)
6. Whether it duplicates an existing locked ACU (if so, which one)

IMPORTANCE RULES:
- Level 1 (Foundational): Contains percentages, pence figures, regulatory references, mandatory qualifiers, or prohibited figures. Appears in 5+ documents. Referenced in QC checks.
- Level 2 (Structural): Named exit comparables, framings used across persona clusters, appears in Pack 1 or Pack 2.
- Level 3 (Supporting): Published study references, anonymised examples, appears in 2-4 documents.
- Level 4 (Contextual): Background market data, appears in 1 document only, not in any QC check.

DO NOT extract:
- Generic statements that are not specific claims
- Section headings or formatting
- Content that exactly matches an existing locked ACU

Return JSON array:
[
  {
    "type": "fact|framing|reference|qualifier",
    "content": "exact text from document",
    "source_context": "section/paragraph reference",
    "importance_level": 1-4,
    "importance_label": "Foundational|Structural|Supporting|Contextual",
    "importance_rationale": "why this importance level",
    "duplicates_acu": "acu_id or null"
  }
]

Return ONLY the JSON array, no other text.`;

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 8192,
    messages: [{ role: "user", content: prompt }],
  });

  let candidates: CandidateResult[] = [];
  try {
    const text = response.content[0].type === "text" ? response.content[0].text : "";
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      candidates = parsed.map((c: any, i: number) => ({
        candidate_id: `cand_${documentId}_${String(i + 1).padStart(3, "0")}`,
        type: c.type,
        content: c.content,
        importance_level: c.importance_level,
        importance_label: c.importance_label,
        importance_rationale: c.importance_rationale,
        source_context: c.source_context,
        already_locked_as: c.duplicates_acu || null,
        status: c.duplicates_acu ? "DUPLICATE" : "PENDING_REVIEW",
      }));
    }
  } catch (e) {
    console.error("Failed to parse scanner response:", e);
  }

  return {
    document_id: documentId,
    document_title: doc.title || documentId,
    scan_date: new Date().toISOString().split("T")[0],
    candidates_found: candidates.length,
    candidates,
  };
}

export async function scanAllDocuments(): Promise<{
  scan_id: string;
  documents_scanned: number;
  candidates_found: number;
  new_candidates: number;
  duplicates_found: number;
  scan_duration_ms: number;
  results: ScanResult[];
}> {
  const startTime = Date.now();
  const scanId = `scan_${randomUUID().substring(0, 8)}`;

  const docs = await db.select().from(documentsTable);
  const scannable = docs.filter(d =>
    (d.review_state === "CLEAN" || d.review_state === "REQUIRES_REVIEW") &&
    d.content && d.content.trim().length > 0
  );

  const results: ScanResult[] = [];
  let totalCandidates = 0;
  let totalNew = 0;
  let totalDuplicates = 0;

  for (const doc of scannable) {
    try {
      const result = await scanDocument(doc.id);
      results.push(result);

      for (const cand of result.candidates) {
        const [existing] = await db.select().from(acuCandidatesTable)
          .where(eq(acuCandidatesTable.id, cand.candidate_id));

        if (!existing) {
          await db.insert(acuCandidatesTable).values({
            id: cand.candidate_id,
            type: cand.type,
            content: cand.content,
            importance_level: cand.importance_level,
            importance_label: cand.importance_label,
            importance_rationale: cand.importance_rationale,
            source_document_id: doc.id,
            source_context: cand.source_context,
            appears_in_documents: [doc.id],
            existing_acu_id: cand.already_locked_as,
            status: cand.status,
            scan_date: result.scan_date,
          });

          totalCandidates++;
          if (cand.status === "DUPLICATE") totalDuplicates++;
          else totalNew++;
        }
      }
    } catch (e) {
      console.error(`Error scanning document ${doc.id}:`, e);
    }
  }

  const duration = Date.now() - startTime;

  await db.insert(acuScanLogTable).values({
    id: scanId,
    scan_date: new Date().toISOString(),
    documents_scanned: scannable.length,
    candidates_found: totalCandidates,
    new_candidates: totalNew,
    duplicates_found: totalDuplicates,
    contradictions_found: 0,
    scan_duration_ms: duration,
  });

  return {
    scan_id: scanId,
    documents_scanned: scannable.length,
    candidates_found: totalCandidates,
    new_candidates: totalNew,
    duplicates_found: totalDuplicates,
    scan_duration_ms: duration,
    results,
  };
}
