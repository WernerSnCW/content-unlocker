# Unlock Content Intelligence Platform

## Overview

Unlock is a UK fintech platform specializing in portfolio intelligence. This project is a full-stack internal intelligence tool designed to manage an investor database of 30,000+ contacts. Its core purpose is to enhance investor relations through AI-powered recommendations, streamlined document management, and intelligent content generation.

Key capabilities include:
- An AI-driven recommendation engine for personalized document suggestions and email draft generation.
- A comprehensive lead management system with pipeline tracking and next-best-action suggestions.
- A robust content management system for 17 key documents, featuring tier-based dependency chains, compliance oversight, and propagation alerts.
- An intelligent content generation and quality control (QC) workflow.
- A content gap analysis tool to identify missing content and generate AI briefs.
- A feature update cascade system to manage document reviews based on product changes.

## User Preferences

I prefer iterative development, with a focus on delivering functional components that can be reviewed and refined.
I value clear and concise communication, avoiding overly technical jargon where simpler language suffices.
Before making any major architectural changes or introducing new dependencies, please ask for approval.
I expect detailed explanations for complex solutions or decisions.
Do not make changes to files in the `lib/` directory without explicit instruction, as these are shared libraries.
Please ensure all new code adheres to TypeScript best practices and includes appropriate type definitions.

## System Architecture

The project is structured as a pnpm workspace monorepo using TypeScript (v5.9).

**Core Layers:**
1.  **Recommendation Engine (`/recommend`):** Processes call transcripts to detect AI personas and stages, applies deterministic eligibility filtering, ranks documents using Anthropic Claude, generates email drafts, and logs sends immutably.
2.  **Lead History (`/leads`):** Manages leads with pipeline stages, detected personas, chronological timelines, and next-best-action suggestions.
3.  **Content Management (`/registry`, `/content-bank`):** Manages a 17-document registry with tier-based dependency chains, compliance constants, and propagation alerts (Tier 1 updates cascade two levels). Includes an audit changelog.
4.  **Content Generation & QC (`/generate`):** Two modes via tab toggle: "From Template" (default) and "Custom". From Template mode loads the 22 registered templates via `GET /templates`, shows template detail panel (sections, required/prohibited ACU content previews), and submits to `POST /generation/from-template` — displays compliance check (pass/fail + issues) and generated output as named sections. Custom mode uses free-text generation via `POST /generation/generate` with QC checklist, regeneration (max 2 attempts), and promote-to-CURRENT workflow. Documents always start as DRAFT.
5.  **Content Gap Analysis (`/gaps`):** Identifies content gaps based on coverage matrices, required document types, and recommendation engine failures. Generates AI briefs for the generation pipeline.
6.  **Feature Update Cascade (`/feature-updates`):** Detects documents affected by product changes using four methods (Tier 1 propagation, semantic match, type match, compliance match), flags them for review, and prioritizes them in a review queue. Supports dry runs.

**Technical Implementations and Design Choices:**
-   **Monorepo:** pnpm workspaces for managing multiple packages.
-   **API:** Express 5 framework (`api-server`) with routes for leads, documents, recommendation, generation, content, and dashboard functionalities.
-   **Database:** PostgreSQL with Drizzle ORM (`lib/db`).
-   **Frontend:** React, Vite, Tailwind CSS, and shadcn/ui (`unlock-intel`). Features a dark navy sidebar, institutional styling, and a status color system.
-   **UI/UX:** 14 distinct pages including Dashboard, Recommend (with single and batch upload), Leads, Registry, ContentBank, Generate, GapAnalysis, and FeatureUpdates.
-   **AI Integration:** Anthropic Claude (claude-sonnet-4-6) via Replit AI Integrations proxy for core AI functionalities (recommendation, generation, QC, analysis).
-   **Google Docs Integration:** Utilizes Google Drive/Docs API via Replit Connectors SDK for syncing documents.
-   **Validation:** Zod (`zod/v4`) and `drizzle-zod` for schema validation.
-   **API Codegen:** Orval generates API client hooks and Zod schemas from an OpenAPI specification (`lib/api-spec`).
-   **Build System:** esbuild for API bundles (ESM) and Vite for frontend.
-   **Document Propagation:** Shared logic in `api-server/src/lib/propagation.ts` handles detection and flagging of downstream dependents.
-   **Approved Content Units (ACU):** Compliance-critical content atoms (facts, framings, references, qualifiers, prohibited items). 22 ACUs seeded (21 LOCKED, 1 NAMING_PENDING). API at `/api/acu` (9 endpoints: list, prohibited, injectable, get, create, approve, lock, version, cascade). Frontend at `/acu` with two tabs: Content Units + Intelligence. Integrated into QC engine (prohibited halt, locked-absent check) and generation prompt (injects LOCKED content verbatim, excludes PROHIBITED). OpenAPI spec + codegen complete.
-   **ACU Intelligence Layer:** Claude-powered content scanning and contradiction detection. DB tables: `acu_candidates`, `acu_contradictions`, `acu_scan_log`. 12 API endpoints: `POST /api/acu/scan` (full scan), `POST /api/acu/scan/:document_id` (single doc), `GET /api/acu/backlog` (review queue with importance/type filters), `GET /api/acu/backlog/contradictions`, `PATCH /api/acu/backlog/:id/approve|reject|defer|duplicate`, `PATCH /api/acu/contradictions/:id/resolve`, `GET /api/acu/coverage` (belief coverage map U1-U4, G1-G3, P1-P3, L1-L3, F0-F3), `GET /api/acu/scan-log`. Content Scanner extracts facts/framings/references/qualifiers from documents with importance ranking (Foundational/Structural/Supporting/Contextual). Contradiction Detector identifies direct contradictions, logical tensions, qualifier inconsistencies between locked ACUs and candidates (severity: CRITICAL/HIGH/MEDIUM/LOW) — now includes 5 rule-based checks (R1-R5: numeric mismatch, prohibited leak, missing qualifier, superseded active, channel variant mismatch) that run BEFORE LLM call (R1/R2 skip LLM on CRITICAL). Frontend Intelligence tab shows contradictions panel, review backlog with approve/reject/defer/duplicate actions, and belief coverage map. Uses Anthropic Claude via Replit AI Integrations proxy. OpenAPI spec + codegen complete.
-   **ACU Model Refactor:** ACU schema extended with `topics` (JSONB topic tags), `requires_qualifier` (FK to qualifier ACU), `parent_concept_id`, `is_expression_variant`, `variant_audience`, `supersedes` (FK to superseded ACU), `policy_status`. All 22 existing ACUs tagged with topic arrays. 4 new ACUs added: `acu_not_advice`, `acu_past_performance`, `acu_jan_2027_head_start`, `acu_fca_status`. Total: 26 ACUs.
-   **Template Registry:** DB table `output_templates` with 22 templates seeded (1 base compliance, 4 email, 1 call script, 1 voicemail, 1 LinkedIn, 1 WhatsApp, 2 ad briefs, 1 campaign plan, 1 whitepaper, 1 one-pager, 1 three-pager, 2 investor packs, 1 case studies, 1 estate planning, 1 explainer, 1 agent card, 1 adviser briefing). Templates define section structure, required/prohibited ACUs, formatting rules, and generation prompt prefixes. Parent-child composition (child sections + parent compliance footer). API: `GET /api/templates`, `GET /api/templates/:id` (with composed sections). Frontend: Templates tab on /acu page with expandable section detail.
-   **Generation Engine (Template-Aware):** `POST /api/generation/from-template` generates content from template definitions. Fetches template + parent, composes sections, injects locked ACU content verbatim, applies formatting rules, runs TEMPLATE_COMPLIANCE QC (required sections, word counts, required ACU presence at 95% tolerance, prohibited ACU absence). Located at `api-server/src/lib/generationEngine.ts`.
-   **Prompt Registry:** DB table `system_prompts` with 4 prompts seeded (P001 ACU Scanner 11/12, P002 Contradiction Detector 12/12, P003 Importance Ranker 10/12, P004 Template-Aware Generation 11/12). API: `GET /api/prompts`, `GET /api/prompts/:id`. Frontend: Prompts tab on /acu page with rubric star ratings and expandable full prompt text.
-   **Campaign Intelligence Platform:** Multi-channel investor campaign planning, generation, QC, and activation from a single brief. DB tables: `campaigns`, `campaign_assets`, `channels`. 11 API endpoints at `/api/campaigns` (list, create, detail, assets, generate, QC, activate, sequence, AC build, tag table) plus `/api/channels`. Campaign generator builds directed-graph sequences (cold outreach 10-node, warm nurture 7-node, ad 5-node templates). Campaign QC layer runs CHANNEL_COMPLIANCE, SEQUENCE_INTEGRITY, and ACU_PROHIBITED checks. Frontend at `/campaigns` (list + detail with tabs: Assets, Sequence Map, ActiveCampaign Build, Aircall Tags). 10 channels seeded (email_cold, email_warm, email_nurture, whatsapp, linkedin_message, meta_ad, linkedin_ad, display_ad, call_script, voicemail). OpenAPI spec + codegen complete.
-   **Compliance Constants Governance:** DB table `compliance_constants` with 22 constants seeded from JSON. In-memory cache with startup preload and invalidation on override. Service layer (`complianceConstantsService.ts`) with `getConstants()`, `getConstantByKey()`, `loadConstants()`, `invalidateCache()`, `validateOverride()`. Feature flag `COMPLIANCE_CONSTANTS_DB` (default enabled). 2-step propose→confirm workflow with "CONFIRM" typed confirmation, transactional ACTIVE→SUPERSEDED swap, document flagging for affected content, and changelog entry. Prohibited value blocking (22p, 7.8x, 78x). API: `GET /api/compliance-constants` (list), `GET /api/compliance-constants/categories`, `GET /api/compliance-constants/key/:key` (history), `GET /api/compliance-constants/:id`, `POST /api/compliance-constants/propose`, `POST /api/compliance-constants/confirm`. Frontend at `/compliance-constants` with filterable table, category badges, qualifier indicators, and Edit workflow. Generation engine uses DB-backed constants via `getConstants()`.
-   **QC Evaluator:** Employs a fixed 19-check checklist for compliance and quality, with chunking for large documents.
-   **Document Usage Matrix:** `api-server/src/data/document-usage-matrix.ts` encodes complex routing rules for document eligibility, exclusion, and weighting.
-   **Matrix Context Auto-Derivation:** `api-server/src/lib/recommendation-context.ts` automatically detects context flags (e.g., `eis_familiar`) from Claude analysis for recommendation filtering.
-   **Branded PDF Export:** Generates branded HTML for print-to-PDF, supporting various templates and using predefined brand constants.
-   **Document Import Pipeline (Phase B):** Bulk MD file import for documents. New DB table `import_sessions` tracking parse/execute lifecycle (PENDING→PARSED→EXECUTING→COMPLETE/PARTIAL/FAILED). Parser service (`importParser.ts`) extracts `IMPORT_BLOCK` sections, validates destination/action, checks prohibited values (22p, 7.8x, 78x, ASA, SAFE, Series A, £99/£249). API routes: `POST /api/import/parse` (multer, .md only, 10MB limit, SHA-256 hash dedupe), `POST /api/import/:session_id/execute` (confirmed: true required, idempotent 409 if COMPLETE), `GET /api/import` (list sessions), `GET /api/import/:session_id`. Execute creates documents via `db.insert(documentsTable)` directly (not via existing routes), writes changelog entries (DOCUMENT_IMPORTED / DOCUMENT_UPDATED_VIA_IMPORT). Update action matches by id, then file_code, then title (ambiguous→FAILED). Frontend at `/import` with 3-step wizard (upload→preview→summary). Sidebar entry in Content group. Does not trigger propagation. Does not modify generationEngine.ts or propagation.ts.
-   **Task Manager (Phase A+B):** Task board for tracking review, build, import, and general tasks. DB table `tasks` with id (UUID text PK), title, status (Open/In Progress/Done), type (Review/Build/Import/General), linked_document_id (nullable, no FK), created_at, updated_at ($onUpdate). API routes: `GET /api/tasks` (list all with left-joined document names), `POST /api/tasks` (create with title validation, type validation), `GET /api/tasks/summary` (open count + 3 oldest non-Done tasks), `PATCH /api/tasks/:id` (update status/title/type with validation), `DELETE /api/tasks/:id`. All mutations write inline changelog entries (TASK_CREATED/TASK_UPDATED/TASK_DELETED). Frontend at `/tasks` with create form, client-side status/type filters, inline status change via select, delete via trash icon. Dashboard (`/`) has independent Tasks summary card (manual fetch, separate useState) showing open count + top 3 oldest tasks. Sidebar entry in Operations group after Lead Management. **Phase B — Propagation-triggered auto-task creation:** `taskHelpers.ts` exports `createReviewTasksForPropagation(targets)` — called from `POST /documents/:id/propagate` after `propagateFromDocument()`. For each flagged document, creates a "Review: [doc name]" task with type Review and status Open, skipping any document that already has an Open or In Progress review task linked to it. Done tasks do NOT prevent new task creation. Changelog entries use `triggered_by: 'propagation'`. Per-target error isolation — one failure does not abort remaining targets. `propagation.ts` logic unchanged.
-   **PDF Import:** Extracts text from uploaded PDFs, stores the PDF, and creates document records.
-   **Video Catalogue:** Manages video metadata, lifecycle status, and integrates videos into the recommendation engine.
-   **Call Transcript Analysis:** Parses `.txt/.docx` transcripts, normalizes speaker labels, and extracts investor names.
-   **Lead Matching:** Implements fuzzy matching for lead identification.

## External Dependencies

-   **AI Integration:** Anthropic Claude (claude-sonnet-4-6)
-   **Google Docs Integration:** Google Drive/Docs API
-   **Database:** PostgreSQL
-   **ORM:** Drizzle ORM
-   **Frontend Framework:** React
-   **Build Tools:** Vite, esbuild
-   **CSS Framework:** Tailwind CSS
-   **UI Components:** shadcn/ui
-   **Validation Library:** Zod
-   **API Client Generation:** Orval
-   **PDF Processing (Import):** pdfjs-dist (legacy build)