# 055 — Functional Integrity Assessment

**Date:** 2026-04-08  
**Scope:** All critical business-logic functions in the Unlock Content Intelligence platform  
**Method:** Full source-code read of every function listed below, tracing data flows from DB → logic → AI → response

---

## Executive Summary

The platform's core business logic is **genuinely integrated and functional** — not hollow. Every major function reads real database state, applies domain-specific rules, calls Claude with carefully structured prompts, validates AI output, and writes results back to the database with changelog entries. The code is production-grade in its logic, with appropriate fallback paths when AI calls fail.

**Overall Verdict: GENUINE — with specific fragilities noted below.**

---

## 1. Recommendation Engine (`routes/recommendation/index.ts` — 1,361 lines)

### 1.1 Transcript Analysis (`POST /recommendation/analyze`)

**What it does:** Takes a raw investor call transcript, sends it to Claude with persona reference guide and call-question framework, returns structured analysis.

**Integrity Assessment: GENUINE**

- Loads full persona guide (`lib/personas.ts`) and call question framework (`lib/call-questions.ts`) into prompt context
- Prompt is ~300 lines of carefully structured instructions telling Claude to detect persona, pipeline stage, objections, information gaps, readiness score, and questions answered (Q1–Q4)
- Validates Claude's JSON output: checks `pipeline_stage` against `PIPELINE_STAGES` array, validates `primary_issue` against allowed enum, defaults unknown values safely
- Calls `deriveMatrixFlags()` on the analysis output to compute EIS familiarity, IHT concern, and adviser involvement — these flags directly control document filtering downstream
- Returns call completeness metrics (questions covered, missing signals, confidence impact)

**Key Detail:** The Q1–Q4 framework maps to specific intelligence dimensions:
- Q1: Investment goals/motivation
- Q2: Prior EIS/startup experience
- Q3: Hesitations or deal-breakers
- Q4: Other decision-makers involved

### 1.2 Batch Analysis (`POST /recommendation/analyze-batch`)

**What it does:** Processes up to 5 transcripts sequentially through the same analysis pipeline.

**Integrity Assessment: GENUINE but LIMITED**

- Uses the same Claude prompt as single analysis
- Truncates transcripts to 50,000 characters
- Does NOT pass lead-specific context (belief state, send history) — uses "Unknown" stage
- Processes sequentially, not in parallel — a batch of 5 will take ~5× single analysis time

### 1.3 Document Ranking (`POST /recommendation/rank`)

**What it does:** Given analysis results and a lead, filters the 84-document library through multiple rule layers, then asks Claude to rank the survivors.

**Integrity Assessment: GENUINE — this is the most sophisticated function in the codebase**

**Filter pipeline (in order):**

1. **Send history exclusion** — reads `lead.send_log[]`, extracts all previously sent document IDs, excludes them
2. **Lifecycle filter** — only `CURRENT` lifecycle status, `CLEAN` review state
3. **Stage filter** — document's `pipeline_stage_relevance[]` must include the current stage
4. **Persona filter** — resolves detected persona to archetype via `resolveArchetype()`, filters on `persona_relevance[]`
5. **Usage matrix exclusion** — calls `shouldExclude()` from `recommendation-context.ts` with context flags (EIS familiar, IHT confirmed, adviser mentioned) plus already-sent list and current result set
6. **Worth-it weighting** — `getWorthItWeight()` assigns 1–3 star ratings to documents, used as base sort weight
7. **Belief gate filtering** — checks lead's belief state map:
   - If F0 (Structurally Essential) is NOT established → gates founding round documents (file codes 120, 130)
   - If U4 (EIS Risk Is Manageable) is NOT established → adds advisory note to avoid risk-appetite questions

**Lead intelligence integration:**
- Reads `lead_intelligence` table for the lead
- Overrides request-level `eis_familiar` and `adviser_mentioned` with stored intelligence values if available
- This means the system "remembers" what it learned about an investor across sessions

**Claude ranking call:**
- Sends top 8 candidates with worth-it ratings, persona routing rules (`getPersonaRoute()`), and stage objective rules (`getStageRule()`)
- Prompt instructs Claude to return `relevance_score` between 0.0–1.0, with scores below 0.4 flagged as poor fit
- Parses Claude response; on parse failure, falls back to worth-it-weighted order (not random)

**Post-ranking enrichment:**
- For each ranked document, looks up `belief_targets[]` from the documents table
- Finds the belief target where the lead's current state matches `state_from`
- Returns `belief_targeted`, `current_state`, `state_after_send`, and `gate_it_unlocks`
- This tells the operator: "sending this document should move belief X from state A to state B, which unlocks gate Y"

**Content gap detection:**
- If zero documents survive the filter pipeline, constructs a detailed `recommendation_gap` object explaining why (no docs for stage, no docs for persona, all already sent, blocked docs)
- Also recommends videos matched by persona/stage

**Low relevance detection:**
- If ALL ranked documents score below 0.4, flags the entire recommendation set with a gap advisory

### 1.4 Confirm Send (`POST /recommendation/confirm-send`)

**Integrity Assessment: GENUINE**

- Records send event with full audit trail: document IDs, pipeline stage at send time, transcript summary, analysis confidence
- Updates lead's `send_log[]`, `last_contact`, `detected_persona`, `persona_confidence`, `stage_confidence`
- If stage suggestion differs from current stage, advances the lead and appends to `stage_history[]`
- Creates changelog entry: `SEND_LOGGED`

### 1.5 Email Draft (`POST /recommendation/email-draft`)

**Integrity Assessment: GENUINE**

- Reads lead intelligence (hot button, hot button quote, cluster, primary blocker, readiness status)
- Injects intelligence into Claude prompt: "If an investor's emotional driver is identified, frame the email around what matters to them personally"
- Loads email templates reference (first 4,000 chars)
- Rules enforce Unlock-specific terminology: "Founding investor", "Instant Investment" (not ASA), never publish discount tier percentages
- Falls back to plain-text if JSON parse fails

### 1.6 Gap Brief (`POST /recommendation/gap-brief`)

**Integrity Assessment: GENUINE**

- When recommendation engine finds a coverage gap, this endpoint generates a content brief describing what document should be created
- Delegates to `generateBriefFromGap()` in the generation engine

---

## 2. Recommendation Context (`lib/recommendation-context.ts` — 166 lines)

**What it does:** Derives three boolean flags from transcript analysis that control document filtering.

**Integrity Assessment: GENUINE and THOROUGH**

**Flags derived:**
1. **`eis_familiar`** — 13 familiarity signal patterns ("familiar with eis", "done eis before", etc.) checked against transcript summary. Controls whether EIS education documents are included/excluded.
2. **`iht_confirmed`** — 10 IHT keyword patterns with 6 negation patterns ("no mention of inheritance", "not concerned about iht"). Controls whether IHT-specific documents are recommended.
3. **`adviser_mentioned`** — 10 adviser keywords with 10 negation patterns. Checked across transcript summary, objections, and blocking objections separately. Controls whether adviser-oriented documents are included.

Each flag includes a `derivation_note` explaining why it was set — this creates an auditable trail.

---

## 3. Propagation Engine (`lib/propagation.ts` — 110 lines)

**What it does:** When a Tier 1 document is updated, cascades review flags to all dependent documents.

**Integrity Assessment: GENUINE**

- `detectPropagationTargets()`: Reads all documents, finds those whose `upstream_dependencies[]` includes the source document ID. These are "direct" dependents.
- For Tier 1 source documents only: also finds Tier 3 documents that depend on the direct dependents (second-order cascade)
- Uses deduplication via `Set<string>` to prevent flagging the same document twice
- `propagateFromDocument()`: Sets each target's `review_state` to `REQUIRES_REVIEW` and creates a changelog entry explaining the cascade path

**Business impact:** This ensures that when foundational claims change (Tier 1), all derived content (Tier 2 emails, Tier 3 social posts) gets flagged for human review.

---

## 4. Content Generation Engine (`lib/generationEngine.ts`)

**What it does:** Generates new document content with ACU compliance enforcement.

**Integrity Assessment: GENUINE — compliance enforcement is real**

- Loads ACU (Approved Content Units) from database: LOCKED and PROHIBITED types
- Locked ACUs are injected verbatim into the generation prompt as mandatory inclusions
- Prohibited ACUs are listed as content that must never appear
- Post-generation: checks that every locked ACU appears in the output, checks that no prohibited ACU appears
- Returns compliance check results with pass/fail per ACU
- Also generates content briefs from gap analysis results

---

## 5. Campaign QC (`lib/campaignQC.ts` — 219 lines)

**What it does:** Runs a 19-point quality check on generated campaign sequences before they go live.

**Integrity Assessment: GENUINE**

**Check categories:**
1. **Sequence integrity** — validates node connections, day ordering, required channels present
2. **Channel compliance** — per-asset validation against channel-specific rules (character limits, formatting requirements) via `validateChannelCompliance()`
3. **ACU prohibited content** — scans every asset's content for prohibited ACUs, including specific pattern matching (`\b22p\b`, `7\.8x`)
4. **Blocked content** — checks assets don't contain content IDs that are blocked

Each check returns pass/fail/warning with a message. Overall campaign status is PASSED only if zero failures.

---

## 6. Work Queue Analysis (`routes/work-queue/index.ts` — 632 lines)

**What it does:** Batch-analyzes all documents flagged `REQUIRES_REVIEW`, generating decision cards for human operators.

**Integrity Assessment: GENUINE**

**Flow:**
1. `POST /work-queue/start` — finds all `CURRENT` + `REQUIRES_REVIEW` documents, creates review tasks, loads compliance constants (prohibited values + canonical values), launches async analysis
2. Analysis runs via `setImmediate()` — non-blocking, updates session status as it progresses
3. For each document: sends content + prohibited values + canonical values to Claude for compliance scan
4. Claude identifies issues, proposes fixes (auto-fixable or manual), and categorizes findings
5. Results stored as `decision_card` and `auto_fix` findings in `work_queue_findings` table
6. `POST /work-queue/auto-fix` — applies proposed text replacements to document content (exact string match + replace)
7. Decision cards remain for human review; auto-fixes can be applied in bulk

**Auto-fix safety:**
- Verifies document still exists
- Verifies `original_text` is found in document content
- Verifies replacement actually changes the content
- On any failure: marks finding as FAILED with explanation

---

## 7. Document Health Check (`routes/document-health/index.ts` — 325 lines)

**What it does:** Scores every CURRENT document across 7 dimensions.

**Integrity Assessment: GENUINE**

**Scoring dimensions:**
1. **Identity** — tier, category, description, file_code must be present
2. **Targeting** — must have at least one persona AND one pipeline stage tag (otherwise "will never be recommended")
3. **Belief** — must have belief_targets mapped to valid beliefs in the registry; flags legally blocked beliefs
4. **Compliance** — checks review state, scans content for prohibited values
5. **Propagation** — Tier 2+ documents must have upstream dependencies; references must point to existing CURRENT documents
6. **Content** — must have content > 100 chars (stub), ideally > 500 chars (thin)
7. **Delivery** — checks send history across all leads

**System-level findings:**
- Beliefs with no document mapping (orphaned beliefs)
- Stage × persona coverage gaps (empty cells in the matrix)
- Documents never sent to any lead

**Note on calibration:** The health check previously showed 0/70 healthy — this is because the delivery dimension flags "never sent" as WARN, and most documents haven't been sent yet. This is correct behavior (the dimension is working), but it means in early deployment, nearly all documents will show at least one warning.

---

## 8. Content Gap Analysis (`routes/content/gaps.ts` — 728 lines)

**What it does:** Identifies holes in the document library where the recommendation engine would fail.

**Integrity Assessment: GENUINE**

**Three gap types:**
1. **Matrix gaps** — checks every archetype × stage cell in the coverage matrix against actual documents
2. **Type gaps** — checks that required document types (case study, FAQ, compliance disclosure, etc.) exist with normalized matching and aliases
3. **Recommendation failure gaps** — simulates the recommendation engine's filter for every archetype × stage combination

**Information readiness assessment:**
- Checks content bank is loaded (> 500 chars)
- Checks all expected compliance constants are present
- Returns overall readiness: `READY_TO_GENERATE`, `CAN_GENERATE_WITH_CAVEATS`, or `INSUFFICIENT_TO_GENERATE`

**Also supports:**
- `POST /content/gaps/generate` — generates new document content to fill identified gaps
- `POST /content/gaps/snapshot` — saves current gap state for historical comparison
- Gap brief generation (content creation briefs for missing documents)

---

## 9. Feature Update Impact Analysis (`routes/content/feature-update.ts` — 346 lines)

**What it does:** When a product feature changes, identifies which documents need review.

**Integrity Assessment: GENUINE**

**Detection methods (layered):**
1. **Tier 1 propagation** — if `affects_tier1` is true, flags all Tier 1 docs as CRITICAL, then runs `detectPropagationTargets()` to cascade to dependents
2. **Compliance type match** — if `affects_compliance` is true, flags all compliance/risk/legal/pricing documents as CRITICAL
3. **Feature keyword search** — scans document content and descriptions for affected feature names
4. **AI semantic analysis** — sends remaining unflagged documents to Claude with the feature update description; Claude identifies semantically related documents that keyword search would miss

**Merge logic:** Documents found by multiple detection methods get their priority elevated (CRITICAL > HIGH > MEDIUM > LOW) and reasons concatenated.

**Supports dry run mode** — runs the full analysis without actually flagging documents.

---

## Fragility Findings

### Critical

| # | Finding | Impact | Location |
|---|---------|--------|----------|
| F1 | **No test coverage anywhere** | Any refactor risks silent regression of the filter pipeline, belief gating, or propagation logic | Entire codebase |
| F2 | **PDF storage on local filesystem** | Generated PDFs will be lost on Replit deployment restart | `routes/content/gaps.ts` (writeFile) |
| F3 | **Sequential Claude calls in batch analysis** | 5 transcripts × ~15s each = 75s+ response time; HTTP timeout risk | `routes/recommendation/index.ts` line 202 |

### Moderate

| # | Finding | Impact | Location |
|---|---------|--------|----------|
| F4 | **`shouldExclude()` imported via deep relative path** | `../../../../../lib/` — brittle to directory restructuring | Multiple route files |
| F5 | **Work queue analysis runs via `setImmediate()`** | If server restarts mid-analysis, session stuck in ANALYSING state forever; no recovery mechanism | `routes/work-queue/index.ts` line 101 |
| F6 | **Belief gate only checks F0 and U4** | Other beliefs in the registry are tracked but don't gate document access — may be intentional but undocumented | `routes/recommendation/index.ts` line 667 |
| F7 | **`alreadySent` date extraction has a dead code path** | Line 737: `(allDocs as any).__sendLog` — this property never exists; the corrected logic is on lines 748-760 | `routes/recommendation/index.ts` line 737 |
| F8 | **Email templates truncated to 4,000 chars** | If email templates exceed 4KB, later template styles will be cut from the prompt | `routes/recommendation/index.ts` line 1289 |

### Minor

| # | Finding | Impact | Location |
|---|---------|--------|----------|
| F9 | **Persona resolution duplicated** | `resolveArchetype()` mapping is defined in both `lib/personas.ts` and inline in the rank endpoint (line 1061) | Multiple locations |
| F10 | **Document health "never sent" is WARN not FAIL** | This is calibrated correctly for early deployment but may need adjustment as the library matures | `routes/document-health/index.ts` line 320 |

---

## Integration Verification Summary

| Function | Reads DB State | Applies Rules | Uses AI | Validates Output | Writes Back | Verdict |
|----------|:---:|:---:|:---:|:---:|:---:|---------|
| Transcript Analysis | — | ✓ | ✓ | ✓ | — | GENUINE |
| Document Ranking | ✓ | ✓ | ✓ | ✓ | — | GENUINE |
| Confirm Send | ✓ | ✓ | — | ✓ | ✓ | GENUINE |
| Email Draft | ✓ | ✓ | ✓ | ✓ | — | GENUINE |
| Propagation | ✓ | ✓ | — | — | ✓ | GENUINE |
| Content Generation | ✓ | ✓ | ✓ | ✓ | ✓ | GENUINE |
| Campaign QC | ✓ | ✓ | — | ✓ | — | GENUINE |
| Work Queue Analysis | ✓ | ✓ | ✓ | ✓ | ✓ | GENUINE |
| Document Health | ✓ | ✓ | — | — | ✓ | GENUINE |
| Content Gap Analysis | ✓ | ✓ | ✓ | ✓ | ✓ | GENUINE |
| Feature Update Impact | ✓ | ✓ | ✓ | ✓ | ✓ | GENUINE |

---

## Conclusion

Every critical business function in the Unlock Content Intelligence platform is **genuinely integrated**. The recommendation engine reads real belief states, send history, and lead intelligence to make contextual decisions. The propagation system correctly cascades review flags through the document dependency graph. The compliance enforcement (ACU locking/prohibition) is enforced at both generation and QC time. The document health check evaluates 7 real dimensions with appropriate severity grading.

The main risks are operational (no tests, filesystem storage, stuck async sessions) rather than architectural (the architecture is sound and the business logic is coherent).
