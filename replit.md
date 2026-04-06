# Unlock Content Intelligence Platform

## Overview

Unlock is a UK fintech platform designed to enhance investor relations through an AI-powered internal intelligence tool. It manages a large investor database, offering AI-driven recommendations, streamlined document management, and intelligent content generation. The platform aims to improve content relevance, ensure compliance, and automate key aspects of investor communication and lead management. Key capabilities include an AI-driven recommendation engine, comprehensive lead management, a robust content management system with compliance oversight, intelligent content generation and quality control, content gap analysis, and a feature update cascade system for document reviews.

## User Preferences

I prefer iterative development, with a focus on delivering functional components that can be reviewed and refined.
I value clear and concise communication, avoiding overly technical jargon where simpler language suffices.
Before making any major architectural changes or introducing new dependencies, please ask for approval.
I expect detailed explanations for complex solutions or decisions.
Do not make changes to files in the `lib/` directory without explicit instruction, as these are shared libraries.
Please ensure all new code adheres to TypeScript best practices and includes appropriate type definitions.

## System Architecture

The project is built as a pnpm workspace monorepo using TypeScript, designed with distinct layers for core functionalities.

**Core Layers:**
-   **Recommendation Engine:** Processes call transcripts, applies deterministic eligibility, ranks documents using AI, generates email drafts, and logs interactions.
-   **Lead History:** Manages leads through pipeline stages, tracks personas, timelines, and suggests next-best-actions.
-   **Content Management:** Oversees a registry of 17 key documents with tier-based dependency chains, compliance constants, propagation alerts, and an audit changelog.
-   **Content Generation & QC:** Supports generation from templates or custom input, includes compliance checks, regeneration capabilities, and a DRAFT to CURRENT workflow.
-   **Content Gap Analysis:** Identifies content deficiencies based on coverage matrices and recommendation engine failures, generating AI briefs for new content.
-   **Feature Update Cascade:** Automatically detects and flags documents affected by product changes for review, prioritizing them in a review queue.
-   **Approved Content Units (ACU):** Manages compliance-critical content atoms, integrated into QC and generation processes. Includes an intelligence layer for content scanning and contradiction detection.
-   **Template and Prompt Registries:** Centralized management of output templates and system prompts for content generation and AI interactions.
-   **Campaign Intelligence Platform:** Facilitates multi-channel investor campaign planning, generation, QC, and activation from a single brief.
-   **Compliance Constants Governance:** Manages compliance constants with a two-step proposal-confirmation workflow, ensuring data integrity and flagging affected documents.
-   **Document Import Pipeline:** Enables bulk import of documents, tracking sessions and creating/updating records with validation.
-   **Task Manager:** Provides a task board for tracking various project tasks (review, build, import, general), with propagation-triggered auto-task creation.
-   **Google Sheets Transcript Sync:** Synchronizes leads and call transcripts from Google Sheets, including fuzzy matching for lead identification.
-   **Investor Intelligence & Belief State System:** Establishes a database foundation for tracking investor belief states, integrating these into the recommendation engine for belief-aware document targeting and gating.

**Technical Implementations and Design Choices:**
-   **Monorepo:** pnpm workspaces for managing multiple packages.
-   **API:** Express 5 framework (`api-server`) handling various functionalities.
-   **Database:** PostgreSQL with Drizzle ORM (`lib/db`).
-   **Frontend:** React, Vite, Tailwind CSS, and shadcn/ui, featuring an institutional dark navy design with a status color system.
-   **UI/UX:** 14 distinct pages for various platform functionalities (Dashboard, Recommend, Leads, Registry, ContentBank, Generate, GapAnalysis, FeatureUpdates).
-   **AI Integration:** Anthropic Claude (claude-sonnet-4-6) via Replit AI Integrations proxy for core AI functions.
-   **Google Docs Integration:** Utilizes Google Drive/Docs API via Replit Connectors SDK for document syncing.
-   **Validation:** Zod and `drizzle-zod` for schema validation.
-   **API Codegen:** Orval generates API client hooks and Zod schemas from an OpenAPI specification.
-   **Build System:** esbuild for API bundles and Vite for frontend.
-   **QC Evaluator:** Employs a fixed 19-check checklist for compliance and quality control.
-   **Document Usage Matrix:** Encodes complex routing rules for document eligibility and weighting.
-   **Matrix Context Auto-Derivation:** Automatically detects context flags from AI analysis for recommendation filtering.
-   **Branded PDF Export:** Generates print-ready branded HTML from various templates.
-   **PDF Import:** Extracts text from PDFs for document records.
-   **Call Transcript Analysis:** Parses transcripts, normalizes speaker labels, and extracts investor names.

## External Dependencies

-   **AI Integration:** Anthropic Claude
-   **Google Docs Integration:** Google Drive/Docs API
-   **Database:** PostgreSQL
-   **ORM:** Drizzle ORM
-   **Frontend Framework:** React
-   **Build Tools:** Vite, esbuild
-   **CSS Framework:** Tailwind CSS
-   **UI Components:** shadcn/ui
-   **Validation Library:** Zod
-   **API Client Generation:** Orval
-   **PDF Processing (Import):** pdfjs-dist

## Recent Changes

-   **Phase 010c (Recommendation Engine Integration):** `POST /recommendation/rank` extended with belief-aware behaviours when `lead_id` provided: hard gate exclusions (120/130 docs gated behind F0), intelligence-derived matrix flags (eis_familiar from already_done_eis, adviser_mentioned from ifa_involved), belief context on ranked output (belief_targeted, current_state, state_after_send, gate_it_unlocks), gate_summary and u4_advisory in response. Backward compatible when no lead_id.
-   **Phase 010d (Frontend):** Lead detail page restructured with Shadcn Tabs: "Overview" (existing content preserved) and "Intelligence & Beliefs" (new). API_BASE fixed to BASE_URL pattern. Intelligence tab has 4 panels: Operator Notes (auto-save on blur), Investor Profile (qualification/cluster/readiness pills), Belief Map (23 dots from registry merge, grouped by cluster, coloured by state, hard gate Lock icons, inline Shadcn Select state picker), Next Step (4 gate rows + next belief display). All data fetched via manual fetch() on tab switch.
-   **Phase 011a (Work Queue Schema):** Two new tables: `work_queue_sessions` (PENDING/ANALYSING/READY/COMPLETE/FAILED lifecycle, progress counters) and `work_queue_findings` (session_id FK, task_id/document_id no FK, finding_type auto_fix/decision_card, status PENDING/AUTO_FIXED/ACCEPTED/SKIPPED/FAILED). GET /work-queue/status endpoint returns active session.
-   **Phase 011b (Analysis Engine):** POST /work-queue/start creates session, fetches open Review tasks + linked CURRENT/REQUIRES_REVIEW documents, fetches compliance constants, runs Claude analysis per document sequentially via setImmediate background. Findings classified as auto_fix or decision_card and persisted. Session transitions ANALYSING→READY on completion.
-   **Phase 011c (Resolution API):** 5 new endpoints: GET /work-queue/cards (pending decision cards), POST /work-queue/auto-fix (applies all auto_fix findings with text replacement + propagation), POST /work-queue/cards/:findingId/accept (applies single card fix + propagation), POST /work-queue/cards/:findingId/skip (skips with reason), GET /work-queue/summary (session counts). Session auto-completes when all findings resolved.