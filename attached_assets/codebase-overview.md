## CURRENT STATE OUTPUT

### 0. Scan coverage
**Scope:** full repo
**Fully scanned:** `artifacts/api-server/src/`, `artifacts/unlock-intel/src/`, `lib/db/src/schema/`, `lib/api-zod/src/`, `lib/api-client-react/src/`, `lib/api-spec/`, `lib/integrations-anthropic-ai/src/`, root config files
**Summarised at directory level:** `artifacts/unlock-intel/src/components/ui/` (50+ Shadcn/Radix primitives), `lib/api-zod/src/generated/types/` (100+ generated type files), `attached_assets/` (reference documents)
**Could not reach:** none
**Limitations:** none

---

### 1. Key files

#### `artifacts/api-server/src/index.ts`
**What it does:** Initializes the Express server, seeds the database, loads compliance constants into memory, and starts listening on the environment-defined PORT.
**Key functions, variables, data structures:** `seedDatabase()` from dataManager, `loadComplianceConstants()` from complianceConstantsService.

#### `artifacts/api-server/src/app.ts`
**What it does:** Configures the Express application with middleware (CORS, Pino logging, JSON parsing) and mounts the main router under the `/api` prefix.
**Key functions, variables, data structures:** `app` (Express instance), middleware chain, router mount.

#### `artifacts/api-server/src/routes/index.ts`
**What it does:** Master router that aggregates 20+ sub-routers (leads, documents, campaigns, generation, acu, etc.) into a single API surface.
**Key functions, variables, data structures:** `router` (Express Router), sub-router mounts for each domain.

#### `artifacts/api-server/src/routes/leads/index.ts`
**What it does:** Manages lead CRUD, pipeline stages, persona detection, bulk upload, deletion, and next-best-action determination.
**Key functions, variables, data structures:** `GET /leads`, `POST /leads`, `DELETE /leads/:id`, `POST /leads/bulk`, fuzzy matching integration.

#### `artifacts/api-server/src/routes/documents/index.ts`
**What it does:** Handles document lifecycle (Tier 1-3), AI quality scoring, PDF generation/export, Google Docs export, and propagation (cascading updates).
**Key functions, variables, data structures:** `PATCH /documents/:id`, `POST /documents/:id/generate-pdf`, `GET /documents/:id/download-pdf`, review_state transitions, content_updated_at tracking.

#### `artifacts/api-server/src/routes/generation/index.ts`
**What it does:** Engine for AI content creation — generates documents from templates or custom input, runs QC checks, manages regeneration on QC failure.
**Key functions, variables, data structures:** `POST /generation/generate`, `POST /generation/qc-rerun`, template-based and freeform generation modes.

#### `artifacts/api-server/src/routes/acu/index.ts`
**What it does:** Manages Approved Content Units lifecycle (DRAFT → APPROVED → LOCKED → SUPERSEDED), expression variants, and contradiction detection.
**Key functions, variables, data structures:** ACU CRUD endpoints, versioning endpoint, backlog candidate management.

#### `artifacts/api-server/src/routes/campaigns/index.ts`
**What it does:** Manages multi-channel campaign orchestration — builds touchpoint sequences, triggers AI generation of campaign assets.
**Key functions, variables, data structures:** Campaign CRUD, sequence builder, asset generation triggers, status transitions (DRAFT → GENERATING → QC_PENDING → READY → ACTIVE).

#### `artifacts/api-server/src/routes/recommendation/index.ts`
**What it does:** Processes call transcripts to detect personas, pipeline stages, and objections; ranks documents using AI and belief-aware gating.
**Key functions, variables, data structures:** `POST /recommendation/analyze`, `POST /recommendation/rank`, belief-aware hard gates, matrix flag derivation.

#### `artifacts/api-server/src/routes/gdocs/index.ts`
**What it does:** Exports documents to Google Docs via the Google Drive connector, with optional AI-powered formatting.
**Key functions, variables, data structures:** `POST /gdocs/export/:id`, format parameter (`?format=ai`), Drive file creation/update.

#### `artifacts/api-server/src/routes/sheet-sync/index.ts`
**What it does:** Synchronizes leads and call transcripts from Google Sheets, including fuzzy matching for lead identification.
**Key functions, variables, data structures:** Sheet data fetch, lead upsert, fuzzy matching integration.

#### `artifacts/api-server/src/routes/document-health/index.ts`
**What it does:** Runs 7-dimension health analysis (identity, targeting, belief, compliance, propagation, content, delivery) across all CURRENT documents.
**Key functions, variables, data structures:** `POST /document-health/run`, `GET /document-health/latest`, scoring sessions.

#### `artifacts/api-server/src/routes/work-queue/index.ts`
**What it does:** AI-powered work queue that analyses documents requiring review, classifies findings as auto-fix or decision cards, and provides resolution endpoints.
**Key functions, variables, data structures:** `POST /work-queue/start`, `POST /work-queue/auto-fix`, `POST /work-queue/cards/:findingId/accept`, `POST /work-queue/cards/:findingId/skip`, `GET /work-queue/summary`.

#### `artifacts/api-server/src/routes/compliance-constants/index.ts`
**What it does:** Manages compliance constants (regulatory figures) with a two-step proposal-confirmation workflow.
**Key functions, variables, data structures:** Constants CRUD, proposal flow, affected document flagging.

#### `artifacts/api-server/src/routes/import/index.ts`
**What it does:** Handles bulk document import from PDF/DOCX files, tracking sessions and creating/updating records with validation.
**Key functions, variables, data structures:** `POST /import/upload`, `POST /import/quick-update`, session tracking.

#### `artifacts/api-server/src/routes/tasks/index.ts`
**What it does:** Task board for tracking review, build, import, and general tasks with propagation-triggered auto-creation.
**Key functions, variables, data structures:** Task CRUD, status transitions, propagation linkage.

#### `artifacts/api-server/src/routes/content/gaps.ts`
**What it does:** Identifies content deficiencies based on coverage matrices and generates AI briefs for new content.
**Key functions, variables, data structures:** Gap detection, matrix coverage analysis, brief generation.

#### `artifacts/api-server/src/routes/content/feature-update.ts`
**What it does:** Detects and flags documents affected by product feature changes for review, prioritizing them in a review queue.
**Key functions, variables, data structures:** Feature update cascade, affected document identification, review queue prioritization.

#### `artifacts/api-server/src/routes/analytics/index.ts`
**What it does:** Provides analytics data for persona coverage and content performance.
**Key functions, variables, data structures:** Analytics aggregation endpoints.

#### `artifacts/api-server/src/routes/videos/index.ts`
**What it does:** Manages video content metadata.
**Key functions, variables, data structures:** Video CRUD endpoints.

#### `artifacts/api-server/src/routes/dashboard/index.ts`
**What it does:** Supplies aggregated metrics for the Command Centre dashboard.
**Key functions, variables, data structures:** Lead counts, document stats, pipeline breakdowns, coverage gap highlights.

#### `artifacts/api-server/src/routes/health.ts`
**What it does:** Simple health check endpoint for server liveness.
**Key functions, variables, data structures:** `GET /health`.

#### `artifacts/api-server/src/lib/generationEngine.ts`
**What it does:** Orchestrates document assembly from templates, ensuring Locked ACUs are present and Prohibited ACUs are absent in LLM output.
**Key functions, variables, data structures:** Prompt construction, ACU injection, compliance enforcement, Claude API calls.

#### `artifacts/api-server/src/lib/campaignGenerator.ts`
**What it does:** Builds campaign sequences (Cold Outreach, Warm Nurture, etc.) and generates channel-specific prompts (LinkedIn, Email, WhatsApp).
**Key functions, variables, data structures:** Sequence templates, channel prompt builders.

#### `artifacts/api-server/src/lib/campaignQC.ts`
**What it does:** Quality control checks specific to campaign assets.
**Key functions, variables, data structures:** Campaign-specific QC checklist.

#### `artifacts/api-server/src/lib/acuScanner.ts`
**What it does:** Uses AI to scan existing documents to identify and extract new candidate ACUs, assigning importance levels.
**Key functions, variables, data structures:** `scanDocument()`, importance classification (Foundational, Structural, etc.).

#### `artifacts/api-server/src/lib/acuContradictionDetector.ts`
**What it does:** Detects contradictions between ACUs using AI analysis.
**Key functions, variables, data structures:** Contradiction detection, severity classification.

#### `artifacts/api-server/src/lib/pdfService.ts`
**What it does:** Renders HTML templates into A4 PDFs using Puppeteer-core with Inter font embedding and branded Design Bible styling.
**Key functions, variables, data structures:** Browser singleton, `generatePDF()`, base64 font embedding, SVG logo.

#### `artifacts/api-server/src/lib/formatService.ts`
**What it does:** AI-powered formatting pipeline that runs content through Claude with Design Bible v0.2 rules before Google Docs export.
**Key functions, variables, data structures:** `formatForGDocs()`, typography/colour/terminology rules.

#### `artifacts/api-server/src/lib/dataManager.ts`
**What it does:** Handles database seeding, initial data loading from JSON, and utility logic like `getNextBestAction` for leads.
**Key functions, variables, data structures:** `seedDatabase()`, seed data loading, next-best-action logic.

#### `artifacts/api-server/src/lib/complianceConstantsService.ts`
**What it does:** Manages the source-of-truth for financial regulatory figures used across QC checks.
**Key functions, variables, data structures:** `loadComplianceConstants()`, in-memory constants cache.

#### `artifacts/api-server/src/lib/fuzzyMatch.ts`
**What it does:** Fuzzy matching utility for identifying leads from imprecise inputs (e.g., transcript speaker names).
**Key functions, variables, data structures:** String similarity scoring.

#### `artifacts/api-server/src/lib/importParser.ts`
**What it does:** Parses uploaded PDF and DOCX files, extracting text content for document records.
**Key functions, variables, data structures:** PDF text extraction (pdfjs-dist), DOCX conversion (mammoth).

#### `artifacts/api-server/src/lib/taskHelpers.ts`
**What it does:** Helper functions for creating and managing tasks, including propagation-triggered auto-creation.
**Key functions, variables, data structures:** Task creation utilities, propagation linkage.

#### `artifacts/api-server/src/lib/propagation.ts`
**What it does:** Implements cascading update logic — when a document changes, identifies and flags dependent documents for review.
**Key functions, variables, data structures:** Dependency chain traversal, review flagging.

#### `artifacts/api-server/src/lib/recommendation-context.ts`
**What it does:** Provides context derivation logic for the recommendation engine, including matrix flag detection from AI analysis.
**Key functions, variables, data structures:** Context flag derivation, matrix context building.

#### `artifacts/api-server/src/lib/channelConstraints.ts`
**What it does:** Defines constraints for different communication channels (email, LinkedIn, WhatsApp) including character limits and formatting rules.
**Key functions, variables, data structures:** Channel constraint definitions.

#### `artifacts/api-server/src/lib/brand.ts`
**What it does:** Brand constants (colours, typography, terminology) used across templates and exports.
**Key functions, variables, data structures:** Brand colour palette, font specifications.

#### `artifacts/api-server/src/lib/logger.ts`
**What it does:** Configures Pino structured logging for the API server.
**Key functions, variables, data structures:** Logger instance, log level configuration.

#### `artifacts/api-server/src/lib/templates/index.ts`
**What it does:** HTML templates for PDF export and Google Docs, implementing the Design Bible visual identity.
**Key functions, variables, data structures:** Template functions, SVG logo, styling constants.

#### `artifacts/api-server/src/data/seed-templates.ts`
**What it does:** Seed data for output templates used in content generation.
**Key functions, variables, data structures:** Template definitions with section structures and formatting rules.

#### `artifacts/api-server/src/data/seed-prompts.ts`
**What it does:** Seed data for system prompts used in AI interactions.
**Key functions, variables, data structures:** Prompt templates, versioned prompt definitions.

#### `artifacts/api-server/src/data/seed-acu-refactor.ts`
**What it does:** Seed data for approved content units including locked/prohibited designations.
**Key functions, variables, data structures:** ACU seed records with expression variants.

#### `artifacts/api-server/src/data/document-usage-matrix.ts`
**What it does:** Encodes complex routing rules for document eligibility and weighting based on persona, stage, and context flags.
**Key functions, variables, data structures:** Usage matrix data structure, eligibility rules, weight mappings.

#### `artifacts/unlock-intel/src/App.tsx`
**What it does:** Main entry point and routing configuration — defines 20+ client-side routes using wouter, wraps app in QueryClientProvider and TooltipProvider.
**Key functions, variables, data structures:** Route definitions, `App` component, QueryClient instance.

#### `artifacts/unlock-intel/src/main.tsx`
**What it does:** Standard React entry point that renders the App component into the HTML root.
**Key functions, variables, data structures:** `ReactDOM.createRoot()`, root render call.

#### `artifacts/unlock-intel/src/components/layout.tsx`
**What it does:** Persistent application shell with sidebar navigation and top header, organising nav into Operations, Content, Governance, and System groups.
**Key functions, variables, data structures:** `Layout` component, nav group definitions, real-time Work Queue badge.

#### `artifacts/unlock-intel/src/pages/dashboard.tsx`
**What it does:** "Command Centre" displaying high-level metrics (Total Leads, Documents Sent, Action Required), activity feeds, pipeline breakdowns, and coverage gap highlights.
**Key functions, variables, data structures:** Dashboard component, metric cards, activity feed, gap visualization.

#### `artifacts/unlock-intel/src/pages/recommend.tsx`
**What it does:** Recommendation Engine interface — accepts call transcripts or batch uploads, detects investor personas/stages/objections, ranks documents, generates email drafts.
**Key functions, variables, data structures:** Transcript paste/upload, persona detection display, document ranking table, email draft generator.

#### `artifacts/unlock-intel/src/pages/acu.tsx`
**What it does:** ACU governance interface — manages lifecycle (Draft → Approved → Locked), detects contradictions, manages prompt templates.
**Key functions, variables, data structures:** ACU list/detail views, status transitions, contradiction display, template management.

#### `artifacts/unlock-intel/src/pages/leads.tsx`
**What it does:** CRM-style searchable lead directory with bulk upload, individual delete, and pipeline stage filtering.
**Key functions, variables, data structures:** Lead table, search/filter UI, bulk CSV upload dialog, delete confirmation.

#### `artifacts/unlock-intel/src/pages/lead-detail.tsx`
**What it does:** Individual lead profile with tabs for Overview (send history, persona, timeline) and Intelligence & Beliefs (operator notes, qualification data, belief map, next steps).
**Key functions, variables, data structures:** Tabbed layout, belief state visualization, auto-save notes, gate display.

#### `artifacts/unlock-intel/src/pages/gaps.tsx`
**What it does:** Content Gap Analysis — visualises the Coverage Matrix showing missing materials for investor stage × archetype combinations.
**Key functions, variables, data structures:** Coverage matrix grid, gap identification, brief generation trigger.

#### `artifacts/unlock-intel/src/pages/campaigns.tsx`
**What it does:** Campaign list and orchestration interface.
**Key functions, variables, data structures:** Campaign table, status filters, creation flow.

#### `artifacts/unlock-intel/src/pages/campaign-detail.tsx`
**What it does:** Individual campaign management — touchpoint sequence editor, asset generation, QC review.
**Key functions, variables, data structures:** Sequence timeline, asset previews, QC status display.

#### `artifacts/unlock-intel/src/lib/utils.ts`
**What it does:** Standard utility functions, primarily the `cn` helper for dynamic Tailwind class merging.
**Key functions, variables, data structures:** `cn()` (clsx + tailwind-merge).

#### `lib/db/src/schema/index.ts`
**What it does:** Barrel export for all database schema definitions.
**Key functions, variables, data structures:** Re-exports all table definitions and schemas.

#### `lib/db/src/schema/leads.ts`
**What it does:** Defines the leads database table with pipeline stage, persona detection, and send log tracking.
**Key functions, variables, data structures:** `leadsTable`, `insertLeadSchema`, pipeline_stage enum, send_log jsonb.

#### `lib/db/src/schema/lead-intelligence.ts`
**What it does:** Deep investor qualification data including tax status, capital availability, estate value, and SPIN selling metrics.
**Key functions, variables, data structures:** `leadIntelligenceTable`, qualification fields, SPIN metrics.

#### `lib/db/src/schema/lead-beliefs.ts`
**What it does:** Tracks the state of specific beliefs (UNKNOWN, ESTABLISHED, etc.) for each lead.
**Key functions, variables, data structures:** `leadBeliefsTable`, belief state enum.

#### `lib/db/src/schema/belief-registry.ts`
**What it does:** Master list of beliefs grouped by clusters with prerequisite mapping.
**Key functions, variables, data structures:** `beliefRegistryTable`, cluster grouping, prerequisite chain.

#### `lib/db/src/schema/belief-transitions.ts`
**What it does:** Logs transitions between belief states for audit purposes.
**Key functions, variables, data structures:** `beliefTransitionsTable`, from_state/to_state tracking.

#### `lib/db/src/schema/documents.ts`
**What it does:** Document metadata including tier (1-3), review state, lifecycle status, belief targets, and PDF export tracking.
**Key functions, variables, data structures:** `documentsTable`, `insertDocumentSchema`, tier enum, review_state, lifecycle_status, pdf_exported_at, content_updated_at.

#### `lib/db/src/schema/document-health-scores.ts`
**What it does:** Stores 7-dimension health scores per document from health check sessions.
**Key functions, variables, data structures:** `documentHealthScoresTable`, dimension scores.

#### `lib/db/src/schema/document-health-sessions.ts`
**What it does:** Tracks health check session lifecycle.
**Key functions, variables, data structures:** `documentHealthSessionsTable`, session status.

#### `lib/db/src/schema/acu.ts`
**What it does:** Approved Content Units table — compliance-critical content atoms with expression variants and status lifecycle.
**Key functions, variables, data structures:** `acuTable`, `insertAcuSchema`, status enum (DRAFT/APPROVED/LOCKED/SUPERSEDED), expression_variants jsonb.

#### `lib/db/src/schema/acu-intelligence.ts`
**What it does:** ACU discovery pipeline (candidates) and contradiction detection between ACUs.
**Key functions, variables, data structures:** `acuCandidatesTable`, `acuContradictionsTable`, severity classification.

#### `lib/db/src/schema/campaigns.ts`
**What it does:** Campaign strategy and generated assets tables.
**Key functions, variables, data structures:** `campaignsTable`, `campaignAssetsTable`, target_cluster, primary_belief, sequence jsonb.

#### `lib/db/src/schema/compliance-constants.ts`
**What it does:** Regulatory/legal values used in QC checks (e.g., "EIS income tax relief: 30%").
**Key functions, variables, data structures:** `complianceConstantsTable`, proposal workflow fields.

#### `lib/db/src/schema/system-prompts.ts`
**What it does:** Versioned LLM prompts used across AI interactions.
**Key functions, variables, data structures:** `systemPromptsTable`, version tracking.

#### `lib/db/src/schema/output-templates.ts`
**What it does:** JSON-based templates for document generation with section structures and formatting rules.
**Key functions, variables, data structures:** `outputTemplatesTable`, sections jsonb, formatting_rules jsonb.

#### `lib/db/src/schema/tasks.ts`
**What it does:** Task board schema for review, build, import, and general tasks.
**Key functions, variables, data structures:** `tasksTable`, task type enum, status, propagation linkage.

#### `lib/db/src/schema/work-queue-findings.ts`
**What it does:** Findings from automated document analysis — auto-fix or decision-card classifications.
**Key functions, variables, data structures:** `workQueueFindingsTable`, finding_type, status (PENDING/AUTO_FIXED/ACCEPTED/SKIPPED/FAILED).

#### `lib/db/src/schema/work-queue-sessions.ts`
**What it does:** Work queue session lifecycle tracking.
**Key functions, variables, data structures:** `workQueueSessionsTable`, status (PENDING/ANALYSING/READY/COMPLETE/FAILED), progress counters.

#### `lib/db/src/schema/channels.ts`
**What it does:** Communication channel definitions.
**Key functions, variables, data structures:** `channelsTable`.

#### `lib/db/src/schema/videos.ts`
**What it does:** Video content metadata.
**Key functions, variables, data structures:** `videosTable`.

#### `lib/db/src/schema/gap-snapshots.ts`
**What it does:** Persists point-in-time content gap analysis results.
**Key functions, variables, data structures:** `gapSnapshotsTable`.

#### `lib/db/src/schema/changelog.ts`
**What it does:** Audit log for all significant system actions.
**Key functions, variables, data structures:** `changelogTable`, action type, entity reference.

#### `lib/db/src/schema/messages.ts`
**What it does:** Message records.
**Key functions, variables, data structures:** `messagesTable`.

#### `lib/db/src/schema/conversations.ts`
**What it does:** Conversation thread records.
**Key functions, variables, data structures:** `conversationsTable`.

#### `lib/db/src/schema/sheet-sync-sessions.ts`
**What it does:** Tracks Google Sheets sync session history.
**Key functions, variables, data structures:** `sheetSyncSessionsTable`.

#### `lib/db/src/schema/import-sessions.ts`
**What it does:** Tracks document import session history.
**Key functions, variables, data structures:** `importSessionsTable`.

#### `lib/api-spec/openapi.yaml`
**What it does:** OpenAPI 3.0 specification defining the entire API contract — all endpoints, request/response schemas, and types.
**Key functions, variables, data structures:** Full API surface definition used by Orval for codegen.

#### `lib/api-zod/src/index.ts`
**What it does:** Barrel export for all generated Zod schemas and TypeScript types.
**Key functions, variables, data structures:** Re-exports from generated types directory.

#### `lib/api-client-react/src/generated/api.ts`
**What it does:** Generated React Query hooks for all API endpoints (via Orval).
**Key functions, variables, data structures:** `useListLeads()`, `useGetDocument()`, `useAnalyzeTranscript()`, etc. — one hook per endpoint.

#### `lib/api-client-react/src/generated/api.schemas.ts`
**What it does:** Generated Zod schemas for all API request/response types.
**Key functions, variables, data structures:** Schema definitions matching OpenAPI spec.

#### `lib/integrations-anthropic-ai/src/client.ts`
**What it does:** Wrapper for Anthropic Claude API calls using environment-configured API key and base URL.
**Key functions, variables, data structures:** Anthropic client instance, `AI_INTEGRATIONS_ANTHROPIC_API_KEY`, `AI_INTEGRATIONS_ANTHROPIC_BASE_URL`.

---

### 2. Data model

- **`leadsTable`:** id (serial PK), name (text), company (text), email (text), phone (text), pipeline_stage (text), detected_persona (text), send_log (jsonb), notes (text), created_at/updated_at (timestamps)
- **`leadIntelligenceTable`:** id (serial PK), lead_id (FK → leads), higher_rate_taxpayer (boolean), capital_available (text), estate_above_2m (boolean), eis_familiar (boolean), ifa_involved (boolean), cluster (text), readiness (text), spin_metrics (jsonb), operator_notes (text), created_at/updated_at (timestamps)
- **`leadBeliefsTable`:** id (serial PK), lead_id (FK → leads), belief_id (FK → belief_registry), state (text: UNKNOWN/ESTABLISHED/etc.), updated_at (timestamp)
- **`beliefRegistryTable`:** id (serial PK), belief_key (text), label (text), cluster (text), prerequisites (jsonb), is_hard_gate (boolean)
- **`beliefTransitionsTable`:** id (serial PK), lead_id (FK), belief_id (FK), from_state (text), to_state (text), trigger (text), created_at (timestamp)
- **`documentsTable`:** id (serial PK), title (text), content (text), tier (integer 1-3), review_state (text), lifecycle_status (text), belief_targets (jsonb), doc_number (integer), pdf_exported_at (timestamp nullable), content_updated_at (timestamp nullable), pdf_file_path (text nullable), created_at/updated_at (timestamps)
- **`documentHealthScoresTable`:** id (serial PK), session_id (FK), document_id (FK), dimension scores (identity/targeting/belief/compliance/propagation/content/delivery — each integer), overall (integer), findings (jsonb)
- **`documentHealthSessionsTable`:** id (serial PK), status (text), started_at/completed_at (timestamps), total_docs/completed_docs (integers)
- **`acuTable`:** id (serial PK), title (text), content (text), status (text: DRAFT/APPROVED/LOCKED/SUPERSEDED), type (text), importance (text), expression_variants (jsonb), source_document_id (integer nullable), version (integer), created_at/updated_at (timestamps)
- **`acuCandidatesTable`:** id (serial PK), content (text), source_document_id (FK), importance (text), status (text), created_at (timestamp)
- **`acuContradictionsTable`:** id (serial PK), acu_a_id (FK), acu_b_id (FK), description (text), severity (text), status (text), created_at (timestamp)
- **`campaignsTable`:** id (serial PK), name (text), target_cluster (text), primary_belief (text), status (text: DRAFT/GENERATING/QC_PENDING/READY/ACTIVE), sequence (jsonb), channel (text), created_at/updated_at (timestamps)
- **`campaignAssetsTable`:** id (serial PK), campaign_id (FK), channel (text), content (text), status (text), touchpoint_index (integer), created_at (timestamp)
- **`complianceConstantsTable`:** id (serial PK), key (text), value (text), description (text), proposed_value (text nullable), proposed_by (text nullable), confirmed (boolean), created_at/updated_at (timestamps)
- **`systemPromptsTable`:** id (serial PK), key (text), content (text), version (integer), active (boolean), created_at/updated_at (timestamps)
- **`outputTemplatesTable`:** id (serial PK), name (text), description (text), sections (jsonb), formatting_rules (jsonb), created_at/updated_at (timestamps)
- **`tasksTable`:** id (serial PK), title (text), description (text), type (text: review/build/import/general), status (text), document_id (integer nullable), propagation_id (integer nullable), created_at/updated_at (timestamps)
- **`workQueueSessionsTable`:** id (serial PK), status (text: PENDING/ANALYSING/READY/COMPLETE/FAILED), total/completed/pending (integers), started_at/completed_at (timestamps)
- **`workQueueFindingsTable`:** id (serial PK), session_id (FK), task_id (integer), document_id (integer), finding_type (text: auto_fix/decision_card), status (text: PENDING/AUTO_FIXED/ACCEPTED/SKIPPED/FAILED), description (text), fix_details (jsonb), created_at (timestamp)
- **`channelsTable`:** id (serial PK), name (text), constraints (jsonb)
- **`videosTable`:** id (serial PK), title (text), url (text), document_id (FK nullable), created_at (timestamp)
- **`gapSnapshotsTable`:** id (serial PK), gaps (jsonb), created_at (timestamp)
- **`changelogTable`:** id (serial PK), action (text), entity_type (text), entity_id (integer), details (jsonb), created_at (timestamp)
- **`messagesTable`:** id (serial PK), conversation_id (FK), content (text), role (text), created_at (timestamp)
- **`conversationsTable`:** id (serial PK), title (text), created_at (timestamp)
- **`sheetSyncSessionsTable`:** id (serial PK), status (text), sheet_id (text), rows_processed (integer), leads_created/updated (integers), created_at (timestamp)
- **`importSessionsTable`:** id (serial PK), status (text), files_count (integer), created/updated/failed (integers), created_at (timestamp)

---

### 3. Data flow

- **Transcript → Recommendation:** User pastes a call transcript into the Recommend page → `POST /recommendation/analyze` sends it to Claude for persona/stage/objection detection → returns `TranscriptAnalysis` → `POST /recommendation/rank` uses the analysis + document usage matrix + belief gates to score and rank documents → returns `RecommendationResult` with ranked documents and email draft.

- **Document Generation:** User triggers generation from a template → `POST /generation/generate` calls `generationEngine.ts` which assembles the prompt (template sections + Locked ACUs as mandatory inclusions + Prohibited ACUs as exclusions) → sends to Claude → receives generated content → runs 19-check QC checklist → returns content with `QCReport`. If QC fails, user can trigger regeneration.

- **Document → PDF Export:** User clicks export → `POST /documents/:id/generate-pdf` calls `pdfService.ts` → renders branded HTML (Design Bible template) in Puppeteer → saves PDF to disk → updates `pdf_exported_at` and `pdf_file_path` on document record → user downloads via `GET /documents/:id/download-pdf`.

- **Document → Google Docs Export:** User clicks export → `POST /gdocs/export/:id` optionally runs AI formatting via `formatService.ts` → uploads as HTML to Google Drive via Replit Connectors SDK → returns Google Docs URL.

- **Lead Management:** Leads created via UI, bulk CSV upload, or Google Sheets sync → stored in `leadsTable` → intelligence data in `leadIntelligenceTable` → belief states tracked in `leadBeliefsTable` → recommendation engine reads belief states for gating → send log updated when documents are sent.

- **ACU Lifecycle:** Content scanned by `acuScanner.ts` → candidates stored in `acuCandidatesTable` → approved → promoted to `acuTable` as DRAFT → APPROVED → LOCKED. Locked ACUs are injected into generation prompts. Contradictions detected by `acuContradictionDetector.ts` and stored in `acuContradictionsTable`.

- **Campaign Flow:** User creates campaign brief → `campaignGenerator.ts` builds touchpoint sequence → AI generates assets per channel → `campaignQC.ts` runs QC → assets stored in `campaignAssetsTable` → campaign status transitions through DRAFT → GENERATING → QC_PENDING → READY → ACTIVE.

- **Propagation Cascade:** When a document is updated → `propagation.ts` traverses tier dependency chain → flags dependent documents as REQUIRES_REVIEW → auto-creates review tasks in `tasksTable` → appears in Work Queue.

- **Work Queue:** `POST /work-queue/start` fetches REQUIRES_REVIEW documents → sends each to Claude for analysis → classifies findings as auto_fix or decision_card → auto-fixes applied automatically with verification → decision cards presented to user for accept/skip.

- **Content Gap Analysis:** `gaps.ts` computes coverage matrix (stage × archetype) → identifies missing content → generates AI briefs for new documents → persists snapshots in `gapSnapshotsTable`.

- **Document Health Check:** `POST /document-health/run` analyses all CURRENT documents across 7 dimensions via Claude → scores stored in `documentHealthScoresTable` → library-wide findings (unmapped beliefs, stage coverage gaps, propagation orphans) surfaced on frontend.

- **Google Sheets Sync:** `POST /sheet-sync/start` fetches data from Google Sheets via Replit Connectors → fuzzy matches investor names to existing leads → creates or updates lead records → logs sync session.

---

### 4. Dependencies between files

- **`artifacts/api-server/src/routes/*`:** depend on `lib/db` for database access (Drizzle ORM queries) and `lib/api-zod` for request/response validation.
- **`artifacts/api-server/src/lib/generationEngine.ts`:** depends on `lib/integrations-anthropic-ai` for Claude API calls, `lib/db` for ACU and template data.
- **`artifacts/api-server/src/lib/campaignGenerator.ts`:** depends on `lib/integrations-anthropic-ai` for AI generation, `channelConstraints.ts` for channel rules.
- **`artifacts/api-server/src/lib/acuScanner.ts`:** depends on `lib/integrations-anthropic-ai` for document scanning.
- **`artifacts/api-server/src/lib/acuContradictionDetector.ts`:** depends on `lib/integrations-anthropic-ai` for contradiction analysis.
- **`artifacts/api-server/src/lib/pdfService.ts`:** depends on `templates/index.ts` for HTML templates, system Chromium for Puppeteer rendering.
- **`artifacts/api-server/src/lib/formatService.ts`:** depends on `lib/integrations-anthropic-ai` for AI formatting.
- **`artifacts/api-server/src/lib/importParser.ts`:** depends on `pdfjs-dist` and `mammoth` for file parsing.
- **`artifacts/api-server/src/routes/gdocs/index.ts`:** depends on `@replit/connectors-sdk` for Google Drive API access.
- **`artifacts/api-server/src/routes/sheet-sync/index.ts`:** depends on `@replit/connectors-sdk` for Google Sheets API access, `fuzzyMatch.ts` for lead matching.
- **`artifacts/api-server/src/routes/recommendation/index.ts`:** depends on `recommendation-context.ts` for matrix flag derivation, `data/document-usage-matrix.ts` for eligibility rules.
- **`artifacts/api-server/src/lib/propagation.ts`:** depends on `lib/db` for document tier relationships, `taskHelpers.ts` for auto-task creation.
- **`artifacts/unlock-intel/src/App.tsx`:** depends on all page components for route rendering.
- **`artifacts/unlock-intel/src/pages/*`:** depend on `@workspace/api-client-react` for API calls (generated React Query hooks) and `components/ui/*` for UI primitives.
- **`lib/api-client-react`:** depends on `lib/api-spec` (OpenAPI spec) via Orval codegen.
- **`lib/api-zod`:** depends on `lib/api-spec` (OpenAPI spec) via Orval codegen.
- **`lib/db`:** standalone — depended on by `api-server` and indirectly by all route handlers.

---

### 5. Test coverage

No tests currently exist. The `tsconfig.json` files in `artifacts/unlock-intel` and `artifacts/mockup-sandbox` exclude test patterns but no test files are present anywhere in the codebase.

---

### 6. External services

- **Anthropic Claude (claude-sonnet-4-6):** Core LLM for content generation, document analysis, QC checks, gap analysis, ACU scanning, contradiction detection, campaign asset generation, work queue analysis, recommendation ranking, and AI-powered formatting. Accessed via `@anthropic-ai/sdk` with Replit AI Integrations proxy (`AI_INTEGRATIONS_ANTHROPIC_API_KEY`, `AI_INTEGRATIONS_ANTHROPIC_BASE_URL`).
- **Google Drive API:** Exporting generated content to Google Docs and importing content back. Accessed via `@replit/connectors-sdk` using the `google-drive` connector.
- **Google Sheets API:** Syncing lead data and transcripts from spreadsheets. Accessed via `@replit/connectors-sdk` using the `google-drive` connector (Sheets API endpoints).
- **PostgreSQL:** Primary relational database for all application data. Accessed via `drizzle-orm` with `pg` driver.
- **Puppeteer-core (System Chromium):** Server-side PDF generation by rendering branded HTML templates in a headless browser.

---

### 7. Patterns and conventions

- **Monorepo structure:** pnpm workspaces with `artifacts/` for applications and `lib/` for shared libraries. Established in root `pnpm-workspace.yaml`.
- **API-first design:** OpenAPI spec (`lib/api-spec/openapi.yaml`) is the single source of truth. Orval generates both Zod validation schemas (`lib/api-zod`) and React Query client hooks (`lib/api-client-react`). All new endpoints must be defined in the spec first, then codegen'd.
- **Database access:** All schema in `lib/db/src/schema/`, using Drizzle ORM with `createInsertSchema` for Zod validation. Schema changes require new files in the schema directory and re-export from `index.ts`.
- **Route organization:** One directory per domain under `artifacts/api-server/src/routes/`, each with an `index.ts` exporting an Express Router.
- **Business logic separation:** Complex logic lives in `artifacts/api-server/src/lib/`, not in route handlers. Routes handle HTTP concerns; libs handle domain logic.
- **Frontend component library:** Shadcn/Radix UI primitives in `artifacts/unlock-intel/src/components/ui/`. Pages in `src/pages/`. Routing via wouter.
- **Tiered document system:** Documents classified as Tier 1 (Foundational), Tier 2 (Specialized), Tier 3 (Individualized). This classification governs propagation chains, protection levels, and generation rules.
- **ACU compliance enforcement:** Locked ACUs must be present in generated content; Prohibited ACUs must be absent. Enforced at generation time by `generationEngine.ts`.
- **Design Bible:** Visual identity (navy palette, Inter font, specific colour codes) enforced in PDF exports, Google Docs exports, and frontend styling.
- **Changelog auditing:** Significant actions logged to `changelogTable` for audit trail.
- **Seed data pattern:** Initial data loaded from TypeScript files in `artifacts/api-server/src/data/` via `dataManager.ts` on server start.

---

### 8. Inconsistencies and flags

- **No test coverage:** Zero test files exist despite tsconfig exclusion patterns suggesting tests were planned. This is a significant gap for a compliance-focused platform.
- **Mixed data fetching in frontend:** Most pages use generated React Query hooks from `@workspace/api-client-react`, but the Lead Detail Intelligence tab uses manual `fetch()` calls directly. This inconsistency could lead to cache synchronization issues.
- **Route handler complexity:** Some route files (e.g., `documents/index.ts`, `generation/index.ts`) contain substantial business logic inline rather than delegating to `lib/` services, deviating from the separation pattern established elsewhere.
- **Seed data coupling:** The server runs `seedDatabase()` on every startup, which could cause issues in production if seed logic isn't properly idempotent.
- **PDF file storage:** PDFs are saved to the local filesystem (`pdf_file_path`), which is not persistent across deployments. No object storage integration exists for PDF files.
- **Google Docs export strategy:** The export flow deletes and recreates Google Docs on each export (to force HTML-to-Docs conversion), which means document URLs change on re-export and any external links break.
