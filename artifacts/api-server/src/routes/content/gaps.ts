import { Router, type IRouter } from "express";
import { db, documentsTable, changelogTable, gapSnapshotsTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { randomUUID } from "crypto";
import { anthropic } from "@workspace/integrations-anthropic-ai";
import { getComplianceConstants } from "../../lib/dataManager";
import contentBankText from "../../data/content/700_CONTENT_Bank_V4_CURRENT.md";
import masterContextRaw from "../../data/content/065_MASTER_generation_context_v1.0.md";
import {
  ARCHETYPES,
  PIPELINE_STAGES,
  COVERAGE_MATRIX,
  REQUIRED_DOCUMENT_TYPES,
  EXPECTED_COMPLIANCE_FIELDS,
  COMPLIANCE_FIELD_LABELS,
} from "../../../../../lib/coverage-matrix";
import { resolveArchetype } from "../../../../../lib/personas";
import { writeFile, readFile, mkdir } from "fs/promises";
import { existsSync } from "fs";
import path from "path";

const router: IRouter = Router();

const masterGenerationContext: string = masterContextRaw || "";
if (masterGenerationContext.length > 0) {
  console.log(`Master generation context loaded: ${masterGenerationContext.length} characters`);
} else {
  console.warn("Warning: Master generation context is empty — proceeding without it.");
}

function normalizeDocType(t: string): string {
  return t.toLowerCase().replace(/[^a-z0-9]/g, "");
}

const TYPE_ALIASES: Record<string, string[]> = {
  "case study": ["case", "case study", "casestudy"],
  "one-pager / overview": ["onepager", "overview", "promo", "onepageroverview"],
  "faq / objection handler": ["faq", "objectionhandler", "faqobjectionhandler"],
  "compliance / risk disclosure": ["compliance", "riskdisclosure", "complianceriskdisclosure", "legal"],
  "how it works / explainer": ["howitworks", "explainer", "howitworksexplainer", "brief"],
  "pricing / terms summary": ["pricing", "terms", "pricingterms", "pricingtermssummary"],
};

function matchesRequiredType(docType: string, requiredType: string): boolean {
  const norm = normalizeDocType(docType);
  const aliases = TYPE_ALIASES[requiredType.toLowerCase()] || [normalizeDocType(requiredType)];
  return aliases.some((a) => norm.includes(a) || a.includes(norm));
}

router.get("/content/gaps", async (req, res): Promise<void> => {
  try {
    const allDocs = await db.select().from(documentsTable);
    const cleanCurrentDocs = allDocs.filter(
      (d) => d.lifecycle_status === "CURRENT" && d.review_state === "CLEAN"
    );

    const matrixGaps: Array<{
      archetype: string;
      stage: string;
      gap_type: "matrix";
      existing_documents: string[];
    }> = [];

    for (const cell of COVERAGE_MATRIX) {
      const covering = cleanCurrentDocs.filter((d) => {
        const personas = (d.persona_relevance as string[]) || [];
        const stages = (d.pipeline_stage_relevance as string[]) || [];
        const docArchetypes = personas.map((p) => resolveArchetype(p)).filter(Boolean);
        const matchesArch =
          docArchetypes.includes(cell.archetype) || personas.includes(cell.archetype);
        const matchesStage = stages.includes(cell.stage);
        return matchesArch && matchesStage;
      });

      if (covering.length === 0) {
        const partial = allDocs.filter((d) => {
          const personas = (d.persona_relevance as string[]) || [];
          const stages = (d.pipeline_stage_relevance as string[]) || [];
          const docArchetypes = personas.map((p) => resolveArchetype(p)).filter(Boolean);
          const matchesArch =
            docArchetypes.includes(cell.archetype) || personas.includes(cell.archetype);
          const matchesStage = stages.includes(cell.stage);
          return matchesArch || matchesStage;
        });
        matrixGaps.push({
          archetype: cell.archetype,
          stage: cell.stage,
          gap_type: "matrix",
          existing_documents: partial.map((d) => d.id),
        });
      }
    }

    const typeGaps: Array<{
      document_type: string;
      gap_type: "type";
      existing_documents: string[];
    }> = [];

    for (const reqType of REQUIRED_DOCUMENT_TYPES) {
      const matching = cleanCurrentDocs.filter((d) => matchesRequiredType(d.type, reqType));
      if (matching.length === 0) {
        const partial = allDocs.filter((d) => matchesRequiredType(d.type, reqType));
        typeGaps.push({
          document_type: reqType,
          gap_type: "type",
          existing_documents: partial.map((d) => d.id),
        });
      }
    }

    const recommendationGaps: Array<{
      persona: string;
      stage: string;
      gap_type: "recommendation_failure";
      reason: string;
    }> = [];

    for (const archetype of ARCHETYPES) {
      for (const stage of PIPELINE_STAGES) {
        const eligible = cleanCurrentDocs.filter((d) => {
          const personas = (d.persona_relevance as string[]) || [];
          const stages = (d.pipeline_stage_relevance as string[]) || [];
          const docArchetypes = personas.map((p) => resolveArchetype(p)).filter(Boolean);
          const matchesArch =
            docArchetypes.includes(archetype) || personas.includes(archetype);
          return matchesArch && stages.includes(stage);
        });
        if (eligible.length === 0) {
          recommendationGaps.push({
            persona: archetype,
            stage,
            gap_type: "recommendation_failure",
            reason: `No documents tagged for ${archetype} at ${stage} stage`,
          });
        }
      }
    }

    const compliance = getComplianceConstants();
    const constantKeys = compliance.constants.map((c: any) => c.key);
    const missingFields: string[] = [];
    for (const expected of EXPECTED_COMPLIANCE_FIELDS) {
      const found = compliance.constants.find(
        (c: any) => c.key === expected || c.key.includes(expected.replace(/_/g, ""))
      );
      if (!found || !found.value) {
        missingFields.push(COMPLIANCE_FIELD_LABELS[expected] || expected);
      }
    }

    const hasContentBank = contentBankText && contentBankText.length > 500;
    const contentBankStatus = hasContentBank ? "SUFFICIENT" : "INSUFFICIENT";
    const contentBankDetail = hasContentBank
      ? `Content bank loaded with ${contentBankText.length} characters across multiple sections`
      : "Content bank is empty or minimal";

    const complianceStatus =
      missingFields.length === 0
        ? "SUFFICIENT"
        : missingFields.length <= 2
          ? "PARTIAL"
          : "INSUFFICIENT";
    const complianceDetail =
      missingFields.length === 0
        ? `All ${EXPECTED_COMPLIANCE_FIELDS.length} expected compliance fields present`
        : `${missingFields.length} compliance field(s) missing: ${missingFields.join(", ")}`;

    let overall: "READY_TO_GENERATE" | "CAN_GENERATE_WITH_CAVEATS" | "INSUFFICIENT_TO_GENERATE";
    if (contentBankStatus === "SUFFICIENT" && complianceStatus === "SUFFICIENT") {
      overall = "READY_TO_GENERATE";
    } else if (contentBankStatus === "INSUFFICIENT" || complianceStatus === "INSUFFICIENT") {
      overall = "INSUFFICIENT_TO_GENERATE";
    } else {
      overall = "CAN_GENERATE_WITH_CAVEATS";
    }

    const gapResult = {
      matrix_gaps: matrixGaps,
      type_gaps: typeGaps,
      recommendation_gaps: recommendationGaps,
      information_readiness: {
        content_bank: {
          status: contentBankStatus,
          detail: contentBankDetail,
        },
        compliance_constants: {
          status: complianceStatus,
          detail: complianceDetail,
          missing_fields: missingFields,
        },
        overall,
      },
      summary: {
        total_gaps: matrixGaps.length + typeGaps.length + recommendationGaps.length,
        matrix_gap_count: matrixGaps.length,
        type_gap_count: typeGaps.length,
        recommendation_failure_count: recommendationGaps.length,
      },
    };

    const shouldSave = req.query.save === "true";

    if (!shouldSave) {
      res.json(gapResult);
      return;
    }

    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    const snapshotId = `gap_${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}_${randomUUID().slice(0, 6)}`;
    const reportsDir = path.resolve(process.cwd(), "reports/gap-analysis");
    const filePath = `reports/gap-analysis/${snapshotId}.json`;
    let saveWarning: string | null = null;

    try {
      await mkdir(reportsDir, { recursive: true });
      await writeFile(path.join(reportsDir, `${snapshotId}.json`), JSON.stringify({ ...gapResult, snapshot_id: snapshotId, created_at: now.toISOString() }, null, 2));

      const manifestPath = path.join(reportsDir, "manifest.json");
      let manifest: { snapshots: any[] } = { snapshots: [] };
      try {
        if (existsSync(manifestPath)) {
          const raw = await readFile(manifestPath, "utf-8");
          manifest = JSON.parse(raw);
          if (!Array.isArray(manifest.snapshots)) manifest = { snapshots: [] };
        }
      } catch { manifest = { snapshots: [] }; }

      manifest.snapshots.unshift({
        id: snapshotId,
        created_at: now.toISOString(),
        total_gaps: gapResult.summary.total_gaps,
        file: filePath,
      });
      await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
    } catch (fileErr: any) {
      req.log.error({ err: fileErr }, "Failed to write gap snapshot file");
      saveWarning = `File write failed: ${fileErr.message}`;
    }

    try {
      await db.insert(gapSnapshotsTable).values({
        id: snapshotId,
        created_at: now,
        matrix_gaps: matrixGaps,
        type_gaps: typeGaps,
        recommendation_gaps: recommendationGaps,
        information_readiness: gapResult.information_readiness,
        summary: gapResult.summary,
        total_gaps: gapResult.summary.total_gaps,
        file_path: filePath,
        notes: "",
      });
    } catch (dbErr: any) {
      req.log.error({ err: dbErr }, "Failed to save gap snapshot to database");
      if (!saveWarning) saveWarning = `Database save failed: ${dbErr.message}`;
      else saveWarning += `; Database save failed: ${dbErr.message}`;
    }

    res.json({
      ...gapResult,
      snapshot_id: snapshotId,
      snapshot_file: filePath,
      ...(saveWarning ? { save_warning: saveWarning } : {}),
    });
  } catch (err: any) {
    req.log.error({ err }, "Gap detection failed");
    res.status(500).json({ error: "Gap detection failed" });
  }
});

router.get("/content/gaps/history", async (_req, res): Promise<void> => {
  try {
    const snapshots = await db.select().from(gapSnapshotsTable).orderBy(desc(gapSnapshotsTable.created_at));
    res.json({
      snapshots: snapshots.map((s) => {
        const summary = s.summary as any;
        return {
          id: s.id,
          created_at: s.created_at,
          total_gaps: s.total_gaps,
          matrix_gap_count: summary?.matrix_gap_count ?? 0,
          type_gap_count: summary?.type_gap_count ?? 0,
          recommendation_failure_count: summary?.recommendation_failure_count ?? 0,
          file_path: s.file_path,
          notes: s.notes,
        };
      }),
    });
  } catch (err: any) {
    res.status(500).json({ error: "Failed to fetch gap history" });
  }
});

router.get("/content/gaps/history/:snapshotId", async (req, res): Promise<void> => {
  try {
    const [snapshot] = await db.select().from(gapSnapshotsTable).where(eq(gapSnapshotsTable.id, req.params.snapshotId));
    if (!snapshot) {
      res.status(404).json({ error: "Snapshot not found" });
      return;
    }
    res.json(snapshot);
  } catch (err: any) {
    res.status(500).json({ error: "Failed to fetch snapshot" });
  }
});

router.get("/content/gaps/history/:snapshotId/export", async (req, res): Promise<void> => {
  try {
    const [snapshot] = await db.select().from(gapSnapshotsTable).where(eq(gapSnapshotsTable.id, req.params.snapshotId));
    if (!snapshot) {
      res.status(404).json({ error: "Snapshot not found" });
      return;
    }

    const format = (req.query.format as string) || "json";
    const summary = snapshot.summary as any;
    const ir = snapshot.information_readiness as any;

    if (format === "markdown") {
      const matrixRows = (snapshot.matrix_gaps as any[]).map((g: any) => `| ${g.archetype} | ${g.stage} | ${(g.existing_documents || []).join(", ") || "None"} |`).join("\n");
      const typeRows = (snapshot.type_gaps as any[]).map((g: any) => `| ${g.document_type} | ${(g.existing_documents || []).join(", ") || "None"} |`).join("\n");
      const recRows = (snapshot.recommendation_gaps as any[]).map((g: any) => `| ${g.persona} | ${g.stage} | ${g.reason} |`).join("\n");

      const md = `# Gap Analysis Report
Generated: ${snapshot.created_at}
Snapshot ID: ${snapshot.id}

## Summary
- Total gaps: ${summary?.total_gaps ?? 0}
- Matrix gaps: ${summary?.matrix_gap_count ?? 0}
- Document type gaps: ${summary?.type_gap_count ?? 0}
- Recommendation failures: ${summary?.recommendation_failure_count ?? 0}

## Information Readiness
Content bank: ${ir?.content_bank?.status || "N/A"} — ${ir?.content_bank?.detail || "N/A"}
Compliance constants: ${ir?.compliance_constants?.status || "N/A"} — ${ir?.compliance_constants?.detail || "N/A"}
Overall: ${ir?.overall || "N/A"}

## Matrix Gaps
| Archetype | Stage | Existing Documents |
|---|---|---|
${matrixRows || "| (none) | | |"}

## Document Type Gaps
| Type | Existing Documents |
|---|---|
${typeRows || "| (none) | |"}

## Recommendation Failures
| Persona | Stage | Reason |
|---|---|---|
${recRows || "| (none) | | |"}
`;
      res.setHeader("Content-Type", "text/markdown");
      res.setHeader("Content-Disposition", `attachment; filename="gap-analysis-${snapshot.id}.md"`);
      res.send(md);
    } else {
      res.setHeader("Content-Type", "application/json");
      res.setHeader("Content-Disposition", `attachment; filename="gap-analysis-${snapshot.id}.json"`);
      res.json(snapshot);
    }
  } catch (err: any) {
    res.status(500).json({ error: "Export failed" });
  }
});

router.patch("/content/gaps/history/:snapshotId", async (req, res): Promise<void> => {
  try {
    const { notes } = req.body;
    if (typeof notes !== "string") {
      res.status(400).json({ error: "notes field is required as a string" });
      return;
    }
    const [updated] = await db.update(gapSnapshotsTable).set({ notes }).where(eq(gapSnapshotsTable.id, req.params.snapshotId)).returning();
    if (!updated) {
      res.status(404).json({ error: "Snapshot not found" });
      return;
    }
    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ error: "Failed to update snapshot" });
  }
});

export async function generateBriefFromGap(gap: any, additional_context?: string): Promise<{ brief: any; ready_to_generate: boolean }> {
  const compliance = getComplianceConstants();
  const complianceText = compliance.constants
    .map((c: any) => `${c.label}: ${c.value}${c.note ? ` (${c.note})` : ""}`)
    .join("\n");

  let gapDescription = "";
  if (gap.gap_type === "matrix") {
    gapDescription = `Missing document for archetype "${gap.archetype}" at pipeline stage "${gap.stage}". This is a coverage matrix gap — no CLEAN+CURRENT document exists for this combination.`;
  } else if (gap.gap_type === "type") {
    gapDescription = `Missing document of type "${gap.document_type}". This document type is required in the registry regardless of persona/stage coverage.`;
  } else if (gap.gap_type === "recommendation_failure") {
    gapDescription = `Recommendation engine returned zero results for persona "${gap.archetype || gap.persona}" at stage "${gap.stage}". Reason: ${gap.reason || "No matching documents found."}`;
  } else if (gap.gap_type === "document_type") {
    gapDescription = `Missing ${gap.document_type || "document"} for archetype "${gap.archetype}" at pipeline stage "${gap.stage}".`;
  }
  if (gap.title) {
    gapDescription += `\nRequired document title: "${gap.title}"`;
  }
  if (gap.description) {
    gapDescription += `\nDetailed requirements: ${gap.description}`;
  }

  const briefMessage = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 4096,
    messages: [
      {
        role: "user",
        content: `You are a content strategist for Unlock, a UK portfolio intelligence platform for sophisticated investors.

A content gap has been identified:
${gapDescription}

CONTENT BANK (source material available):
${contentBankText.slice(0, 8000)}
${masterGenerationContext ? `\nMASTER GENERATION CONTEXT (Unlock platform reference — mandatory rules, personas, products, compliance):\n${masterGenerationContext}\n` : ""}${additional_context ? `\nADDITIONAL CONTEXT (supplementary source material):\n${additional_context}\n` : ""}
COMPLIANCE CONSTANTS:
${complianceText}

Based on this gap and available source material, generate a structured content brief. The brief should specify what document needs to be created to fill this gap.

Return ONLY valid JSON:
{
  "title": "<recommended document title>",
  "document_type": "<document type>",
  "archetypes": ["<target archetype(s)>"],
  "stages": ["<target pipeline stage(s)>"],
  "key_messages": ["<3-5 bullet points of key messages>"],
  "tone": "<tone and style guidance>",
  "length_guidance": "<recommended word count and format>",
  "compliance_considerations": ["<relevant compliance points>"],
  "source_material_pointers": ["<specific sections of the content bank to draw from>"],
  "information_needed": [
    {
      "field": "<missing field name>",
      "description": "<what is needed>",
      "source": "<content_bank|compliance_constants|external>"
    }
  ]
}

If all information is available, return an empty array for information_needed.
Return ONLY the JSON.`,
      },
    ],
  });

  const block = briefMessage.content[0];
  const text = block.type === "text" ? block.text : "";

  const cleaned = text.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
  const brief = JSON.parse(cleaned);

  const readyToGenerate =
    !brief.information_needed || brief.information_needed.length === 0;

  return { brief, ready_to_generate: readyToGenerate };
}

router.post("/content/generate-brief", async (req, res): Promise<void> => {
  try {
    const { gap, information_readiness, additional_context } = req.body;

    if (!gap || !gap.gap_type) {
      res.status(400).json({ error: "gap object with gap_type is required" });
      return;
    }

    if (
      information_readiness?.overall === "INSUFFICIENT_TO_GENERATE"
    ) {
      res.status(422).json({
        error: "Insufficient information to generate a brief",
        missing: {
          content_bank: information_readiness.content_bank,
          compliance_constants: information_readiness.compliance_constants,
        },
      });
      return;
    }

    const result = await generateBriefFromGap(gap, additional_context);
    res.json(result);
  } catch (err: any) {
    req.log.error({ err }, "Brief generation failed");
    res.status(500).json({ error: "Brief generation failed" });
  }
});

router.post("/content/generate-from-brief", async (req, res): Promise<void> => {
  try {
    const { brief, override_information_gaps } = req.body;

    if (!brief || !brief.title || !brief.document_type) {
      res.status(400).json({ error: "A valid brief with title and document_type is required" });
      return;
    }

    const hasInfoGaps =
      brief.information_needed && brief.information_needed.length > 0;

    if (hasInfoGaps && !override_information_gaps) {
      res.status(422).json({
        error: "Brief has unresolved information gaps. Set override_information_gaps: true to proceed anyway.",
        information_needed: brief.information_needed,
      });
      return;
    }

    const compliance = getComplianceConstants();
    const complianceText = compliance.constants
      .map((c: any) => `${c.label}: ${c.value}${c.note ? ` (${c.note})` : ""}`)
      .join("\n");

    let caveatBlock = "";
    if (hasInfoGaps && override_information_gaps) {
      const caveatItems = brief.information_needed
        .map((item: any) => `- ${item.field}: ${item.description} (source: ${item.source})`)
        .join("\n");
      caveatBlock = `\n\n---\n**CAVEAT — INFORMATION GAPS**\nThe following information was not available when this document was generated. Content in these areas may be assumed or incomplete:\n${caveatItems}\n---\n\n`;
    }

    const briefPrompt = `Generate investor-facing content for Unlock, a UK portfolio intelligence platform.

DOCUMENT TITLE: ${brief.title}
DOCUMENT TYPE: ${brief.document_type}
TARGET ARCHETYPES: ${(brief.archetypes || []).join(", ")}
PIPELINE STAGE RELEVANCE: ${(brief.stages || []).join(", ")}

KEY MESSAGES TO CONVEY:
${(brief.key_messages || []).map((m: string) => `- ${m}`).join("\n")}

TONE: ${brief.tone || "Professional, institutional"}
LENGTH GUIDANCE: ${brief.length_guidance || "1000-1500 words"}

COMPLIANCE CONSIDERATIONS:
${(brief.compliance_considerations || []).map((c: string) => `- ${c}`).join("\n")}

SOURCE MATERIAL POINTERS:
${(brief.source_material_pointers || []).map((s: string) => `- ${s}`).join("\n")}

COMPLIANCE CONSTANTS (must be accurately reflected):
${complianceText}

CONTENT BANK EXCERPTS:
${contentBankText.slice(0, 6000)}

RULES:
- Use Unlock terminology: "Founding investor" (not shareholder), "Instant Investment" (not ASA), "EIS/SEIS relief"
- Product tagline: "Clarity, without complexity"
- Never publish discount tier percentages
- Never mention specific commission or fee structures
- All figures must match compliance constants exactly
- Use British English spelling throughout
- Write for sophisticated investors — no marketing fluff
${hasInfoGaps ? "\nIMPORTANT: Some information gaps exist. Note any assumptions made clearly." : ""}

Generate the document content. Return ONLY valid JSON:
{
  "content": "<the full document content in markdown>",
  "metadata": {
    "word_count": <number>,
    "compliance_references_used": ["<which constants were referenced>"],
    "tone_assessment": "<brief assessment of tone>"
  }
}

Return ONLY the JSON.`;

    const genMessage = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 8192,
      messages: [{ role: "user", content: briefPrompt }],
    });

    const genBlock = genMessage.content[0];
    const genText = genBlock.type === "text" ? genBlock.text : "";

    let generated;
    try {
      const cleaned = genText.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
      generated = JSON.parse(cleaned);
    } catch {
      generated = {
        content: genText,
        metadata: {
          word_count: genText.split(/\s+/).length,
          compliance_references_used: [],
          tone_assessment: "Unable to assess",
        },
      };
    }

    if (caveatBlock) {
      generated.content = caveatBlock + generated.content;
    }

    const qcMessage = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 8192,
      messages: [
        {
          role: "user",
          content: `You are a QC evaluator for Unlock, a UK portfolio intelligence platform. Evaluate this generated document.

DOCUMENT TYPE: ${brief.document_type}
CONTENT TO EVALUATE:
${generated.content}

COMPLIANCE CONSTANTS THAT MUST BE ACCURATE:
${complianceText}

CHECK EACH OF THESE:
1. compliance_accuracy — All figures match compliance constants exactly
2. terminology — Uses "Founding investor" not "shareholder", "Instant Investment" not "ASA", "EIS/SEIS relief" correctly
3. prohibited_content — No discount tier percentages, no commission/fee structures
4. tone — Professional, institutional, no marketing fluff
5. spelling — British English throughout
6. product_tagline — Uses "Clarity, without complexity" correctly
7. completeness — Document addresses the stated requirements
8. factual_accuracy — No invented statistics or claims

Return ONLY valid JSON:
{
  "overall": "<pass|fail>",
  "checks": [
    {
      "check_id": "<id from above>",
      "label": "<human-readable label>",
      "result": "<pass|fail|warning>",
      "offending_text": "<exact text that fails, or null>",
      "correct_version": "<what it should say, or null>",
      "source": "<which compliance constant or rule>"
    }
  ],
  "fail_count": <number>,
  "warnings": ["<any warnings>"],
  "qc_attempt": 1
}

Return ONLY the JSON.`,
        },
      ],
    });

    const qcBlock = qcMessage.content[0];
    const qcText = qcBlock.type === "text" ? qcBlock.text : "";

    let qcReport;
    try {
      const cleaned = qcText.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
      qcReport = JSON.parse(cleaned);
    } catch {
      qcReport = {
        overall: "pass",
        checks: [],
        fail_count: 0,
        warnings: ["QC response could not be parsed — defaulting to pass"],
        qc_attempt: 1,
      };
    }

    const docId = `gap_${randomUUID().slice(0, 8)}`;
    const briefId = `brief_gap_${randomUUID().slice(0, 8)}`;
    const fileCode = `GAP_${brief.document_type.toUpperCase().replace(/\s+/g, "_").slice(0, 15)}_${docId.slice(4)}`;

    await db.insert(documentsTable).values({
      id: docId,
      file_code: fileCode,
      type: brief.document_type,
      name: brief.title,
      filename: `${fileCode}_V1_DRAFT.md`,
      tier: 3,
      category: "Generated",
      lifecycle_status: "DRAFT",
      review_state: qcReport.overall === "pass" ? "CLEAN" : "REQUIRES_REVIEW",
      version: 1,
      last_reviewed: new Date().toISOString().split("T")[0],
      description: brief.key_messages?.join("; ").slice(0, 200) || brief.title,
      pipeline_stage_relevance: brief.stages || [],
      persona_relevance: brief.archetypes || [],
      upstream_dependencies: [],
      downstream_dependents: [],
      is_generated: true,
      generation_brief_id: briefId,
      generation_attempt: 1,
      qc_report_id: qcReport.overall,
      source_trace: [
        `Generated from gap brief on ${new Date().toISOString()}`,
        `Gap type: ${brief.gap_type || "unknown"}`,
      ],
      content: generated.content,
      qc_history: [qcReport],
    });

    await db.insert(changelogTable).values({
      id: randomUUID(),
      action: "DOCUMENT_GENERATED_FROM_GAP",
      document_id: docId,
      details: `Generated from content gap brief: ${brief.title} (${brief.document_type}). QC result: ${qcReport.overall}.`,
      triggered_by: "gap_analysis_engine",
    });

    const [savedDoc] = await db
      .select()
      .from(documentsTable)
      .where(eq(documentsTable.id, docId));

    res.json({
      document: savedDoc,
      generated_content: generated.content,
      qc_report: qcReport,
    });
  } catch (err: any) {
    req.log.error({ err }, "Generate from brief failed");
    res.status(500).json({ error: "Content generation from brief failed" });
  }
});

export default router;
