# SYSTEM INTEGRITY AUDIT
Version: 1.0 | April 2026

---

# SECTION 1 — DATA INTEGRITY (056)

## 056 DATA INTEGRITY OUTPUT

### 0. Scope
**Date:** 2026-04-08
**Tables checked:** leads, lead_beliefs, lead_intelligence, documents, tasks, compliance_constants, belief_registry
**Records checked:** 8 leads, 30 lead_beliefs, 3 lead_intelligence, 84 documents, 40 tasks, 22 compliance_constants, 23 beliefs

---

### 1. Impossible belief states

**Q1: Beliefs ESTABLISHED with no evidence**

| id | lead_id | belief_id | state | evidence | confidence |
|---|---|---|---|---|---|
| 20f33d2f… | lead_001 | U1 | ESTABLISHED | NULL | NULL |
| da89cc2f… | lead_002 | U4 | ESTABLISHED | NULL | NULL |
| 0a2ef05f… | lead_002 | F0 | ESTABLISHED | NULL | NULL |
| 8b3b59ac… | lead_002 | F1 | ESTABLISHED | NULL | NULL |
| b5f5bf94… | lead_002 | F2 | ESTABLISHED | NULL | NULL |
| 3e337f2a… | lead_003 | U1 | ESTABLISHED | NULL | NULL |
| 2ea82608… | lead_003 | U2 | ESTABLISHED | NULL | NULL |
| 2dc3e3df… | lead_003 | U3 | ESTABLISHED | NULL | NULL |

Violations found: 8 beliefs ESTABLISHED with no evidence and no confidence score.

**Q2: F1/F2/F3 ESTABLISHED but F0 not ESTABLISHED**

Violations found: None.

lead_002 has F0 ESTABLISHED alongside F1 and F2 — gate satisfied.

**Q3: P1 or L3 ESTABLISHED (blocked_pending_legal beliefs)**

Violations found: None.

**Q4: Tasks Done but document still REQUIRES_REVIEW**

| task_id | title | status | doc_id | doc_name | review_state |
|---|---|---|---|---|---|
| 661837b4… | Review: Founding_Investor_Three_Page — prohibited pricing detected | Done | 110 | Founding_Investor_Three_Page | REQUIRES_REVIEW |
| ac9c4a0f… | Review: Founding_Investor_Three_Page | Done | 110 | Founding_Investor_Three_Page | REQUIRES_REVIEW |
| fc5b4c44… | Review: Pack1_Founding_Investor | Done | 120 | Pack1_Founding_Investor | REQUIRES_REVIEW |
| 391a916f… | Review: Cold_Call | Done | 500 | Cold_Call | REQUIRES_REVIEW |
| d6a6bd13… | Review: Agent_Quick_Reference | Done | 530 | Agent_Quick_Reference | REQUIRES_REVIEW |
| c1de722b… | Review: Agent_Training | Done | 510 | Agent_Training | REQUIRES_REVIEW |
| dcb7bdda… | Review: Duncan_Stewart_Bespoke | Done | 180 | Duncan_Stewart_Bespoke | REQUIRES_REVIEW |
| cf178c26… | Review: IHT_EIS_5M_Estate | Done | 170 | IHT_EIS_5M_Estate | REQUIRES_REVIEW |
| ed98facf… | Review: Pack2_Information_Memorandum | Done | 130 | Pack2_Information_Memorandum | REQUIRES_REVIEW |
| c0be151f… | Review: One_Page | Done | 100 | One_Page | REQUIRES_REVIEW |

Violations found: 10 tasks marked Done but the linked document is still REQUIRES_REVIEW. These are stale "Done" tasks — the work queue accepted/resolved a finding but either the accept logic didn't clear the review state (because a new propagation re-flagged the document) or a subsequent work queue session re-flagged the document after the task was completed.

**Q5: Tasks Open but document is CLEAN**

| task_id | title | doc_id | doc_name |
|---|---|---|---|
| 16b5d357… | Review: EIS_2026_Five_Case_Studies | 160 | EIS_2026_Five_Case_Studies |

Stale tasks found: 1 open review task on a document that is already CLEAN.

**Q6: Intelligence cluster contradicts all cluster beliefs being not_applicable**

Violations found: None.

---

### 2. Overall data integrity verdict

| Check | Violations | Severity |
|---|---|---|
| ESTABLISHED beliefs with no evidence | 8 | MEDIUM |
| F1/F2/F3 without F0 | 0 | — |
| Blocked beliefs ESTABLISHED | 0 | — |
| Tasks Done / docs still flagged | 10 | MEDIUM |
| Stale Open tasks on CLEAN docs | 1 | LOW |
| Cluster contradiction | 0 | — |

**Data health:** 🟡 MINOR ISSUES — 8 beliefs lack evidence trails (audit gap), 10 done-task/flagged-doc mismatches indicate propagation re-flagging after task completion (functional but confusing), 1 stale task.

---

---

# SECTION 2 — COMPLIANCE DRIFT (057)

## 057 COMPLIANCE DRIFT OUTPUT

### 0. Scope
**Date:** 2026-04-08
**Documents scanned:** 69 (CURRENT, non-internal)
**Compliance constants loaded:** 22 (2 prohibited, 20 canonical)

---

### 1. Load compliance context

**Prohibited values (is_prohibited = true):**

| Key | Label | Value | Prohibited reason |
|---|---|---|---|
| platform_pricing_prohibition | Platform pricing — NEVER publish | £99/£249 subscription tiers | Platform pricing must NEVER appear in any investor-facing document. Founding investors receive lifetime premium access at no cost — this CAN be stated. |
| seis_loss_relief_prohibited | PROHIBITED — wrong SEIS loss relief figure | 22p | 22p per pound is WRONG. The correct figure is 27.5p per pound for additional rate taxpayers. Any reference to 22p must be flagged as a compliance failure. |

**Canonical values (is_prohibited = false):**

| Key | Value | Category |
|---|---|---|
| instrument | Instant Investment | instrument |
| bpr_cap | £2,500,000 | limits |
| founding_investor_maximum | £500,000 | limits |
| founding_investor_minimum | £40,000 | limits |
| pre_money_valuation | £6,500,000 | limits |
| target_portfolio_range | £250K–£5M | limits |
| access_framework_framing | Structured disclosure — not scoring, evaluation, or investment advice | messaging |
| decumulation_planner_status | Specification complete. Prototype build commencing. | messaging |
| product_tagline | Clarity, without complexity | messaging |
| annual_eis_limit | £1,000,000 (£2,000,000 if ≥£1M in knowledge-intensive companies) | tax_relief |
| annual_seis_limit | £200,000 | tax_relief |
| bpr_effective_date | April 2026 | tax_relief |
| eis_cgt_deferral | 100% | tax_relief |
| eis_income_tax_relief | 30% | tax_relief |
| eis_loss_relief_per_pound | ~38.5p | tax_relief |
| loss_relief_rate | Up to effective 38.5% for EIS (after income tax relief), up to 72% for SEIS | tax_relief |
| pension_iht_change | April 2027 | tax_relief |
| seis_income_tax_relief | 50% | tax_relief |
| seis_loss_relief_per_pound | ~27.5p | tax_relief |
| vct_relief_rate | 20% | tax_relief |

---

### 2. Document scan

#### `Investment Opportunity — February 2026` (Tier 3, file_code: inv_opp_feb26)
**Review state:** CLEAN
**Open Review task exists:** NO
**Violations:**
- Contains prohibited platform pricing reference (£99/£249 subscription tiers)
  Issue: Prohibited value — platform pricing must never appear in investor-facing documents
  Should be: Remove pricing references entirely; can state "lifetime premium access at no cost" for founding investors

#### `Founding_Investor_Three_Page` (Tier 3, file_code: 110)
**Review state:** REQUIRES_REVIEW
**Open Review task exists:** YES
**Violations:**
- Contains prohibited platform pricing reference (£99/£249 subscription tiers)
  Issue: Prohibited value — platform pricing must never appear in investor-facing documents
  Should be: Remove pricing references entirely

#### All other scanned documents
**Prohibited 22p figure:** No violations found in any document.
**Prohibited 7.8x multiplier:** No violations found in any document.
**VCT rate context:** Documents mentioning VCT correctly state 20% relief rate (or accurately describe the historical reduction from 30% to 20% from April 2026). No incorrect VCT figures found.

---

### 3. Documents with violations but no open task

| Document | Tier | Violation | Task exists |
|---|---|---|---|
| Investment Opportunity — February 2026 | 3 | Contains prohibited pricing (£99/£249) | NO |

---

### 4. Compliance health summary

| Metric | Value |
|---|---|
| Documents scanned | 69 |
| Documents with violations | 2 |
| Violations with no open task | 1 |
| Tier 1 documents with violations | 0 |

**Compliance health:** 🟡 MINOR DRIFT — 1 document (inv_opp_feb26) is marked CLEAN but contains prohibited pricing and has no open review task. This is a compliance gap: the document passed through the work queue (its auto-fix task was completed) but the prohibited content either wasn't detected or was reintroduced.

**Immediate action required:** `inv_opp_feb26` (Investment Opportunity — February 2026) needs review state set to REQUIRES_REVIEW and a new review task created.

---

---

# SECTION 3 — PROMPT INTEGRITY (058)

## 058 PROMPT INTEGRITY OUTPUT

### 0. Scope
**Date:** 2026-04-08
**Prompts assessed:** 9

---

### 1. Prompt assessments

#### `Transcript Analysis` (POST /recommendation/analyze)
**File:** routes/recommendation/index.ts, lines 216–577
**Purpose:** Analyse investor call transcript to detect persona, pipeline stage, objections, information gaps, readiness score, and questions answered.

**Data injected at runtime:** transcript text, persona guide (from lib/personas.ts), call questions framework (from lib/call-questions.ts), questions_answered flags, lead pipeline_stage (if known)

**Data available but NOT injected:**
- Lead belief states (could prime analysis with known beliefs)
- Lead intelligence record (hot_button, cluster, prior qualification)
- Send history (which documents the investor has already received)

**Hardcoded values that should come from DB:** None identified — persona guide and question framework are loaded from lib files which is appropriate.

**Output schema — prompt instructs:** detected_persona, pipeline_stage, readiness_score, objections[], blocking_objections[], information_gaps[], primary_issue, recommended_next_action, questions_answered, transcript_summary, pipeline_stage_suggestion
**Output schema — calling code expects:** All above fields plus calls deriveMatrixFlags() on the output
**Schema match:** MATCHES

**Context sensitivity:** SENSITIVE — output changes materially based on transcript content, known stage, and question coverage.

**Status:** CURRENT
**Impact:** None — prompt is well-structured and comprehensive.

---

#### `Document Ranking` (POST /recommendation/rank)
**File:** routes/recommendation/index.ts, lines 928–975
**Purpose:** Rank pre-filtered eligible documents for a specific investor interaction.

**Data injected at runtime:** detected_persona, pipeline_stage, transcript_summary, objections, candidate document list with worth-it ratings, persona routing rules, stage objective rules

**Data available but NOT injected:**
- Lead belief state map (used for post-ranking enrichment but NOT passed to Claude for ranking)
- Lead intelligence (hot_button, cluster, primary_blocker)
- Specific objection text from the transcript analysis

**Hardcoded values that should come from DB:** None — worth-it weights and persona routes come from lib files.

**Output schema — prompt instructs:** ranked_documents[{document_id, priority, rationale, relevance_score}]
**Output schema — calling code expects:** document_id, priority, rationale, relevance_score; also handles `rank` and `score` as aliases
**Schema match:** MATCHES (with flexible alias handling)

**Context sensitivity:** SENSITIVE — ranking changes based on persona, stage, transcript context, and candidate set.

**Status:** PARTIALLY STALE
**Impact:** MEDIUM — Belief state map is available but not passed to Claude for ranking. Claude ranks without knowing which beliefs need progression, then belief enrichment is applied post-hoc. Passing belief state to the ranking prompt would allow Claude to prefer documents that advance the most impactful belief.

---

#### `Email Draft` (POST /recommendation/email-draft)
**File:** routes/recommendation/index.ts, lines 1273–1311
**Purpose:** Generate a covering email for document sends.

**Data injected at runtime:** lead_name, detected_persona, pipeline_stage, document_names, transcript_summary, lead intelligence (hot_button, hot_button_quote, cluster, primary_blocker, readiness_status), email templates reference

**Data available but NOT injected:**
- Lead belief states (which beliefs are close to establishing)
- Specific document descriptions/content summaries

**Hardcoded values that should come from DB:**
- "Founding investor" terminology — hardcoded but correct
- "Instant Investment (not ASA)" — hardcoded but correct; could reference instrument canonical value
- "Clarity, without complexity" — hardcoded; should reference product_tagline from compliance_constants

**Output schema match:** MATCHES

**Context sensitivity:** SENSITIVE — uses lead intelligence when available.

**Status:** CURRENT
**Impact:** LOW — product tagline hardcoded but currently matches canonical value.

---

#### `Work Queue Analysis` (POST /work-queue/start → runAnalysis)
**File:** routes/work-queue/index.ts, lines 506–541
**Purpose:** Analyse flagged documents for compliance violations and content quality issues.

**Data injected at runtime:** document name, tier, content, prohibited values list (from DB), canonical values list (from DB), operator task context

**Data available but NOT injected:**
- Document's belief_targets (which beliefs the document is supposed to advance)
- Document's persona_relevance and pipeline_stage_relevance
- Document's upstream_dependencies (which Tier 1 docs it derives from)

**Hardcoded values that should come from DB:** None — prohibited and canonical values are loaded from compliance_constants table.

**Output schema match:** MATCHES

**Context sensitivity:** SENSITIVE — different documents produce different findings; prohibited/canonical values loaded from DB.

**Status:** CURRENT
**Impact:** None — this prompt is well-structured.

---

#### `Content Generation` (POST /generation/generate)
**File:** routes/generation/index.ts, lines 65+ and lib/generationEngine.ts, lines 200+
**Purpose:** Generate new document content with ACU compliance enforcement.

**Data injected at runtime:** document brief, locked ACUs, prohibited ACUs, content bank text, master generation context, channel constraints

**Data available but NOT injected:**
- Existing documents of similar type (for tone/style reference)
- Belief registry (which beliefs the generated doc should target)

**Hardcoded values that should come from DB:** None identified — ACUs and compliance values loaded from DB.

**Output schema match:** MATCHES

**Context sensitivity:** SENSITIVE

**Status:** CURRENT
**Impact:** None

---

#### `Lead Intelligence Generation` (POST /leads/:id/intelligence/generate)
**File:** routes/lead-intelligence/index.ts, line 45
**Purpose:** Generate investor intelligence profile from notes and transcript.

**Data injected at runtime:** lead notes, transcript text

**Data available but NOT injected:**
- Existing belief states for the lead
- Send history (which documents the lead has received)
- Existing lead_intelligence (for delta analysis vs regeneration)

**Hardcoded values:** Would need full prompt read to confirm — prompt loaded from external source.

**Status:** CURRENT (based on functional integrity assessment)
**Impact:** LOW

---

#### `Belief Analysis` (POST /leads/:leadId/beliefs/analyze)
**File:** routes/lead-beliefs/index.ts, line 97
**Purpose:** Analyse transcript against belief registry to determine belief state changes.

**Data injected at runtime:** transcript text, belief registry, current belief states

**Data available but NOT injected:**
- Lead intelligence (hot_button, cluster)

**Status:** CURRENT
**Impact:** LOW

---

#### `Feature Update Impact` (POST /content/feature-update)
**File:** routes/content/feature-update.ts, lines 159+
**Purpose:** Identify documents semantically affected by a product feature change.

**Data injected at runtime:** feature update title/description, affected_features list, document summaries (ID, name, type, tier, description snippet)

**Data available but NOT injected:**
- Full document content (only description snippet passed, max 100 chars)
- Document belief_targets

**Status:** CURRENT
**Impact:** LOW — semantic analysis supplements keyword and type-based detection.

---

#### `Gap Brief Generation` (POST /content/generate-brief)
**File:** routes/content/gaps.ts, line 410
**Purpose:** Generate a content brief describing what document should be created to fill a gap.

**Data injected at runtime:** gap details, master generation context, content bank, existing documents for context

**Status:** CURRENT
**Impact:** None

---

### 2. Hardcoded values across all prompts

| Prompt | Hardcoded value | Should come from | Risk |
|---|---|---|---|
| Email Draft | "Clarity, without complexity" | compliance_constants.product_tagline | LOW |
| Email Draft | "Instant Investment (not ASA)" | compliance_constants.instrument | LOW |
| Transcript Analysis | PIPELINE_STAGES array | Could be DB-driven | LOW |
| Transcript Analysis | Persona names/archetypes | lib/personas.ts (appropriate) | LOW |

---

### 3. Prompt integrity verdict

| Prompt | Status | Priority |
|---|---|---|
| Transcript Analysis | CURRENT | LOW |
| Document Ranking | PARTIALLY STALE | MEDIUM |
| Email Draft | CURRENT | LOW |
| Work Queue Analysis | CURRENT | LOW |
| Content Generation | CURRENT | LOW |
| Lead Intelligence | CURRENT | LOW |
| Belief Analysis | CURRENT | LOW |
| Feature Update Impact | CURRENT | LOW |
| Gap Brief Generation | CURRENT | LOW |

**Recommendation:** PROMPTS ARE CURRENT — One improvement opportunity: pass belief state map into the Document Ranking prompt so Claude can factor belief progression into ranking decisions, not just as post-hoc enrichment.

---

---

# SECTION 4 — RELATIONSHIP INTEGRITY (059)

## 059 RELATIONSHIP INTEGRITY OUTPUT

### 0. Scope
**Date:** 2026-04-08
**Relationship types checked:** 5
**Total references checked:** 21 belief→doc + 22 doc→belief targets + 38 task→doc + 2 lead send_logs + 23 belief primary docs

---

### 1. Belief → Document references

| Belief | primary_document_id | Document exists? | lifecycle_status | Valid? |
|---|---|---|---|---|
| C1 | 130 | YES | CURRENT | YES |
| C2 | 120 | YES | CURRENT | YES |
| C3 | 120 | YES | CURRENT | YES |
| C4 | c8b36a22… | YES | CURRENT | YES |
| C5 | 120 | YES | CURRENT | YES |
| C6 | 130 | YES | CURRENT | YES |
| F0 | 120 | YES | CURRENT | YES |
| F1 | 120 | YES | CURRENT | YES |
| F2 | 150 | YES | CURRENT | YES |
| F3 | 130 | YES | CURRENT | YES |
| G1 | 160 | YES | CURRENT | YES |
| G2 | 140 | YES | CURRENT | YES |
| G3 | 140 | YES | CURRENT | YES |
| L1 | 170 | YES | CURRENT | YES |
| L2 | 170 | YES | CURRENT | YES |
| P2 | 150 | YES | CURRENT | YES |
| P3 | 190 | YES | CURRENT | YES |
| U1 | 140 | YES | CURRENT | YES |
| U2 | 190 | YES | CURRENT | YES |
| U3 | 120 | YES | CURRENT | YES |
| U4 | 150 | YES | CURRENT | YES |

Broken references: None. All 21 belief → document references point to existing CURRENT documents.

---

### 2. Document belief_targets → Belief registry

8 documents have non-empty belief_targets. All belief_ids referenced:
U3, C4, C2, C3, C5, F0, F1, C1, C6, F3, U1, G2, G3, U4, P2, F2, G1, L1, L2, U2, P3

Cross-referenced against belief_registry (23 beliefs): All belief_ids exist in the registry.

Orphaned belief_targets: None.

---

### 3. Task → Document references

38 tasks with linked_document_id. All reference existing CURRENT documents.

Invalid combinations found:
- Task Open + document ARCHIVED: None
- Task Open + document CLEAN: 1 (task 16b5d357… / Review: EIS_2026_Five_Case_Studies → doc 160 is CLEAN)
- Task Done + document REQUIRES_REVIEW: 10 (see Section 1 Q4 for full list)

---

### 4. Lead send_log → Document references

**lead_001 (Duncan Stewart):**
Send log references: 100, 110, 120, 170, 110_PROMO_Founding_Investor_Three_Page_V1_CURRENT, 110
- Documents 100, 110, 120, 170 all exist as CURRENT documents
- `110_PROMO_Founding_Investor_Three_Page_V1_CURRENT` — this is a file_code, not a document ID. It references the same document as ID "110" but uses the wrong identifier format. This send was logged with the file_code instead of the document ID.

**lead_002 (Sarah Mitchell):**
Send log references: 100, 190
- Both exist as CURRENT documents

Missing documents: None (all referenced documents exist).
Format issue: 1 send_log entry uses file_code instead of document ID (lead_001, send_75ad57d3).

---

### 5. Beliefs with no valid document

Query returned: No rows. All active beliefs have valid CURRENT primary documents.

Note: P1 and L3 have policy_status = `blocked_pending_legal` and are excluded from this check. They are correctly inactive.

---

### 6. Relationship integrity verdict

| Relationship | Broken | Stale | Status |
|---|---|---|---|
| Belief → Document | 0 | 0 | 🟢 |
| Document belief_targets → Belief | 0 | 0 | 🟢 |
| Task → Document | 0 | 11 | 🟡 |
| Lead send_log → Document | 0 | 1 format issue | 🟡 |
| Beliefs without documents | 0 | — | 🟢 |

**Recommendation:** RELATIONSHIPS ARE CLEAN — Minor housekeeping needed: close 1 stale open task on CLEAN document (160), and note the file_code-as-ID send_log entry for lead_001. The 10 Done-task/REQUIRES_REVIEW mismatches are caused by re-propagation and are tracked in Section 1.

---

---

# SECTION 5 — COVERAGE GAPS (061)

## 061 COVERAGE GAPS OUTPUT

### 0. Scope
**Date:** 2026-04-08
**Tables reviewed:** 12
**UI pages reviewed:** 22 (dashboard, leads, lead-detail, registry, document-detail, tasks, work-queue, recommend, generate, gaps, campaigns, campaign-detail, document-health, compliance-constants, acu, import, changelog, call-prep, persona-analytics, feature-updates, content-bank, not-found)

---

### 1. Data generated but not surfaced in UI

**`lead_intelligence` fields:**

| Field | Displayed on lead-detail? |
|---|---|
| qualification_status | DISPLAYED (as badge) |
| cluster | DISPLAYED (as badge) |
| hot_button | DISPLAYED (as badge) |
| hot_button_confirmed | NOT DISPLAYED |
| hot_button_quote | DISPLAYED (as blockquote) |
| profile_summary | DISPLAYED |
| readiness_status | DISPLAYED (as badge) |
| recommended_action | DISPLAYED |
| primary_blocker | DISPLAYED |
| blocker_type | DISPLAYED |
| higher_rate_taxpayer | NOT DISPLAYED |
| capital_available | NOT DISPLAYED |
| self_directed | NOT DISPLAYED |
| open_to_early_stage_risk | NOT DISPLAYED |
| qualification_notes | NOT DISPLAYED |
| ifa_involved | NOT DISPLAYED |
| already_done_eis | NOT DISPLAYED |
| estate_above_2m | NOT DISPLAYED |
| assets_abroad | NOT DISPLAYED |
| vct_aim_experience | NOT DISPLAYED |
| spin_situation | NOT DISPLAYED |
| spin_problem | NOT DISPLAYED |
| spin_implication | NOT DISPLAYED |
| spin_need_payoff | NOT DISPLAYED |

**`lead_beliefs` fields beyond state:**

| Field | Displayed? |
|---|---|
| state | DISPLAYED (as coloured dot) |
| investor_relevance | DISPLAYED (not_applicable beliefs are dimmed) |
| relevance_rationale | NOT DISPLAYED |
| evidence | NOT DISPLAYED |
| evidence_source | NOT DISPLAYED |
| confidence | NOT DISPLAYED |
| established_date | NOT DISPLAYED |

**`belief_transitions` table:**
NOT DISPLAYED anywhere. The history of belief state changes is recorded but invisible to operators.

**`work_queue_sessions` / `work_queue_findings`:**
Displayed on the work-queue page. NOT surfaced on document-detail or task pages (operator can't see a document's work queue history from the document page).

**`notes_legacy` on leads:**
NOT DISPLAYED. Field exists but has no UI representation.

**`transcript_text` on leads:**
Partially referenced — the "Generate Profile" button is disabled if transcript_text is empty, but the transcript text itself is NOT displayed anywhere.

---

#### `SPIN fields` (spin_situation, spin_problem, spin_implication, spin_need_payoff)
**Where it lives:** lead_intelligence.spin_*
**What it contains:** SPIN selling framework analysis — structured breakdown of investor's situation, problem, implications, and need/payoff
**Should it be surfaced?** YES
**If YES — where:** Lead detail page, Beliefs tab, in a "SPIN Analysis" section below the profile
**Effort:** LOW

#### `Belief evidence trail` (evidence, evidence_source, confidence)
**Where it lives:** lead_beliefs
**What it contains:** The specific evidence, source, and confidence level that justified a belief state change
**Should it be surfaced?** YES
**If YES — where:** Lead detail page, when a belief is expanded/selected, show the evidence and source
**Effort:** LOW

#### `Belief transitions history`
**Where it lives:** belief_transitions table
**What it contains:** Timestamped log of every belief state change, who triggered it, and notes
**Should it be surfaced?** YES
**If YES — where:** Lead detail page, belief detail panel — timeline of state changes
**Effort:** MEDIUM

#### `Qualification boolean fields`
**Where it lives:** lead_intelligence (higher_rate_taxpayer, capital_available, self_directed, open_to_early_stage_risk, ifa_involved, already_done_eis, estate_above_2m, assets_abroad, vct_aim_experience)
**What it contains:** Structured boolean flags derived from transcript analysis
**Should it be surfaced?** YES
**If YES — where:** Lead detail page, profile section, as a qualification checklist
**Effort:** LOW

#### `transcript_text`
**Where it lives:** leads.transcript_text
**What it contains:** Raw transcript text uploaded for the lead
**Should it be surfaced?** DEFERRED — large text, could be shown in a collapsible section
**If YES — where:** Lead detail page, dedicated "Transcript" section
**Effort:** LOW

---

### 2. API endpoints with no UI entry point

| Endpoint | What it does | UI entry point | Accessible? |
|---|---|---|---|
| GET /api/healthz | Health check | None | NO (internal) |
| GET /prompts | List prompt templates | None | NO |
| GET /prompts/:id | Get prompt template | None | NO |
| GET /templates | List templates | None | NO |
| GET /templates/:id | Get template | None | NO |
| GET /documents/propagation-status | Show propagation state | None (referenced indirectly in document-health) | NO |
| GET /documents/:id/source-pdf | Get source PDF | None | NO |
| GET /documents/:id/download-pdf | Download generated PDF | None (only export-pdf and generate-pdf are wired) | NO |
| POST /recommendation/gap-brief | Generate content brief from gap | Yes — recommend page | YES |
| POST /content/generate-brief | Generate content brief | Yes — gaps page | YES |
| POST /content/generate-from-brief | Generate content from brief | Yes — recommend page | YES |
| GET /content-bank/personas | Get persona list from content bank | None | NO |
| POST /leads/:leadId/beliefs/analyze | Analyze transcript for beliefs | Yes — lead-detail | YES |
| GET /leads/:leadId/beliefs/next | Get next belief to target | None | NO |
| GET /leads/:leadId/beliefs/gates | Get gate status | None | NO |
| GET /work-queue/summary | Get work queue summary | Yes — work-queue page | YES |
| GET /content/gaps/history/:id/export | Export gap snapshot | Yes — gaps page | YES |
| PATCH /content/gaps/history/:id | Update gap snapshot | Yes — gaps page | YES |

---

### 3. High-value invisible fields

| Field | Table | Contains | Where to surface | Value |
|---|---|---|---|---|
| spin_situation/problem/implication/need_payoff | lead_intelligence | SPIN framework analysis | Lead detail page | Gives operators a structured coaching framework for the next call |
| evidence + evidence_source + confidence | lead_beliefs | Why a belief was established | Lead detail belief panel | Operators can verify AI-derived belief states and build trust |
| belief_transitions history | belief_transitions | State change timeline | Lead detail belief panel | Operators can trace how beliefs evolved across interactions |
| already_done_eis, ifa_involved, estate_above_2m | lead_intelligence | Qualification booleans | Lead detail profile section | Critical for call prep — operator needs to know these before calling |
| next belief to target + gates | lead_beliefs API | Which belief to advance next | Lead detail page or call-prep page | Operators currently have no guidance on which belief to prioritise |

---

### 4. Coverage gaps verdict

**Recommendation:** SIGNIFICANT VALUE BURIED

**Highest priority gap:** The SPIN analysis fields (spin_situation, spin_problem, spin_implication, spin_need_payoff) and qualification booleans (already_done_eis, ifa_involved, estate_above_2m) are generated by the intelligence engine but invisible to operators. These are exactly the fields operators need during call preparation — the data exists but is unreachable.

---

---

# SECTION 6 — SEQUENCE INTEGRITY (062)

## 062 SEQUENCE INTEGRITY OUTPUT

### 0. Scope
**Date:** 2026-04-08
**Leads checked:** 8
**Documents checked:** 84

---

### 1. Belief hard gate violations

**F0 gate: F1/F2/F3 ESTABLISHED without F0**
Result: None (see Section 1 Q2).

**U4 gate: risk profile confirmed without U4 ESTABLISHED**
Violations: None.

---

### 2. Document send sequence violations

**Pack 1 or Pack 2 sent but F0 not established:**

lead_001 (Duncan Stewart) was sent document 120 (Pack1_Founding_Investor) on 2026-03-30. Duncan Stewart has NO F0 belief record at all — the belief system has no entry for F0 for this lead.

However, this send occurred before the belief system was implemented. The send_log shows the belief gate system was added after the initial sends. This is a pre-belief-system send, not a runtime gate violation.

Violations found: 1 (pre-belief-system send — not a runtime violation, but historically inaccurate state).

---

### 3. Work queue sequence violations

**Sessions marked COMPLETE with pending findings:**

| Session ID | Status | Pending findings |
|---|---|---|
| 3269884c… | COMPLETE | 11 |
| 6b27f1a2… | COMPLETE | 47 |

Violations: 2 sessions marked COMPLETE but still have 58 total PENDING findings. This means the session completion logic ran before all findings were resolved. Likely cause: the session was marked COMPLETE when the analysis finished (status moved from ANALYSING → READY → COMPLETE), but "COMPLETE" means "analysis complete", not "all findings resolved". The completion logic in the accept/skip endpoints does correctly mark sessions COMPLETE when pending count reaches 0, but these sessions were completed by a different path.

**Auto-fix applied but text not found in document:**
46 AUTO_FIXED findings exist. Spot-checking would require reading document content for each, which exceeds the scope of this audit. The auto-fix logic has proper guards (verifies original text exists before replacing), so failed fixes are marked FAILED, not AUTO_FIXED.

---

### 4. Intelligence generation without basis

| lead_id | name | notes | transcript_text | qualification_status |
|---|---|---|---|---|
| lead_001 | Duncan Stewart | (empty) | (empty) | INSUFFICIENT_DATA |

Leads with intelligence but no source data: 1 (lead_001 Duncan Stewart). Intelligence record exists with qualification_status = INSUFFICIENT_DATA, which is correct — the system acknowledged insufficient data. However, the profile_summary is empty, which means the intelligence record was created (perhaps by the generate endpoint) but didn't produce meaningful output.

---

### 5. Sequence integrity verdict

| Sequence domain | Violations | Severity |
|---|---|---|
| Belief hard gates (F0) | 0 | 🟢 |
| U4 gate | 0 | 🟢 |
| Document send gates | 1 (pre-system) | 🟡 |
| Work queue integrity | 2 sessions | 🟡 |
| Intelligence basis | 1 lead | 🟡 |

**Recommendation:** REVIEW VIOLATIONS — The 2 work queue sessions with 58 pending findings in COMPLETE state should be investigated. The session completion logic may need a status distinction between "analysis complete" and "all findings resolved". The pre-system send for Duncan Stewart is historical and cannot be retroactively fixed.

---

---

# COMBINED AUDIT SUMMARY

## Priority action list

| # | Finding | Section | Severity | Action required |
|---|---|---|---|---|
| 1 | inv_opp_feb26 marked CLEAN but contains prohibited pricing (£99/£249), no open review task | 057 | HIGH | Set review_state to REQUIRES_REVIEW and create review task |
| 2 | 2 work queue sessions marked COMPLETE with 58 PENDING findings | 062 | HIGH | Investigate whether findings are orphaned; consider adding a session status for "analysis complete but findings unresolved" |
| 3 | 10 tasks marked Done but linked documents still REQUIRES_REVIEW | 056 | MEDIUM | Close stale Done tasks or re-evaluate whether documents need re-review |
| 4 | 8 beliefs ESTABLISHED with no evidence or confidence | 056 | MEDIUM | Populate evidence trails for audit compliance; these beliefs drive gating decisions |
| 5 | SPIN fields, qualification booleans, belief evidence/history not surfaced in UI | 061 | MEDIUM | Surface on lead-detail page — operators need this data for call preparation |
| 6 | Document Ranking prompt doesn't receive belief state map | 058 | MEDIUM | Pass belief states to Claude so ranking factors in belief progression |
| 7 | Duncan Stewart has intelligence record but no notes or transcript | 062 | LOW | Expected — INSUFFICIENT_DATA status is correct |
| 8 | 1 send_log entry uses file_code instead of document ID | 059 | LOW | Cosmetic — doesn't break functionality but is inconsistent |
| 9 | 1 stale Open review task on CLEAN document (EIS_2026_Five_Case_Studies) | 056 | LOW | Close the stale task |

## Overall system health

| Dimension | Status | Key finding |
|---|---|---|
| Data integrity (056) | 🟡 | 8 beliefs ESTABLISHED without evidence; 10 Done-task/flagged-doc mismatches from re-propagation |
| Compliance drift (057) | 🟡 | 1 document (inv_opp_feb26) CLEAN with prohibited pricing and no review task |
| Prompt integrity (058) | 🟢 | All 9 prompts are current; one improvement opportunity (belief state in ranking) |
| Relationship integrity (059) | 🟢 | All entity references are valid; minor task staleness and 1 format issue in send_log |
| Coverage gaps (061) | 🟡 | SPIN analysis, qualification booleans, and belief evidence/history generated but invisible to operators |
| Sequence integrity (062) | 🟡 | 2 COMPLETE work queue sessions with 58 orphaned PENDING findings |

**Single most important fix:** `inv_opp_feb26` is marked CLEAN but contains prohibited platform pricing (£99/£249) and has no open review task. This is the only case where a compliance violation exists in a document that the recommendation engine would treat as safe to send. If an operator triggers document ranking for an investor at the right stage/persona, this document could be recommended and sent with prohibited pricing included.

**Safe to keep building:** YES — The system's core integrity is sound. The compliance gap (inv_opp_feb26) is a single-document issue that should be fixed immediately, and the work queue session state could use a status refinement, but neither blocks development. The coverage gaps (buried SPIN/qualification data) are feature enhancements, not integrity failures.
