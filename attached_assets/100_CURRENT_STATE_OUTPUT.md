## CURRENT STATE OUTPUT

### 0. Scan coverage
**Scope:** Full repo
**Fully scanned:** `lib/db/src/schema/`, `lib/api-spec/`, `lib/integrations-anthropic-ai/`, `artifacts/api-server/src/` (all subdirectories: `routes/`, `lib/`, `data/`), `artifacts/unlock-intel/src/` (all `pages/`, `App.tsx`, `components/`), root config files
**Summarised at directory level:** `lib/api-client-react/src/generated/`, `lib/api-zod/src/generated/`, `artifacts/mockup-sandbox/`, `artifacts/api-server/documents/`, `artifacts/api-server/reports/`, `attached_assets/`
**Could not reach:** none
**Limitations:** Generated codegen output in `lib/api-client-react/src/generated/` and `lib/api-zod/src/generated/` was not inspected line-by-line (auto-generated from `openapi.yaml` via Orval).

---

### 1. Key files

#### `lib/db/src/schema/acu.ts`
**What it does:** Defines the `approved_content_units` Postgres table — the master registry of locked compliance facts, framings, qualifiers, references, and prohibited content.
**Key functions, variables, data structures:** `acuTable` (pgTable with `id`, `type`, `content`, `status`, `source`, `approved_by`, `approved_date`, `version`, `expression_variants` JSONB, `documents_referencing` JSONB, `cascade_on_change`, `notes`, `topics` JSONB, `requires_qualifier`, `parent_concept_id`, `is_expression_variant`, `variant_audience`, `supersedes`, `policy_status`); `insertAcuSchema`, `InsertAcu`, `Acu` types.

#### `lib/db/src/schema/acu-intelligence.ts`
**What it does:** Defines three tables for the ACU Intelligence Layer: candidate ACUs extracted by the scanner, detected contradictions, and a scan audit log.
**Key functions, variables, data structures:** `acuCandidatesTable` (id, type, content, importance_level/label/rationale, source_document_id, source_context, appears_in_documents JSONB, existing_acu_id, status, scan_date, reviewed_by, review_date, review_action, notes); `acuContradictionsTable` (id, unit_a_id, unit_b_id, unit_a_content, unit_b_content, conflict_description, severity, status, resolution, resolved_by, resolved_date); `acuScanLogTable` (id, scan_date, documents_scanned, candidates_found, new_candidates, duplicates_found, contradictions_found, scan_duration_ms). Insert schemas and types exported for each.

#### `lib/db/src/schema/documents.ts`
**What it does:** Defines the `documents` table — the central document registry tracking whitepapers, reports, packs, and generated assets with tiering, lifecycle status, review state, upstream/downstream dependencies, generation metadata, QC history, and Google Docs integration.
**Key functions, variables, data structures:** `documentsTable` with 30+ columns including `id`, `file_code`, `name`, `tier` (integer), `category`, `lifecycle_status`, `review_state`, `version`, `upstream_dependencies` JSONB, `downstream_dependents` JSONB, `is_generated`, `qc_report_id`, `content`, `gdoc_id`, `gdoc_url`, `source_pdf_path`, `output_type`, `channel`, `campaign_id`. Export: `insertDocumentSchema`, `InsertDocument`, `Document`.

#### `lib/db/src/schema/leads.ts`
**What it does:** Defines the `leads` table — CRM records for investors with persona detection, pipeline tracking, and send history.
**Key functions, variables, data structures:** `leadsTable` with `id`, `name`, `company`, `pipeline_stage`, `detected_persona`, `confirmed_persona`, `confirmed_archetype`, `persona_confidence`, `stage_confidence`, `send_log` JSONB, `stage_history` JSONB, `source`, `transcript_filename`.

#### `lib/db/src/schema/campaigns.ts`
**What it does:** Defines `campaigns` and `campaign_assets` tables for multi-channel marketing campaign sequences with QC tracking.
**Key functions, variables, data structures:** `campaignsTable` (id, name, status, target_cluster, personas JSONB, entry/target_stage, channels JSONB, duration_weeks, beliefs, CTAs, compliance_constraints JSONB, prohibited_acus JSONB, sequence JSONB, qc_status, qc_report JSONB); `campaignAssetsTable` (id, campaign_id, node_id, channel, output_type, content, day, sequence_position, qc_status, qc_report JSONB).

#### `lib/db/src/schema/output-templates.ts`
**What it does:** Defines the `output_templates` table — the Template Registry storing 22 generation templates with section definitions, formatting rules, and ACU compliance constraints.
**Key functions, variables, data structures:** `outputTemplatesTable` (id, name, output_type, channel, parent_template_id, sections JSONB, formatting_rules JSONB, required_acus JSONB, prohibited_acus JSONB, generation_prompt_prefix, export_formats JSONB, version).

#### `lib/db/src/schema/system-prompts.ts`
**What it does:** Defines the `system_prompts` table — the Prompt Registry storing governed AI prompts with rubric scores.
**Key functions, variables, data structures:** `systemPromptsTable` (id, name, location, prompt_text, rubric_score integer, version, status, last_reviewed, reviewed_by).

#### `lib/db/src/schema/channels.ts`
**What it does:** Defines the `channels` table — communication channel configurations with technical constraints (word limits, link limits, format restrictions).
**Key functions, variables, data structures:** `channelsTable` with `max_words`, `max_links`, `max_ctas`, `max_lines`, `max_sentences`, `max_duration_seconds`, `headline_max_chars`, `body_max_chars`, `subject_max_words`, `prohibited` JSONB, `formats` JSONB, `cta_options` JSONB, `requires_meta_approval`, `from_address`.

#### `lib/db/src/schema/changelog.ts`
**What it does:** Defines the `changelog` table — audit log for system actions (ACU created, document promoted, contradiction resolved, cascade triggered).
**Key functions, variables, data structures:** `changelogTable` (id, timestamp default now(), action, document_id, lead_id, details, triggered_by).

#### `lib/db/src/schema/gap-snapshots.ts`
**What it does:** Defines the `gap_snapshots` table for persisted content gap analysis snapshots.
**Key functions, variables, data structures:** `gapSnapshotsTable` (id, created_at, matrix_gaps JSONB, type_gaps JSONB, recommendation_gaps JSONB, information_readiness JSONB, summary JSONB, total_gaps, file_path, notes).

#### `lib/db/src/schema/videos.ts`
**What it does:** Defines the `videos` table for video asset metadata (portrait MP4s for investor comms).
**Key functions, variables, data structures:** `videosTable` (id, title, description, script_content, duration_seconds, format, send_method, persona_relevance JSONB, lifecycle_status, review_state).

#### `lib/db/src/schema/conversations.ts` / `messages.ts`
**What it does:** Defines `conversations` and `messages` tables for chat history persistence.
**Key functions, variables, data structures:** `conversationsTable` (serial id, title, createdAt); `messagesTable` (serial id, conversationId FK -> conversations with cascade delete, role, content, createdAt).

#### `lib/db/src/schema/index.ts`
**What it does:** Re-exports all 11 schema modules as a single barrel.
**Key functions, variables, data structures:** Exports from leads, documents, changelog, gap-snapshots, videos, acu, campaigns, channels, acu-intelligence, output-templates, system-prompts.

#### `lib/db/drizzle.config.ts`
**What it does:** Configures Drizzle Kit for schema push and migration generation against the PostgreSQL database.
**Key functions, variables, data structures:** `defineConfig` pointing to `./src/schema/index.ts`, dialect `postgresql`, reads `DATABASE_URL` env var.

#### `lib/api-spec/openapi.yaml`
**What it does:** The OpenAPI 3.1.0 specification — the single source of truth for the API contract (3500+ lines). Defines all endpoints, request/response schemas, and tags.
**Key functions, variables, data structures:** 18 tags: health, leads, recommendation, documents, compliance, changelog, content, gaps, feature-update, generation, dashboard, acu, campaigns, channels, acu-intelligence, templates, prompts. All schemas defined in `components/schemas`.

#### `lib/api-spec/orval.config.ts`
**What it does:** Configures Orval code generation to produce two outputs from `openapi.yaml`: React Query hooks (into `lib/api-client-react/src/generated/`) and Zod validation schemas with TypeScript types (into `lib/api-zod/src/generated/`).
**Key functions, variables, data structures:** `api-client-react` target (react-query client, split mode, custom fetch mutator); `zod` target (zod client, TypeScript type schemas, coercion rules for query/param/body/response).

#### `lib/integrations-anthropic-ai/src/index.ts`
**What it does:** Barrel export for the Anthropic AI integration — provides a proxied Claude client and batch processing utilities.
**Key functions, variables, data structures:** Exports `anthropic` (Anthropic client instance), `batchProcess`, `batchProcessWithSSE`, `isRateLimitError`, `BatchOptions`.

#### `artifacts/api-server/src/index.ts`
**What it does:** Server entry point — reads PORT env var, calls `seedDatabase()`, starts Express on the configured port.
**Key functions, variables, data structures:** Imports `app` from `./app`, `seedDatabase` from `./lib/dataManager`, `logger` from `./lib/logger`. Validates PORT, seeds DB, then calls `app.listen(port)`.

#### `artifacts/api-server/src/app.ts`
**What it does:** Express application setup — configures pino-http logging (with request/response serializer redaction), CORS, JSON body parsing, URL-encoded body parsing, and mounts all API routes under `/api` prefix.
**Key functions, variables, data structures:** `app` Express instance. Middleware chain: `pinoHttp`, `cors()`, `express.json()`, `express.urlencoded()`. Mounts `router` at `/api`.

#### `artifacts/api-server/src/routes/index.ts`
**What it does:** Aggregates all 15 route modules and mounts them on the Express router.
**Key functions, variables, data structures:** Imports and `.use()`s: healthRouter, leadsRouter, documentsRouter, recommendationRouter, contentRouter, generationRouter, dashboardRouter, gdocsRouter, callFrameworkRouter, analyticsRouter, videosRouter, acuRouter, campaignsRouter, templatesRouter, promptsRouter.

#### `artifacts/api-server/src/routes/acu/index.ts`
**What it does:** Implements all ACU management and intelligence endpoints — CRUD for locked ACUs, intelligence scan trigger, backlog management (approve/reject/defer/duplicate), contradiction resolution, coverage map, scan log.
**Key functions, variables, data structures:** `GET /acu` (list with status/type filters); `GET /acu/prohibited`, `GET /acu/injectable` (filtered views); `GET /acu/backlog` (priority-ordered candidates with importance/type/status filters, summary stats); `GET /acu/backlog/contradictions` (severity-sorted, unresolved first); `GET /acu/coverage` (belief coverage map across 17 beliefs: U1-U4, G1-G3, P1-P3, L1-L3, F0-F3); `GET /acu/scan-log`; `POST /acu/scan` (triggers full scan + contradiction detection); `POST /acu/scan/:document_id` (single doc scan); `POST /acu` (create new ACU); `PATCH /acu/backlog/:id/approve` (promotes candidate to ACU with optional lock); `PATCH /acu/backlog/:id/reject`, `/defer`, `/duplicate`; `PATCH /acu/contradictions/:id/resolve`; `GET /acu/:id` (with version history); `PATCH /acu/:id/approve`, `/lock`, `/cascade`; `POST /acu/:id/version`.

#### `artifacts/api-server/src/routes/leads/index.ts`
**What it does:** Implements lead/investor CRUD, fuzzy search, persona confirmation, and next-best-action recommendation.
**Key functions, variables, data structures:** `GET /leads/match` (fuzzy); `GET /leads` (list with search/stage filter); `POST /leads`; `GET /leads/:id`; `PATCH /leads/:id`; `POST /leads/:id/confirm-persona`; `GET /leads/:id/next-action`.

#### `artifacts/api-server/src/routes/documents/index.ts`
**What it does:** Implements document registry CRUD, PDF import/export, propagation triggers, and Tier 1 lockdown enforcement.
**Key functions, variables, data structures:** `GET /documents` (with tier/category/status/review filters); `GET /documents/propagation-status`; `GET /documents/:id`; `POST /documents/:id/export-pdf`; `POST /documents/import-pdf` (multer); `GET /documents/:id/source-pdf`; `PATCH /documents/:id` (Tier 1 requires `edit_override`); `POST /documents/:id/propagate`.

#### `artifacts/api-server/src/routes/recommendation/index.ts`
**What it does:** Implements the transcript intelligence pipeline — parse, analyze (Claude-powered persona/objection detection), rank documents, confirm sends, and generate email drafts.
**Key functions, variables, data structures:** `POST /recommendation/parse-transcripts` (txt/docx); `POST /recommendation/analyze-batch`; `POST /recommendation/analyze` (single transcript); `POST /recommendation/rank`; `POST /recommendation/confirm-send`; `POST /recommendation/generate-email`.

#### `artifacts/api-server/src/routes/generation/index.ts`
**What it does:** Implements document generation endpoints — generate from requirements, regenerate to fix QC failures, generate from template, QC rerun, promote to CURRENT.
**Key functions, variables, data structures:** `POST /generation/generate`; `POST /generation/:id/regenerate`; `POST /generation/from-template` (uses `generateFromTemplate`); `POST /generation/:id/qc-rerun`; `POST /generation/:id/promote`.

#### `artifacts/api-server/src/routes/campaigns/index.ts`
**What it does:** Implements campaign lifecycle — create with sequence generation, asset generation, QC validation, activation.
**Key functions, variables, data structures:** `POST /campaigns`; `POST /campaigns/:id/generate`; `GET /campaigns/:id/qc`; `PATCH /campaigns/:id/activate`.

#### `artifacts/api-server/src/routes/content/index.ts`
**What it does:** Aggregates the content sub-routes — serves the master content bank and persona guides directly, then mounts `gaps.ts` and `feature-update.ts` sub-routers.
**Key functions, variables, data structures:** `GET /content-bank` (searchable sections from Content Bank V4); `GET /content-bank/personas` (persona guide). Mounts `gapsRouter` and `featureUpdateRouter`.

#### `artifacts/api-server/src/routes/content/gaps.ts`
**What it does:** Gap analysis engine — runs coverage matrix analysis across personas × pipeline stages × document types, persists snapshots, generates creation briefs, and generates full documents from briefs. Loads the Master Generation Context (25,408 chars) at module scope.
**Key functions, variables, data structures:** `GET /content/gaps` (full coverage matrix analysis); `GET /content/gaps/history` (historical snapshots from `gap_snapshots` table); `POST /content/generate-brief` (Claude-powered brief from gap); `POST /content/generate-from-brief` (full document generation from brief). Uses `masterGenerationContext` loaded from `065_MASTER_generation_context_v1.0.md`.

#### `artifacts/api-server/src/routes/content/feature-update.ts`
**What it does:** Feature update propagation — analyses a product feature change, identifies affected documents, and flags them for review.
**Key functions, variables, data structures:** `POST /content/feature-update` (analyses change impact, cascades review flags).

#### `artifacts/api-server/src/routes/analytics/index.ts`
**What it does:** Serves persona analytics — detection accuracy metrics and distribution data.
**Key functions, variables, data structures:** `GET /analytics/personas`.

#### `artifacts/api-server/src/routes/call-framework/index.ts`
**What it does:** Serves the call qualification framework — structured investor call questions.
**Key functions, variables, data structures:** `GET /call-framework/questions`.

#### `artifacts/api-server/src/routes/videos/index.ts`
**What it does:** Video asset CRUD — lists and creates video metadata/script records.
**Key functions, variables, data structures:** `GET /videos`; `POST /videos`.

#### `artifacts/api-server/src/routes/dashboard/index.ts`
**What it does:** Aggregates KPI stats (leads by pipeline stage, documents by status, documents sent this week, coverage gaps) and serves recent activity from the changelog. Also serves compliance constants.
**Key functions, variables, data structures:** `GET /dashboard/summary` (lead pipeline breakdown, document counts, recent sends, coverage gaps); `GET /dashboard/recent-activity` (changelog entries); `GET /compliance-constants` (locked compliance figures from seed data).

#### `artifacts/api-server/src/routes/templates/index.ts`
**What it does:** Serves the Template Registry — list all templates, get template by ID with parent-child section composition.
**Key functions, variables, data structures:** `GET /templates`; `GET /templates/:id` (merges parent sections when `parent_template_id` exists).

#### `artifacts/api-server/src/routes/prompts/index.ts`
**What it does:** Serves the Prompt Registry — list all system prompts, get prompt by ID.
**Key functions, variables, data structures:** `GET /prompts`; `GET /prompts/:id`.

#### `artifacts/api-server/src/routes/gdocs/index.ts`
**What it does:** Google Docs integration — export documents to Google Drive, import content back, check sync status.
**Key functions, variables, data structures:** `POST /gdocs/export/:id`; `POST /gdocs/import/:id`; `GET /gdocs/status/:id`.

#### `artifacts/api-server/src/lib/acuScanner.ts`
**What it does:** Claude-powered content scanner that extracts candidate ACUs (facts, framings, references, qualifiers) from documents, assigns importance levels (Foundational/Structural/Supporting/Contextual), and deduplicates against locked ACUs.
**Key functions, variables, data structures:** `scanDocument(documentId)` — scans single document, returns `ScanResult` with array of `CandidateResult` (candidate_id, type, content, importance_level/label/rationale, source_context, already_locked_as, status). `scanAllDocuments()` — scans all CLEAN/REQUIRES_REVIEW documents with content, persists candidates and scan log entry. Uses `claude-sonnet-4-6` model, max_tokens 8192.

#### `artifacts/api-server/src/lib/acuContradictionDetector.ts`
**What it does:** Hybrid contradiction detector — runs 5 rule-based checks (R1-R5) synchronously then a Claude-powered deep semantic analysis, deduplicating and persisting results.
**Key functions, variables, data structures:** `runRuleBasedChecks(units)` — R1: numeric mismatch on shared topics (CRITICAL); R2: prohibited content leak (CRITICAL); R3: missing required qualifier (HIGH); R4: superseded ACU still active (HIGH); R5: channel variant audience mismatch (MEDIUM). `detectContradictions()` — loads all LOCKED ACUs + PENDING_REVIEW candidates, runs rules, sends to Claude with critical pairs pre-flagged, persists new contradictions to `acuContradictionsTable`. Returns `{contradictions_found, new_contradictions, rule_based_count, llm_count, results}`.

#### `artifacts/api-server/src/lib/generationEngine.ts`
**What it does:** Template-aware generation engine — fetches template with parent inheritance, composes sections, injects locked ACUs verbatim, loads prohibited ACU content, generates via Claude, then runs TEMPLATE_COMPLIANCE QC.
**Key functions, variables, data structures:** `generateFromTemplate(request)` — takes `template_id`, optional `context` and `channel_temperature`. Merges parent template's required/prohibited ACUs. `checkTemplateCompliance(generated, sections, requiredAcuIds, prohibitedAcuIds, lockedContent)` — checks section presence, word/sentence/char limits (5% tolerance), required ACU match rate (95% threshold), prohibited ACU absence. Returns `{pass, issues}`.

#### `artifacts/api-server/src/lib/campaignGenerator.ts`
**What it does:** Generates multi-channel campaign sequences from a brief — builds touchpoint DAGs, creates channel-specific asset generation prompts, and produces ActiveCampaign build instructions.
**Key functions, variables, data structures:** `buildSequenceFromBrief(brief)` — creates SequenceNode array based on channels and campaign type. `buildAssetGenerationPrompt(node, brief, ...)` — constructs LLM prompt with channel constraints and compliance rules. `buildACBuildInstructions(...)` — ActiveCampaign automation config. `buildTagTable(...)` — CRM/Aircall tag definitions.

#### `artifacts/api-server/src/lib/campaignQC.ts`
**What it does:** Quality control engine for campaign assets — validates sequence integrity (no broken links/missing assets), channel compliance (word counts, link limits), and prohibited ACU content absence.
**Key functions, variables, data structures:** `runCampaignQC(campaignId)` — returns `CampaignQCResult` with overall_status (PASSED/FAILED/PENDING), per-asset results, and summary counts. Uses `validateChannelCompliance` from `channelConstraints.ts`.

#### `artifacts/api-server/src/lib/channelConstraints.ts`
**What it does:** Channel compliance validation — enforces word counts, link limits, sentence limits, line limits, prohibited terms, character limits, and CTA requirements per channel.
**Key functions, variables, data structures:** `validateChannelCompliance(content, channel)` — returns `ChannelViolation[]` with check name, message, severity (fail/warning). `buildChannelConstraintPrompt(channel)` — formats channel limits as text for LLM prompt injection. `getOutputTypeForChannel(channelId)` — maps channel to output_type.

#### `artifacts/api-server/src/lib/propagation.ts`
**What it does:** Manages content dependency cascade — detects which documents depend on a changed source document and flags them for review.
**Key functions, variables, data structures:** `detectPropagationTargets(sourceDocId)` — finds direct and second-order dependents via `upstream_dependencies`/`downstream_dependents` JSONB fields. `propagateFromDocument(sourceDocId)` — sets `review_state` to `REQUIRES_REVIEW` on all targets, creates changelog entries. Returns `PropagationResult` with `flagged_document_ids`, `changelog_entry_ids`, `targets`.

#### `artifacts/api-server/src/lib/recommendation-context.ts`
**What it does:** Derives investor context flags from transcript analysis using regex pattern matching — determines EIS familiarity, IHT status, and adviser involvement.
**Key functions, variables, data structures:** `deriveMatrixFlags(analysis)` — returns `MatrixContextWithNotes` with `eis_familiar`, `iht_confirmed`, `adviser_mentioned` booleans plus `derivation_notes` explaining each flag. Matches patterns like `/what is eis/i`, `/inheritance.*tax/i`, `/adviser|ifa|financial planner/i`.

#### `artifacts/api-server/src/lib/dataManager.ts`
**What it does:** Database seeder and data orchestration — seeds documents from registry.json + content markdown files, leads from leads.json, ACUs from acu-seed.json, channels from channels.json. Runs incremental seeds for ACU refactor, templates, and prompts. Also exports compliance constants and validation utilities.
**Key functions, variables, data structures:** `seedDatabase()` — idempotent (checks for existing leads). `validateSeedData()` — sanity checks. `getNextBestAction(lead)` — recommendation utility for pipeline-aware next actions. `getComplianceConstants()` — returns locked compliance figures from seed data.

#### `artifacts/api-server/src/lib/brand.ts`
**What it does:** Defines the Unlock brand identity constants for document rendering — fonts, colours, spacing, logo positioning, typography scales.
**Key functions, variables, data structures:** `BRAND` constant: fonts (Inter), colours (green #00C853, black #1A1A2E, darkNavy #0F1629, charcoal #2D2D3F, white, greys), spacing (20mm page padding, 12mm section gap, 1.5 line height), logo (top-right, 10mm clear space), typography (h1 28px/700, h2 22px/600, h3 18px/600, body 14px/400).

#### `artifacts/api-server/src/lib/templates/index.ts`
**What it does:** Converts document content to formatted HTML/PDF-ready output with brand-consistent styling (Markdown → HTML → styled document).
**Key functions, variables, data structures:** `getTemplate(document, templateType)` — renders One-pager, Three-pager, or Briefing templates with BRAND CSS.

#### `artifacts/api-server/src/lib/logger.ts`
**What it does:** Configures pino logger with header redaction and pretty printing for dev.
**Key functions, variables, data structures:** `logger` — pino instance, redacts `req.headers.authorization`, `req.headers.cookie`.

#### `artifacts/api-server/src/data/seed-acu-refactor.ts`
**What it does:** Seeds/updates the 22 original ACUs with topic tags and creates 4 new ACUs (acu_not_advice, acu_past_performance, acu_jan_2027_head_start, acu_fca_status).
**Key functions, variables, data structures:** `seedACURefactor()` — upserts topic arrays per ACU, returns `{updated, created}`.

#### `artifacts/api-server/src/data/seed-templates.ts`
**What it does:** Seeds the 22 output templates into the `output_templates` table — base compliance template, 4 email templates, call script, voicemail, LinkedIn, WhatsApp, ad briefs, campaign plan, whitepaper, one-pager, three-pager, investor packs, case studies, estate planning, explainer, agent card, adviser briefing.
**Key functions, variables, data structures:** `seedTemplates()` — inserts templates with section arrays, formatting_rules, required_acus, prohibited_acus, parent_template_id. Returns `{created, skipped, total}`.

#### `artifacts/api-server/src/data/seed-prompts.ts`
**What it does:** Seeds the 4 system prompts (P001-P004) into the `system_prompts` table with rubric scores.
**Key functions, variables, data structures:** `seedPrompts()` — P001 ACU Content Scanner (11/12), P002 Contradiction Detector (12/12), P003 Importance Ranker (10/12), P004 Template-Aware Generation (11/12). Returns `{created, skipped, total}`.

#### `artifacts/api-server/src/data/acu-seed.json`
**What it does:** JSON seed data for the 22 original Approved Content Units — compliance facts, framings, references, qualifiers, and prohibited content.
**Key functions, variables, data structures:** Array of objects with `id`, `type`, `content`, `status`, `source`, `expression_variants`, `documents_referencing`, `cascade_on_change`, `notes`.

#### `artifacts/api-server/src/data/registry.json`
**What it does:** Master document registry seed data — defines all documents with IDs, filenames, tiers, categories, lifecycle statuses, review states, pipeline/persona relevance, and dependency graphs.
**Key functions, variables, data structures:** `{documents: [...]}` array with per-document metadata.

#### `artifacts/api-server/src/data/leads.json`
**What it does:** Seed data for investor leads with pipeline stages, detected personas, and send logs.
**Key functions, variables, data structures:** Array of lead objects (e.g., Duncan Stewart, Sarah Mitchell).

#### `artifacts/api-server/src/data/channels.json`
**What it does:** Seed data for 10+ communication channels with technical constraints.
**Key functions, variables, data structures:** Array of channel objects with `id`, `name`, `format`, `max_words`, `max_links`, `prohibited`, etc.

#### `artifacts/api-server/src/data/content/master_generation_context.md`
**What it does:** The 25,408-character master context document loaded at server startup — contains all compliance constants, tone of voice rules, and business context for LLM generation.
**Key functions, variables, data structures:** Loaded by `dataManager.ts` into global state; injected into generation prompts.

#### `artifacts/unlock-intel/src/App.tsx`
**What it does:** Root React component — wraps the app in QueryClientProvider (TanStack React Query), TooltipProvider, and WouterRouter with BASE_URL-aware routing. Defines all 16 page routes.
**Key functions, variables, data structures:** `Router()` — Switch with routes: `/` Dashboard, `/recommend`, `/leads`, `/leads/:id`, `/registry`, `/registry/:id`, `/content-bank`, `/changelog`, `/generate`, `/gaps`, `/feature-updates`, `/call-prep`, `/analytics/personas`, `/acu`, `/campaigns`, `/campaigns/:id`, 404 fallback.

#### `artifacts/unlock-intel/src/pages/acu.tsx`
**What it does:** 1,333-line multi-tab ACU management page with 4 tabs: Content Units (CRUD, approve/lock/cascade/version), Intelligence (contradictions panel with severity pills and resolution, review backlog with importance/type filters and approve/reject/defer/duplicate buttons, belief coverage map with status dots), Templates (22-template registry with expandable section/formatting/ACU detail), Prompts (4 prompt cards with rubric star ratings and expandable full text).
**Key functions, variables, data structures:** `fetchACUs`, `fetchBacklog`, `fetchContradictions`, `fetchCoverage`, `fetchTemplates`, `fetchTemplate`, `fetchPrompts`, `triggerScan`, `backlogAction`, `resolveContradiction`, `approveACU`, `lockACU`, `cascadeACU`, `createNewVersion`. 12 mutations via `useMutation`. Helper components: `getStatusBadge`, `getTypeBadge`, `getSeverityBadge`, `getImportanceBadge`, `getCoverageStatusDot`.

#### `artifacts/unlock-intel/src/pages/dashboard.tsx`
**What it does:** Overview dashboard with KPI cards (leads, documents, ACUs), pipeline breakdown, and recent activity feed.
**Key functions, variables, data structures:** Uses `useGetDashboardSummary()`, `useGetRecentActivity()` from generated React Query hooks.

#### `artifacts/unlock-intel/src/pages/leads.tsx`
**What it does:** Searchable lead table with pipeline stage badges and persona indicators.
**Key functions, variables, data structures:** Uses `useListLeads({ search })`.

#### `artifacts/unlock-intel/src/pages/lead-detail.tsx`
**What it does:** Lead detail view — transcript analysis results, persona confirmation, next-best-action recommendations.
**Key functions, variables, data structures:** Uses `useGetLead(id)`, `useGetLeadNextAction(id)`.

#### `artifacts/unlock-intel/src/pages/registry.tsx`
**What it does:** Document registry with tier/category/status/review filters, PDF import tool.
**Key functions, variables, data structures:** Uses `useListDocuments(params)`, manual fetch for PDF import.

#### `artifacts/unlock-intel/src/pages/document-detail.tsx`
**What it does:** Document detail view — content viewer, compliance status, PDF export, Google Docs sync, tier 1 lockdown enforcement.
**Key functions, variables, data structures:** Uses `useGetDocument(id)`, `useUpdateDocument()`, `useExportToGoogleDocs()`, `useImportFromGoogleDocs()`.

#### `artifacts/unlock-intel/src/pages/recommend.tsx`
**What it does:** Transcript intelligence tool — parses uploaded files, analyses personas/objections via Claude, ranks documents, generates email drafts.
**Key functions, variables, data structures:** Uses `useListLeads()`, `useAnalyzeTranscript()`, `useRankDocuments()`, `useConfirmSend()`, `useGenerateEmailDraft()`.

#### `artifacts/unlock-intel/src/pages/campaigns.tsx`
**What it does:** Campaign list and creation form with channel selection, persona targeting, belief assignment.
**Key functions, variables, data structures:** Manual fetch to `GET/POST /api/campaigns`.

#### `artifacts/unlock-intel/src/pages/campaign-detail.tsx`
**What it does:** Campaign dashboard — asset generation status, QC reports per asset, activation controls with QC gate.
**Key functions, variables, data structures:** Manual fetch for campaign, generate, QC, activate endpoints.

#### `artifacts/unlock-intel/src/pages/generate.tsx`
**What it does:** Document generation workspace — create from brief, regenerate to fix QC failures, promote to CURRENT.
**Key functions, variables, data structures:** Uses `useGenerateDocument()`, `useRegenerateDocument()`, `usePromoteDocument()`.

#### `artifacts/unlock-intel/src/pages/gaps.tsx`
**What it does:** Content gap analysis — coverage matrix analysis, gap history, brief generation.
**Key functions, variables, data structures:** Manual fetch to `/api/content/gaps`, `/api/content/gaps/history`.

#### `artifacts/unlock-intel/src/pages/content-bank.tsx`
**What it does:** Searchable content bank viewer — pre-approved content sections.
**Key functions, variables, data structures:** Uses `useGetContentBank({ search })`.

#### `artifacts/unlock-intel/src/pages/feature-updates.tsx`
**What it does:** Feature update propagation tool — submit product changes, cascade review flags across documents.
**Key functions, variables, data structures:** Uses `useSubmitFeatureUpdate()`, `useGetFeatureUpdateQueue()`.

#### `artifacts/unlock-intel/src/pages/call-prep.tsx`
**What it does:** Call preparation checklist — displays structured qualification questions.
**Key functions, variables, data structures:** Manual fetch to `/api/call-framework/questions`.

#### `artifacts/unlock-intel/src/pages/persona-analytics.tsx`
**What it does:** Persona distribution charts and detection accuracy metrics.
**Key functions, variables, data structures:** Manual fetch to `/api/analytics/personas`.

---

### 2. Data model

- **`approved_content_units`:** id text PK, type text, content text, status text (DRAFT/APPROVED/LOCKED/LEGAL_PENDING/NAMING_PENDING/SUPERSEDED), source text, approved_by text, approved_date text, version int, expression_variants jsonb, documents_referencing jsonb, cascade_on_change bool, notes text, topics jsonb, requires_qualifier text, parent_concept_id text, is_expression_variant bool, variant_audience text, supersedes text, policy_status text
- **`acu_candidates`:** id text PK, type text, content text, importance_level int, importance_label text, importance_rationale text, source_document_id text, source_context text, appears_in_documents jsonb, existing_acu_id text, status text (PENDING_REVIEW/APPROVED/REJECTED/DEFERRED/DUPLICATE), scan_date text, reviewed_by text, review_date text, review_action text, notes text
- **`acu_contradictions`:** id text PK, unit_a_id text, unit_b_id text, unit_a_content text, unit_b_content text, conflict_description text, severity text (CRITICAL/HIGH/MEDIUM/LOW), status text (UNRESOLVED/RESOLVED), resolution text, resolved_by text, resolved_date text
- **`acu_scan_log`:** id text PK, scan_date text, documents_scanned int, candidates_found int, new_candidates int, duplicates_found int, contradictions_found int, scan_duration_ms int
- **`documents`:** id text PK, file_code text, type text, name text, filename text, tier int, category text, lifecycle_status text (CURRENT/DRAFT/ARCHIVED/SUPERSEDED), review_state text (CLEAN/REQUIRES_REVIEW), version int, last_reviewed text, description text, pipeline_stage_relevance jsonb, persona_relevance jsonb, upstream_dependencies jsonb, downstream_dependents jsonb, is_generated bool, generation_brief_id text, generation_attempt int, qc_report_id text, source_trace jsonb, content text, qc_history jsonb, gdoc_id text, gdoc_url text, source_pdf_path text, source_pdf_filename text, source_pdf_imported_at text, output_type text, channel text, campaign_id text, sequence_position int, sequence_id text, word_count int, branch_condition text
- **`leads`:** id text PK, name text, company text, pipeline_stage text, first_contact text, last_contact text, detected_persona text, confirmed_persona text, confirmed_archetype text, persona_confidence float, stage_confidence float, archived bool, send_log jsonb, stage_history jsonb, notes jsonb, source text, transcript_filename text, created_at timestamp, updated_at timestamp
- **`campaigns`:** id text PK, name text, description text, status text (DRAFT/ACTIVE/PAUSED/COMPLETED), target_cluster text, personas jsonb, entry_stage text, target_stage text, channels jsonb, duration_weeks int, daily_volume int, primary_belief text, secondary_beliefs jsonb, primary_cta text, secondary_cta text, lead_magnet text, compliance_constraints jsonb, blocked_content jsonb, prohibited_acus jsonb, notes text, sequence jsonb, qc_status text, qc_report jsonb, asset_count int, assets_passed_qc int, created_at text, activated_at text
- **`campaign_assets`:** id text PK, campaign_id text, node_id text, channel text, output_type text, content text, title text, day int, sequence_position int, branch_condition text, word_count int, status text, qc_status text, qc_report jsonb, metadata jsonb
- **`output_templates`:** id text PK, name text, output_type text, channel text, parent_template_id text, sections jsonb, formatting_rules jsonb, required_acus jsonb, prohibited_acus jsonb, generation_prompt_prefix text, export_formats jsonb, version int
- **`system_prompts`:** id text PK, name text, location text, prompt_text text, rubric_score int, version int, status text, last_reviewed text, reviewed_by text
- **`channels`:** id text PK, name text, format text, max_words int, max_links int, max_ctas int, max_lines int, max_sentences int, max_duration_seconds int, headline_max_chars int, body_max_chars int, subject_max_words int, subject_max_chars int, prohibited jsonb, formats jsonb, cta_options jsonb, requires_meta_approval bool, requires_cta_button bool, video_thumbnail bool, from_address text, goal text, max_objection_responses int, notes text
- **`changelog`:** id text PK, timestamp timestamp default now(), action text, document_id text, lead_id text, details text, triggered_by text
- **`gap_snapshots`:** id text PK, created_at timestamp, matrix_gaps jsonb, type_gaps jsonb, recommendation_gaps jsonb, information_readiness jsonb, summary jsonb, total_gaps int, file_path text, notes text
- **`videos`:** id text PK, title text, description text, script_content text, duration_seconds int, format text, send_method text, persona_relevance jsonb, stage_relevance jsonb, objections_addressed jsonb, lifecycle_status text, review_state text, created_at text, updated_at text
- **`conversations`:** id serial PK, title text, createdAt timestamp
- **`messages`:** id serial PK, conversationId int FK->conversations(cascade), role text, content text, createdAt timestamp

---

### 3. Data flow

How data moves through the system from input to storage to display:

- **Document ingestion:** PDF uploaded via `POST /documents/import-pdf` → multer extracts file → text extracted via `pdfjs-dist` (legacy build) → stored in `documents.content` with metadata → `lifecycle_status=CURRENT`, `review_state=REQUIRES_REVIEW`.
- **Content scanning:** `POST /acu/scan` → `scanAllDocuments()` iterates CLEAN/REQUIRES_REVIEW documents → for each doc, `scanDocument()` sends content + existing locked ACU list to Claude → extracts candidate facts/framings/references/qualifiers with importance levels → deduplicates against locked ACUs → persists to `acu_candidates` → creates `acu_scan_log` entry.
- **Contradiction detection:** Triggered after scan in `POST /acu/scan` → `detectContradictions()` loads all LOCKED ACUs + PENDING_REVIEW candidates → runs R1-R5 rule-based checks synchronously → sends remaining to Claude with critical pairs pre-flagged → persists new contradictions to `acu_contradictions`.
- **ACU lifecycle:** Candidate reviewed in backlog → `PATCH /acu/backlog/:id/approve` promotes to `approved_content_units` (APPROVED or LOCKED) → `PATCH /acu/:id/approve` advances DRAFT→APPROVED → `PATCH /acu/:id/lock` advances APPROVED→LOCKED (immutable) → `PATCH /acu/:id/cascade` flags all referencing documents for review.
- **Template generation:** `POST /generation/from-template` → `generateFromTemplate()` fetches template + parent → merges parent required/prohibited ACUs → loads locked ACU content + prohibited ACU content → composes section definitions → constructs LLM prompt with locked blocks + prohibited descriptions → Claude generates JSON → `checkTemplateCompliance()` validates section presence, word limits, ACU coverage, prohibited absence → returns output + compliance report.
- **Campaign generation:** `POST /campaigns` creates campaign with `buildSequenceFromBrief()` → `POST /campaigns/:id/generate` generates content for each touchpoint via `buildAssetGenerationPrompt()` → `GET /campaigns/:id/qc` runs `runCampaignQC()` validating sequence integrity + channel compliance + prohibited content → `PATCH /campaigns/:id/activate` requires PASSED QC.
- **Transcript intelligence:** Upload via `POST /recommendation/parse-transcripts` → `POST /recommendation/analyze` sends to Claude for persona/objection extraction → `deriveMatrixFlags()` determines context flags → `POST /recommendation/rank` ranks documents by relevance → `POST /recommendation/generate-email` creates personalised draft → `POST /recommendation/confirm-send` logs to lead's `send_log`.
- **Propagation cascade:** `POST /documents/:id/propagate` → `detectPropagationTargets()` traces `downstream_dependents` → `propagateFromDocument()` sets `review_state=REQUIRES_REVIEW` on all targets → changelog entries created.
- **Google Docs sync:** `POST /gdocs/export/:id` creates Google Doc via Drive API → `POST /gdocs/import/:id` pulls content back → `GET /gdocs/status/:id` checks last modified.

---

### 4. Dependencies between files

- **`acuScanner.ts`:** depends on `@workspace/db` (acuTable, documentsTable, acuCandidatesTable, acuScanLogTable), `@workspace/integrations-anthropic-ai` (anthropic client) for Claude-powered extraction.
- **`acuContradictionDetector.ts`:** depends on `@workspace/db` (acuTable, acuCandidatesTable, acuContradictionsTable), `@workspace/integrations-anthropic-ai` for Claude-powered semantic analysis.
- **`generationEngine.ts`:** depends on `@workspace/db` (acuTable, outputTemplatesTable), `@workspace/integrations-anthropic-ai` for template-aware generation.
- **`campaignGenerator.ts`:** depends on `@workspace/db` (acuTable, channelsTable), `channelConstraints.ts` (buildChannelConstraintPrompt, getOutputTypeForChannel) for channel-aware prompt construction.
- **`campaignQC.ts`:** depends on `@workspace/db` (channelsTable, acuTable), `channelConstraints.ts` (validateChannelCompliance) for compliance validation.
- **`channelConstraints.ts`:** depends on `@workspace/db` (Channel type) for channel data shape.
- **`propagation.ts`:** depends on `@workspace/db` (documentsTable, changelogTable) for cascade detection and flagging.
- **`recommendation-context.ts`:** standalone — no external dependencies beyond types.
- **`dataManager.ts`:** depends on `@workspace/db` (all main tables), JSON seed files (registry.json, leads.json, acu-seed.json, channels.json), `seed-acu-refactor.ts`, `seed-templates.ts`, `seed-prompts.ts`, `logger.ts`.
- **`routes/acu/index.ts`:** depends on `acuScanner.ts` (scanDocument, scanAllDocuments), `acuContradictionDetector.ts` (detectContradictions), `@workspace/db` (all ACU-related tables).
- **`routes/generation/index.ts`:** depends on `generationEngine.ts` (generateFromTemplate), `@workspace/db` (documentsTable).
- **`routes/campaigns/index.ts`:** depends on `campaignGenerator.ts`, `campaignQC.ts`, `@workspace/db`.
- **`routes/index.ts`:** depends on all 14 route modules.
- **`App.tsx`:** depends on all 16 page components, wouter Router, TanStack React Query.
- **`acu.tsx`:** depends on TanStack React Query, Shadcn UI components (Table, Card, Badge, Button, Input, Select), Lucide icons.
- **`lib/api-client-react/`:** auto-generated from `openapi.yaml` via Orval — all page components that use generated hooks depend on this.
- **`lib/api-zod/`:** auto-generated from `openapi.yaml` via Orval — route handlers use these Zod schemas for request validation.

---

### 5. Test coverage

No tests currently exist.

If partial tests exist: No unit, integration, or end-to-end test files exist in the project source tree. All test files found reside in `node_modules/` (third-party packages only). E2E validation is performed ad-hoc via Playwright subagent during development sessions but no persisted test suites are maintained.

---

### 6. External services

- **Anthropic Claude (via `@workspace/integrations-anthropic-ai`):** Used for document scanning (acuScanner), contradiction detection (acuContradictionDetector), document generation (generationEngine, generation routes), campaign asset generation (campaignGenerator), transcript analysis (recommendation routes), email draft generation, gap brief generation, feature update analysis. Model: `claude-sonnet-4-6`, max_tokens: 8192.
- **Google Drive API (via `google-drive` Replit integration):** Used for Google Docs export/import/status sync in `routes/gdocs/`.
- **PostgreSQL (via Drizzle ORM):** Primary data store, accessed through `@workspace/db` package. Schema managed by Drizzle Kit push.

---

### 7. Patterns and conventions

- **pnpm monorepo with workspaces:** Root `pnpm-workspace.yaml` defines packages in `lib/*`, `artifacts/*`, `scripts/*`. Cross-package references use `@workspace/` prefix (e.g., `@workspace/db`, `@workspace/integrations-anthropic-ai`).
- **Drizzle ORM schema-first approach:** Tables defined in `lib/db/src/schema/*.ts`, exported via barrel `index.ts`. Schema changes pushed via `drizzle-kit push`. No manual SQL migrations.
- **OpenAPI-first codegen:** `lib/api-spec/openapi.yaml` is the API contract. Orval generates React Query hooks (`lib/api-client-react/`) and Zod validation schemas (`lib/api-zod/`). Codegen run via `pnpm --filter @workspace/api-spec run g`.
- **Express 5 route modules:** Each domain gets a route file in `artifacts/api-server/src/routes/<domain>/index.ts`. Routes mounted via `Router()`, aggregated in `routes/index.ts`. Static routes before parameterized `:id` routes.
- **LLM integration pattern:** Always `import { anthropic } from "@workspace/integrations-anthropic-ai"`. Model: `claude-sonnet-4-6`. Max tokens: 8192. Response parsing: extract JSON via regex (`/\[[\s\S]*\]/` for arrays, `/\{[\s\S]*\}/` for objects).
- **ACU status lifecycle:** DRAFT → APPROVED → LOCKED. LOCKED content is immutable and injected verbatim. Additional statuses: LEGAL_PENDING, NAMING_PENDING, SUPERSEDED.
- **Template inheritance:** Templates have optional `parent_template_id`. Child sections render first, parent compliance sections append last. Parent required/prohibited ACUs merge into child's constraints.
- **Seed idempotency:** `seedDatabase()` checks for existing leads. If data exists, runs only incremental seeds (ACU refactor, templates, prompts). Seeds use insert-if-not-exists pattern.
- **Frontend routing:** Wouter with `BASE_URL`-aware base. Pages use TanStack React Query (`useQuery`/`useMutation`) or manual `fetch()` with `API_BASE` prefix. Shadcn UI component library. Lucide icons.
- **Brand:** Dark navy (#0F1629) and charcoal (#2D2D3F) backgrounds, Unlock Green (#00C853) accent, Inter font family throughout. Institutional, intelligence-forward tone.
- **Compliance constants are LOCKED:** 3.8x Unlock model, 5-6x effective cost, 38.5p EIS / 27.5p SEIS, 22p = PROHIBITED, VCT = 20%. Always "subject to individual tax circumstances".

---

### 8. Inconsistencies and flags

- **Duplicate parent template fetch:** `generationEngine.ts` fetches the parent template twice (lines 98-103 for section composition and again at lines 108-117 for ACU merging). Should be consolidated into a single query.
- **`acu_candidates` table lacks `topics` column:** The `acuCandidatesTable` has no `topics` field, but `ContentUnit` interface in `acuContradictionDetector.ts` expects it. Candidate-sourced units always have `topics: []`, weakening R1 numeric mismatch detection for candidates.
- **Mixed data access patterns on frontend:** Some pages use generated React Query hooks from `@workspace/api-client-react` (dashboard, leads, documents, recommend, generate), while others use manual `fetch()` calls (acu.tsx, campaigns, gaps, call-prep, persona-analytics). No consistent pattern.
- **Text date fields:** Most date columns use `text` type rather than Postgres `timestamp` or `date`. Only `changelog.timestamp`, `conversations.createdAt`, `messages.createdAt`, and `leads.created_at`/`updated_at` use actual `timestamp` types. Prevents DB-level date operations.
- **Prompt Registry not operationally wired:** P001-P004 are stored as governed objects in `system_prompts` table with rubric scores, but the actual scanner, detector, and generation engine use hardcoded prompt strings rather than loading from the registry. The registry is display-only.
- **Minimal foreign key constraints:** Most tables reference each other by text IDs (e.g., `campaign_assets.campaign_id`, `output_templates.parent_template_id`, `acu_candidates.source_document_id`) without Drizzle `references()`. The single exception is `messages.conversationId` which has an FK with cascade delete to `conversations`. Referential integrity is otherwise enforced only at application level.
- **`conversations`/`messages` tables orphaned:** Schema exists but no routes or frontend pages reference these tables. Purpose unclear from scan.
