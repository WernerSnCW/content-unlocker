# 100 — CURRENT STATE OUTPUT
## Unlock Content Intelligence Platform — Full Codebase Audit
**Scan date:** 2026-04-05  
**Auditor:** AI Agent (full-scan, all files read)  
**Codebase lines (approx):** ~18,500 (backend ~10,400 + frontend ~8,000 + DB schema ~400)

---

## 1. DATABASE LAYER

### 1.1 Schema Files (14 tables across 14 files — `lib/db/src/schema/`)

| Table | File | Cols | Primary Key | Purpose |
|-------|------|------|-------------|---------|
| `documents` | documents.ts | 30 | text `id` | Document Registry — all content documents including generated ones |
| `changelog` | changelog.ts | 7 | text `id` | Document change history (propagation-aware) |
| `approved_content_units` | acu.ts | 16 | text `id` | ACU master table — locked facts, figures, compliance statements |
| `acu_candidates` | acu-intelligence.ts | 14 | text `id` | Scanned candidate content units pending review |
| `acu_contradictions` | acu-intelligence.ts | 10 | text `id` | Detected contradictions between ACUs |
| `acu_scan_log` | acu-intelligence.ts | 7 | text `id` | Scan audit log (documents scanned, candidates found, duration) |
| `campaigns` | campaigns.ts | 27 | text `id` | Campaign Intelligence — brief, sequence, QC, activation |
| `campaign_assets` | campaigns.ts | 14 | text `id` | Individual campaign assets (content per node) |
| `channels` | channels.ts | 18 | text `id` | Channel definitions (email, call, WhatsApp, LinkedIn, ads) |
| `output_templates` | output-templates.ts | 12 | text `id` | Template Registry (22 templates, section-level structure) |
| `system_prompts` | system-prompts.ts | 8 | text `id` | Prompt Registry (P001–P004) |
| `leads` | leads.ts | 11 | text `id` | Lead management (name, email, persona, stage, score) |
| `videos` | videos.ts | 10 | text `id` | Video registry (Wistia integration) |
| `gap_snapshots` | gap-snapshots.ts | 5 | text `id` | Content gap analysis snapshots |
| `conversations` | conversations.ts | 5 | text `id` | Conversation threads |
| `messages` | messages.ts | 7 | text `id` | Chat messages within conversations |

### 1.2 Key Schema Details

**documents** notable columns:
- `is_generated` (boolean) — distinguishes AI-generated from source docs
- `generation_brief_id`, `generation_attempt`, `qc_report_id` — generation metadata
- `source_pdf_path`, `source_pdf_filename`, `source_pdf_imported_at` — PDF import tracking
- `content` (text) — full document content stored inline
- `qc_history` (jsonb) — array of QC run results
- `output_type`, `channel`, `campaign_id`, `sequence_position`, `sequence_id`, `branch_condition` — campaign/template linkage
- `gdoc_id`, `gdoc_url` — Google Docs integration fields
- `upstream_dependencies`, `downstream_dependents` — propagation graph (jsonb arrays)

**approved_content_units** notable columns:
- `expression_variants` (jsonb) — approved alternative wordings
- `cascade_on_change` (boolean) — triggers document review cascade on update
- `requires_qualifier` (text) — e.g., "subject to individual tax circumstances"
- `parent_concept_id`, `is_expression_variant`, `variant_audience`, `supersedes`, `policy_status` — ACU hierarchy & lifecycle

**campaigns** notable columns:
- `target_cluster`, `personas` (jsonb), `entry_stage`, `target_stage` — audience targeting
- `primary_belief`, `secondary_beliefs` (jsonb) — belief-led targeting
- `sequence` (jsonb) — full campaign node sequence
- `qc_status`, `qc_report` (jsonb) — campaign-level QC
- `prohibited_acus`, `blocked_content`, `compliance_constraints` (jsonb) — compliance controls
- `activated_at` — activation timestamp (null = not yet activated)

---

## 2. BACKEND ROUTES

### 2.1 Route Registry (18 route files — `artifacts/api-server/src/routes/`)

| Route File | Lines | Prefix | Key Endpoints |
|------------|-------|--------|---------------|
| generation/index.ts | 924 | `/generation` | POST `/from-template`, POST `/qc`, POST `/regenerate` |
| recommendation/index.ts | 1178 | `/recommendation` | POST `/analyze`, POST `/rank`, POST `/confirm-send`, POST `/email-draft`, POST `/gap-brief`, POST `/upload-transcripts` |
| documents/index.ts | 637 | `/documents` | GET `/`, GET `/:id`, POST `/`, PUT `/:id`, POST `/import-pdf`, POST `/:id/quality-score`, GET `/propagation-status` |
| acu/index.ts | 583 | `/acu` | GET `/`, GET `/:id`, POST `/`, PUT `/:id`, POST `/scan`, POST `/approve`, POST `/lock`, POST `/cascade`, POST `/:id/resolve-contradiction`, GET `/contradictions`, GET `/candidates`, GET `/scan-log` |
| campaigns/index.ts | 550 | `/campaigns` | GET `/`, GET `/:id`, POST `/`, POST `/:id/sequence`, POST `/:id/qc`, POST `/:id/activate`, POST `/:id/assets`, GET `/:id/export` |
| leads/index.ts | 329 | `/leads` | GET `/`, GET `/:id`, POST `/`, PUT `/:id`, POST `/:id/next-action` |
| gdocs/index.ts | 206 | `/gdocs` | POST `/create`, POST `/sync`, GET `/:id/status` |
| content/index.ts | 144 | `/content` | GET `/bank`, GET `/pipeline`, GET `/usage-matrix` |
| dashboard/index.ts | 139 | `/dashboard` | GET `/stats`, GET `/recent-activity`, GET `/compliance-summary` |
| videos/index.ts | 137 | `/videos` | GET `/`, GET `/:id`, POST `/`, PUT `/:id` |
| analytics/index.ts | 113 | `/analytics` | GET `/personas`, GET `/pipeline`, GET `/content-coverage` |
| templates/index.ts | 32 | `/templates` | GET `/`, GET `/:id` |
| prompts/index.ts | 23 | `/prompts` | GET `/`, GET `/:id` |
| call-framework/index.ts | 14 | `/call-framework` | GET `/` |
| health.ts | 11 | `/health` | GET `/health` |
| index.ts | 36 | — | Router aggregator (mounts all sub-routers) |

### 2.2 Route Ordering Rules (Critical)

**documents/index.ts** — static routes BEFORE parameterized:
1. `GET /documents` (list)
2. `GET /documents/propagation-status`
3. `POST /documents/import-pdf`
4. `POST /documents/:id/quality-score`
5. `GET /documents/:id`
6. Other `/:id` routes

**acu/index.ts** — static routes BEFORE parameterized:
1. `GET /acu` (list)
2. `GET /acu/contradictions`
3. `GET /acu/candidates`
4. `GET /acu/scan-log`
5. `POST /acu/scan`
6. `POST /acu/approve`
7. `POST /acu/lock`
8. `POST /acu/cascade`
9. `GET /acu/:id`
10. `PUT /acu/:id`

---

## 3. LIBRARY LAYER

### 3.1 Lib Files (12 files — `artifacts/api-server/src/lib/`)

| File | Lines | Purpose |
|------|-------|---------|
| templates/index.ts | 449 | Template rendering engine — section-by-section output with brand constants |
| campaignGenerator.ts | 390 | Campaign sequence AI generation — builds multi-node sequences with channel constraints |
| dataManager.ts | 385 | Data seeding & initialisation — registry, leads, ACUs, channels, templates, prompts |
| acuContradictionDetector.ts | 314 | AI-powered contradiction detection between ACUs (P002 prompt) |
| generationEngine.ts | 249 | Template-aware document generation engine (P004 prompt, MUST NOT MODIFY) |
| campaignQC.ts | 218 | Campaign QC engine — validates all assets against channel constraints + ACU compliance |
| acuScanner.ts | 209 | Document scanner — extracts ACU candidates via AI (P001 prompt) |
| recommendation-context.ts | 166 | Recommendation context builder — prepares lead+document context for AI |
| channelConstraints.ts | 129 | Channel validation — word/line/sentence/char/link limits + prohibited terms |
| propagation.ts | 110 | Document propagation engine — cascade review triggers on ACU changes |
| brand.ts | 34 | Brand constants (colours, fonts, spacing, typography) |
| logger.ts | 20 | Pino logger configuration |

### 3.2 Key Engine Details

**generationEngine.ts** (DO NOT MODIFY):
- `generateFromTemplate(templateId, overrides?)` — generates content section-by-section
- Fetches template + locked ACUs from DB
- Calls Anthropic `claude-sonnet-4-6` with P004 prompt
- Returns `{ sections, metadata }` — does NOT persist to DB
- Persistence happens in `POST /generation/from-template` route handler (creates doc with `gen_tmpl_` prefix ID)

**19-Check QC Engine** (in generation/index.ts `POST /qc`):

| # | Check | Type |
|---|-------|------|
| 1 | PROHIBITED_CONTENT | Scans for `22p`, `7.8x`, `78x`, `April 6` prohibited figures |
| 2 | REQUIRED_ACU_PRESENT | Verifies all required ACUs from template are in content |
| 3 | WORD_COUNT | Per-section word count vs template max_words |
| 4 | SECTION_COMPLETENESS | All required sections present |
| 5 | QUALIFIER_PRESENCE | Required qualifiers (e.g., "subject to individual tax circumstances") |
| 6 | TAX_FIGURE_ACCURACY | Cross-references tax figures against compliance_constants |
| 7 | PROHIBITED_ACU_LEAK | Checks no prohibited ACU content leaked in |
| 8 | TONE_CHECK | Institutional tone — flags salesy/promotional language |
| 9 | CTA_COUNT | Max CTAs per template formatting rules |
| 10 | LINK_VALIDATION | URL format + count limits |
| 11 | COMPLIANCE_FOOTER | Presence check for parent template compliance footer |
| 12 | PAST_PERFORMANCE | Flags "past performance" without proper disclaimer |
| 13 | CAPITAL_AT_RISK | Verifies capital at risk warning present where required |
| 14 | VERBATIM_INTEGRITY | Checks verbatim ACU injections haven't been paraphrased |
| 15 | CHANNEL_COMPLIANCE | Channel-specific constraints (via channelConstraints.ts) |
| 16 | SENTENCE_COUNT | Per-section sentence limits |
| 17 | NARRATIVE_GUIDANCE | Checks adherence to section narrative_guidance |
| 18 | IMAGE_POLICY | Image count/presence per template rules |
| 19 | UNSUBSCRIBE | Unsubscribe requirement for email channels |
| 100+ | ACU_CHECKS | `runACUChecks()` — acu_22p_prohibited, acu_78x_prohibited detection |

Additional QC features:
- `CHUNK_THRESHOLD = 15000` — content over this length is chunked for QC
- Chunk sampling: first, mid, last chunks if >3 chunks
- False-positive auto-resolver: normalises `offending_text` vs `correct_version` (case, whitespace, punctuation)
- ACU pre-check: halts generation if prohibited content detected before full QC

---

## 4. TEMPLATE REGISTRY

### 4.1 All 22 Templates (seeded via `seed-templates.ts`)

| # | Template ID | Name | Output Type | Channel | Parent |
|---|------------|------|-------------|---------|--------|
| 1 | tmpl_base_investor_compliance | Base Investor Compliance | base | — | — |
| 2 | tmpl_email_cold | Cold outreach email | email | email_cold | — |
| 3 | tmpl_email_warm_e3 | Social proof email (E3) | email | email_warm | — |
| 4 | tmpl_email_urgency_e4 | Urgency email (E4 — January 2027 head-start) | email | email_warm | — |
| 5 | tmpl_email_final_e5 | Final email (E5) | email | email_warm | — |
| 6 | tmpl_call_script | Call script (CS1/CS2/CS3) | call_script | call_script | — |
| 7 | tmpl_voicemail | Voicemail script (VM1/VM2) | voicemail | voicemail | — |
| 8 | tmpl_linkedin_inmail | LinkedIn InMail (LI1) | linkedin_message | linkedin_message | — |
| 9 | tmpl_whatsapp_wa1 | WhatsApp report delivery (WA1) | whatsapp_template | whatsapp | — |
| 10 | tmpl_meta_ad_brief | Meta ad creative brief (AD1) | ad_brief | meta_ad | — |
| 11 | tmpl_display_ad_brief | Display ad creative brief (AD3) | ad_brief | display_ad | — |
| 12 | tmpl_campaign_plan_export | Campaign plan document export | campaign_plan | — | — |
| 13 | tmpl_whitepaper_standard | Whitepaper (investor-facing) | whitepaper | — | tmpl_base_investor_compliance |
| 14 | tmpl_one_pager | One-pager (investor-facing) | one_pager | — | tmpl_base_investor_compliance |
| 15 | tmpl_three_pager | Three-pager (founding investor overview) | three_pager | — | tmpl_base_investor_compliance |
| 16 | tmpl_pack_1_founding_brief | Pack 1 — Founding Investor Brief | pack_1 | — | tmpl_base_investor_compliance |
| 17 | tmpl_pack_2_im | Pack 2 — Information Memorandum | pack_2 | — | tmpl_base_investor_compliance |
| 18 | tmpl_case_studies | EIS case studies | case_studies | — | tmpl_base_investor_compliance |
| 19 | tmpl_estate_planning | Estate planning document (IHT/EIS) | estate_planning | — | tmpl_base_investor_compliance |
| 20 | tmpl_explainer | Product explainer | explainer | — | tmpl_base_investor_compliance |
| 21 | tmpl_agent_card | Agent quick reference card | internal | — | — |
| 22 | tmpl_adviser_briefing | Adviser/accountant briefing note | adviser_briefing | — | tmpl_base_investor_compliance |

### 4.2 Template Hierarchy
- **Base template** (`tmpl_base_investor_compliance`): compliance footer with `acu_capital_at_risk`, `acu_tax_circumstances`, `acu_not_advice` — inherited by 10 child templates
- **Standalone templates** (no parent): email E1–E5, call script, voicemail, LinkedIn, WhatsApp, Meta ad, display ad, campaign plan, agent card
- **Prohibited ACU enforcement**: `acu_22p_prohibited`, `acu_78x_prohibited`, `acu_april6_deadline_prohibited` blocked on most templates; `acu_jan_2027_structure` blocked on Pack 1, estate planning, E4

### 4.3 Template Section Structure
Each template defines an array of sections with:
- `id`, `label`, `required` (boolean)
- Content constraints: `max_words`, `max_sentences`, `max_chars`, `max_seconds`, `count`
- ACU binding: `required_acu_ids`, `accepted_topics`, `injection_mode` (verbatim_block | verbatim_inline)
- `narrative_guidance` — instruction text for the generation engine
- `qualifier_rendering` — how to position qualifiers (inline_after_fact | block_at_end)

---

## 5. PROMPT REGISTRY

### 5.1 All 4 System Prompts (seeded via `seed-prompts.ts`)

| ID | Name | Location | Rubric | Status |
|----|------|----------|--------|--------|
| P001 | ACU Content Scanner | acuScanner.ts — scanDocument() | 11 | ACTIVE |
| P002 | Contradiction Detector | acuContradictionDetector.ts — detectContradictions() | 12 | ACTIVE |
| P003 | Importance Ranker | acuScanner.ts — rankImportance() | 10 | ACTIVE |
| P004 | Template-Aware Generation | generationEngine.ts — generateFromTemplate() | 11 | ACTIVE |

**P001 — ACU Content Scanner:**
- Extracts facts, compliance statements, tax figures, research citations, framings, qualifiers, prohibited phrases
- Classifies each as EXISTING (matched to locked ACU), NEW_CANDIDATE, or CONTRADICTION
- Returns JSON array with content, type, match_status, matched_acu_id, topics, importance (1-4), source_location

**P002 — Contradiction Detector:**
- 5 rule types: direct_contradiction, logical_tension, qualifier_inconsistency, version_conflict, prohibited_leak
- 4 severity levels: CRITICAL (0), HIGH (1), MEDIUM (2), LOW (3)
- Explicit rules: do NOT flag stylistic differences; DO flag shared-topic numeric discrepancies

**P003 — Importance Ranker:**
- Level 1 FOUNDATIONAL: core compliance figures (EIS 30%, capital at risk)
- Level 2 STRUCTURAL: key claims shaping investor narrative (5-6x return, advice gap)
- Level 3 SUPPORTING: evidence and citations (NESTA 2009, HMRC stats)
- Level 4 CONTEXTUAL: background info, market colour

**P004 — Template-Aware Generation:**
- 10 generation rules including verbatim injection, topic filtering, word limits, prohibited ACU exclusion
- Returns JSON with section content + `_metadata` (word_counts, acus_used, compliance_check PASS/FAIL)

---

## 6. COMPLIANCE CONSTANTS

### 6.1 Locked Figures (from `compliance_constants.json`, V4)

| Key | Value | Critical Note |
|-----|-------|---------------|
| eis_income_tax_relief | 30% | EIS. Up to £1M (£2M for KICs) |
| seis_income_tax_relief | 50% | SEIS |
| vct_relief_rate | **20%** | Post-2025 Budget. NOT 30% |
| eis_cgt_deferral | 100% | No cap on amount |
| bpr_cap | £2,500,000 | NOT £1M. April 2026 effective |
| pension_iht_change | April 2027 | "subject to final enactment" |
| eis_loss_relief_per_pound | ~38.5p | Additional rate. "subject to individual tax circumstances" |
| seis_loss_relief_per_pound | ~27.5p | Additional rate. "subject to individual tax circumstances" |
| **seis_loss_relief_prohibited** | **22p** | **WRONG. PROHIBITED. Correct = 27.5p** |
| founding_investor_minimum | £40,000 | Hard minimum |
| founding_investor_maximum | £500,000 | Hard maximum |
| pre_money_valuation | £6,500,000 | Founding round |
| instrument | Instant Investment | Via SeedLegals. NOT ASA |
| platform_pricing_prohibition | £99/£249 | **NEVER publish in investor docs** |
| decumulation_planner_status | "Specification complete. Prototype build commencing." | Exact wording required |
| product_tagline | "Clarity, without complexity" | Exact wording |
| target_portfolio_range | £250K–£5M | — |
| annual_eis_limit | £1M (£2M if ≥£1M in KICs) | — |
| annual_seis_limit | £200,000 | From April 2023 |

### 6.2 Unlock Model (LOCKED)
- **3.8x** Unlock model return
- **5-6x** effective cost return framing (for additional-rate taxpayers)
- **22p = PROHIBITED** (wrong SEIS loss figure)
- **7.8x / 78x = PROHIBITED**
- Always: "subject to individual tax circumstances"

---

## 7. BRAND SYSTEM

### 7.1 Brand Constants (from `brand.ts`)

| Property | Value |
|----------|-------|
| Primary dark | `#0F1629` (darkNavy) |
| Secondary dark | `#2D2D3F` (charcoal) |
| Accent | `#00C853` (green) |
| Text black | `#1A1A2E` |
| White | `#FFFFFF` |
| Light grey | `#F5F5F5` |
| Mid grey | `#E0E0E0` |
| Font | Inter (heading + body) |
| H1 | 28px / 700 / -0.02em |
| H2 | 22px / 600 / -0.01em |
| Body | 11px / 400 / 1.6 line-height |
| Page padding | 20mm |
| Section gap | 12mm |
| Logo position | top-right, 10mm clear space |

### 7.2 Campaign Plan Export Colours
- Primary: `#0A2240`
- Accent: `#C9A84C`
- Font: Arial (campaign docs only)

---

## 8. FRONTEND PAGES

### 8.1 All 17 Pages (`artifacts/unlock-intel/src/pages/`)

| Page | File | Lines | Key Features |
|------|------|-------|--------------|
| ACU Management | acu.tsx | 1332 | Full CRUD, scan trigger, approve/lock/cascade, contradiction viewer, candidate review, importance badges, coverage status |
| Recommendation Engine | recommend.tsx | 1196 | Analyze, rank, confirm-send, email-draft, gap-brief, transcript upload (.txt/.docx), conversation history |
| Document Detail | document-detail.tsx | 751 | Full doc view, QC history, propagation status, quality score, content display, generation metadata |
| Template Generation | generate.tsx | 746 | Template picker, override inputs, generate + auto-QC, result display with section-by-section view |
| Campaign Detail | campaign-detail.tsx | 671 | Sequence visualiser, asset list, QC per asset, node editing, branch conditions |
| Campaigns | campaigns.tsx | 563 | Campaign list, brief form (12 fields), QC badges, sequence builder, activate |
| Content Gaps | gaps.tsx | 514 | Gap analysis dashboard, persona × stage matrix, gap snapshots |
| Document Registry | registry.tsx | 472 | Full doc list with filters (type, tier, category, lifecycle), search, sort |
| Feature Updates | feature-updates.tsx | 364 | Internal changelog / feature tracking |
| Lead Detail | lead-detail.tsx | 304 | Lead profile, next-action AI suggestion, activity timeline |
| Persona Analytics | persona-analytics.tsx | 277 | Persona-level content coverage, pipeline analytics |
| Dashboard | dashboard.tsx | 215 | Stats cards, recent activity, compliance summary |
| Leads | leads.tsx | 210 | Lead list with search/filter, add lead dialog |
| Call Prep | call-prep.tsx | 149 | Call framework reference |
| Content Bank | content-bank.tsx | 130 | Approved content repository view |
| Changelog | changelog.tsx | 79 | Document change log viewer |
| Not Found | not-found.tsx | 21 | 404 page |

### 8.2 Frontend Stack
- React + Vite + TypeScript
- TanStack Query (react-query) for data fetching
- Wouter for routing
- shadcn/ui components (Table, Card, Badge, Button, Dialog, Select, Input, Textarea, Tabs)
- Lucide React icons
- date-fns for date formatting
- @workspace/api-client-react for typed API hooks

---

## 9. DATA LAYER

### 9.1 Seed Data Files (`artifacts/api-server/src/data/`)

| File | Lines | Purpose |
|------|-------|---------|
| seed-templates.ts | 412 | 22 templates with full section definitions |
| seed-prompts.ts | 197 | 4 system prompts (P001–P004) |
| seed-acu-refactor.ts | 102 | ACU refactoring seeds |
| document-usage-matrix.ts | 467 | Document ↔ ACU usage cross-reference |
| 230_EMAILS_Pack1_Templates_V2_CURRENT.txt | 310 | Email template reference text |
| registry.json | 312 | Document registry seed data |
| compliance_constants.json | 157 | 19 compliance constants (V4) |
| leads.json | 104 | Lead seed data |
| channels.json | 97 | Channel definitions (10 channels) |
| acu-seed.json | 24 | Initial ACU seed data |
| SCHEMA_SUMMARY.json | 161 | Schema documentation |

### 9.2 Data Manager (`dataManager.ts`, 385 lines)
- Seeds all tables on startup: registry → leads → ACUs → channels → templates → prompts
- Reads JSON imports with `{ type: "json" }` assertion
- Idempotent — checks for existing records before inserting
- Loads compliance constants for runtime access

---

## 10. FILE UPLOAD & IMPORT

### 10.1 PDF Import (`documents/index.ts`)
- Route: `POST /documents/import-pdf`
- Multer: memoryStorage, 50MB limit, PDF-only MIME check
- Parser: `pdfjs-dist` — extracts text page by page
- Creates document record with `source_pdf_path`, `source_pdf_filename`, `source_pdf_imported_at`
- Stores extracted text in `content` column

### 10.2 Transcript Upload (`recommendation/index.ts`)
- Route: `POST /recommendation/upload-transcripts`
- Multer: memoryStorage, 500KB per file, MAX_FILES=20
- Accepts: `.txt` (direct Buffer.toString) and `.docx` (mammoth.extractRawText)
- Returns array of `{ filename, text, wordCount }`
- Used for recommendation analysis context

---

## 11. AI INTEGRATION

### 11.1 Anthropic Configuration
- Import: `import { anthropic } from "@workspace/integrations-anthropic-ai"`
- Model: `claude-sonnet-4-6`
- Max tokens: 8192
- Used in: acuScanner.ts, acuContradictionDetector.ts, generationEngine.ts, campaignGenerator.ts, recommendation routes

### 11.2 Google Drive Integration
- Installed: `google-drive==1.0.0`
- Used via: gdocs routes (`POST /gdocs/create`, `POST /gdocs/sync`, `GET /gdocs/:id/status`)
- Documents table has `gdoc_id` and `gdoc_url` columns

---

## 12. CHANNEL SYSTEM

### 12.1 Channel Definitions (from `channels.json`, 10 channels)
Channels define per-channel constraints enforced by `channelConstraints.ts`:
- `max_words`, `max_lines`, `max_sentences`, `max_links`, `max_ctas`
- `headline_max_chars`, `body_max_chars`, `subject_max_words`, `subject_max_chars`
- `max_duration_seconds` (call/voicemail)
- `prohibited` (string array)
- `cta_options`, `formats` (ad sizes)
- `goal` (e.g., "book_meeting_not_sell")

### 12.2 Channel-to-Output Mapping (`channelConstraints.ts`)
| Channel ID | Output Type |
|-----------|-------------|
| email_cold | email |
| email_warm | email |
| email_nurture | email |
| whatsapp | whatsapp-template |
| linkedin_message | linkedin-message |
| meta_ad | ad-brief |
| linkedin_ad | ad-brief |
| display_ad | ad-brief |
| call_script | call-script |
| voicemail | call-script |

---

## 13. CAMPAIGN INTELLIGENCE

### 13.1 Campaign Workflow
1. **Create** — POST `/campaigns` with brief (name, target_cluster, personas, entry/target stage, channels, beliefs, CTAs, lead magnet, compliance constraints)
2. **Build Sequence** — POST `/campaigns/:id/sequence` → AI generates multi-node sequence with day numbers, channels, branch conditions
3. **Generate Assets** — POST `/campaigns/:id/assets` → generates content for each sequence node
4. **QC** — POST `/campaigns/:id/qc` → validates all assets against channel constraints + ACU compliance
5. **Export** — GET `/campaigns/:id/export` → AC-build export format
6. **Activate** — POST `/campaigns/:id/activate` → sets `activated_at`, status = ACTIVE

### 13.2 Campaign QC (`campaignQC.ts`)
- Validates each asset against its channel's constraints
- Checks prohibited content (22p, 7.8x, April 6)
- Verifies required ACU presence
- Checks word/line/sentence/char limits per channel
- Returns per-asset QC status + aggregate campaign QC status

---

## 14. QUALITY SCORE SYSTEM

### 14.1 Quality Score Dimensions (6)
- Route: `POST /documents/:id/quality-score`
- Scores each document on 6 dimensions (0–100 scale):
  1. ACU Compliance
  2. Template Adherence
  3. Tone & Voice
  4. Factual Accuracy
  5. Readability
  6. Completeness

### 14.2 Score Calculation
- Weighted average produces overall quality score
- Stored in document's `qc_history` array
- Displayed in document-detail.tsx with dimension breakdown

---

## 15. PROPAGATION ENGINE

### 15.1 How It Works (`propagation.ts`)
- When an ACU is updated, `cascade()` finds all documents referencing that ACU
- Sets each document's `review_state` to `NEEDS_REVIEW`
- Creates changelog entries recording what changed and why
- Respects `cascade_on_change` flag on ACU — if false, no cascade
- `GET /documents/propagation-status` returns summary of documents needing review

---

## 16. RECOMMENDATION ENGINE

### 16.1 Full Workflow
1. **Analyze** — POST `/recommendation/analyze` with lead context → AI analyses lead situation
2. **Rank** — POST `/recommendation/rank` → ranks available documents for lead
3. **Confirm Send** — POST `/recommendation/confirm-send` → records send decision
4. **Email Draft** — POST `/recommendation/email-draft` → AI drafts personalised email
5. **Gap Brief** — POST `/recommendation/gap-brief` → identifies content gaps for lead
6. **Upload Transcripts** — POST `/recommendation/upload-transcripts` → processes .txt/.docx files for context

### 16.2 Context Builder (`recommendation-context.ts`)
- Builds rich context from lead profile + document registry + ACU data
- Includes persona, pipeline stage, previous interactions, relevant ACUs
- Feeds into Anthropic for AI-powered recommendations

---

## 17. ID CONVENTIONS

| Entity | ID Pattern | Example |
|--------|-----------|---------|
| Documents (source) | UUID v4 | `a1b2c3d4-e5f6-...` |
| Documents (generated) | `gen_tmpl_` prefix + UUID | `gen_tmpl_a1b2c3d4-...` |
| Templates | `tmpl_` prefix + descriptive | `tmpl_email_cold` |
| ACUs | `acu_` prefix + descriptive | `acu_eis_relief_30` |
| Campaigns | UUID v4 | `a1b2c3d4-e5f6-...` |
| Campaign assets | UUID v4 | `a1b2c3d4-e5f6-...` |
| System prompts | P + 3 digits | `P001` |
| Leads | UUID v4 | `a1b2c3d4-e5f6-...` |
| All UUIDs | `import { randomUUID } from "crypto"` | No nanoid |

---

## 18. TECHNICAL CONSTRAINTS

### 18.1 Hard Rules
1. **generationEngine.ts MUST NOT be modified** — generation persistence is in route handler only
2. **Route ordering**: static routes before `:id` parameterized routes in Express
3. **No nanoid** — all IDs via `import { randomUUID } from "crypto"`
4. **Template-generated docs** use `gen_tmpl_` prefix
5. **Compliance figures are LOCKED** — values in compliance_constants.json are authoritative
6. **Prohibited content is hard-blocked**: 22p, 7.8x/78x, April 6 deadline
7. **All tax figures require** "subject to individual tax circumstances" qualifier
8. **API server runs on port 8080** under `/api` prefix
9. **Anthropic model**: `claude-sonnet-4-6`, max 8192 tokens

### 18.2 Soft Constraints
1. Brand aesthetic: dark navy/charcoal, institutional, intelligence-forward
2. Tone: never salesy, never promotional, always institutional
3. Email sign-off: Tom King only, never "Kind regards" or "The Unlock Team"
4. Call scripts: goal is book_meeting_not_sell
5. WhatsApp requires Meta approval (24-48h), consent required
6. Platform pricing (£99/£249) NEVER in investor docs

---

## 19. WORKSPACE STRUCTURE

```
/home/runner/workspace/
├── artifacts/
│   ├── api-server/          (Express API — port 8080)
│   │   └── src/
│   │       ├── routes/      (18 route files, 5056 lines total)
│   │       ├── lib/         (12 lib files, 2673 lines total)
│   │       └── data/        (11 data files, 2343 lines total)
│   ├── unlock-intel/        (React frontend — Vite)
│   │   └── src/
│   │       └── pages/       (17 page files, 7994 lines total)
│   └── mockup-sandbox/      (Component preview server)
├── lib/
│   └── db/
│       └── src/
│           └── schema/      (14 schema files, 403 lines total)
└── packages/
    ├── api-client/          (Generated API client)
    ├── api-client-react/    (React query hooks)
    └── api-spec/            (OpenAPI spec)
```

---

## 20. OUTSTANDING ITEMS

1. **CTX_architecture.md** — User to draft; required gate before COMPLETE status
2. **No authentication** — No user auth system currently implemented
3. **No test suite** — No automated tests in the codebase
4. **Google Drive integration** — Routes exist but may need production configuration
5. **Export formats** — Templates define `export_formats: ["docx", "pdf"]` but actual file generation not yet implemented

---

*End of Current State Output — Scan complete, all files verified.*
