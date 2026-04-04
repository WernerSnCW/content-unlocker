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
4.  **Content Generation & QC (`/generate`):** Utilizes two distinct Claude API calls for generation and evaluation, with a maximum of two regeneration attempts before manual review is required. Documents always start as DRAFT.
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
-   **Approved Content Units (ACU):** Compliance-critical content atoms (facts, framings, references, qualifiers, prohibited items). 22 ACUs seeded (21 LOCKED, 1 NAMING_PENDING). API at `/api/acu` (9 endpoints: list, prohibited, injectable, get, create, approve, lock, version, cascade). Frontend at `/acu`. Integrated into QC engine (prohibited halt, locked-absent check) and generation prompt (injects LOCKED content verbatim, excludes PROHIBITED). OpenAPI spec + codegen complete.
-   **Campaign Intelligence Platform:** Multi-channel investor campaign planning, generation, QC, and activation from a single brief. DB tables: `campaigns`, `campaign_assets`, `channels`. 11 API endpoints at `/api/campaigns` (list, create, detail, assets, generate, QC, activate, sequence, AC build, tag table) plus `/api/channels`. Campaign generator builds directed-graph sequences (cold outreach 10-node, warm nurture 7-node, ad 5-node templates). Campaign QC layer runs CHANNEL_COMPLIANCE, SEQUENCE_INTEGRITY, and ACU_PROHIBITED checks. Frontend at `/campaigns` (list + detail with tabs: Assets, Sequence Map, ActiveCampaign Build, Aircall Tags). 10 channels seeded (email_cold, email_warm, email_nurture, whatsapp, linkedin_message, meta_ad, linkedin_ad, display_ad, call_script, voicemail). OpenAPI spec + codegen complete.
-   **QC Evaluator:** Employs a fixed 19-check checklist for compliance and quality, with chunking for large documents.
-   **Document Usage Matrix:** `api-server/src/data/document-usage-matrix.ts` encodes complex routing rules for document eligibility, exclusion, and weighting.
-   **Matrix Context Auto-Derivation:** `api-server/src/lib/recommendation-context.ts` automatically detects context flags (e.g., `eis_familiar`) from Claude analysis for recommendation filtering.
-   **Branded PDF Export:** Generates branded HTML for print-to-PDF, supporting various templates and using predefined brand constants.
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