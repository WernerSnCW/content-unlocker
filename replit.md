# Unlock Content Intelligence Platform

## Overview

Full-stack internal intelligence tool for Unlock, a UK fintech portfolio intelligence platform. Built for managing 30,000-contact investor database with AI-powered recommendation engine, document management, and content generation.

pnpm workspace monorepo using TypeScript. Each package manages its own dependencies.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Frontend**: React + Vite + Tailwind CSS + shadcn/ui
- **AI Integration**: Anthropic Claude (claude-sonnet-4-6) via Replit AI Integrations proxy
- **Google Docs**: Google Drive/Docs API via Replit Connectors SDK (OAuth managed by Replit)
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (ESM bundle for API), Vite (frontend)

## Product Architecture

### Four Core Layers

1. **Recommendation Engine** (`/recommend`): Paste call transcript → AI persona/stage detection with confidence scores → deterministic eligibility filtering → Claude-ranked document recommendations → email draft generation → immutable send log
2. **Lead History** (`/leads`, `/leads/:id`): Lead management with pipeline stages, detected personas, chronological send timelines, next-best-action suggestions
3. **Content Management** (`/registry`, `/registry/:id`, `/content-bank`, `/changelog`): 17-document registry with tier-based dependency chains, compliance constants panel, propagation alerts (Tier 1 cascades 2 levels), audit changelog
4. **Content Generation & QC** (`/generate`): Two separate Claude API calls — generator + evaluator with max 2 regeneration attempts, then MANUAL_REVIEW_REQUIRED. Documents always start as DRAFT.
5. **Content Gap Analysis** (`/gaps`): Detects missing content via 3 signals — coverage matrix (archetype×stage), required doc types, recommendation engine failures. Generates AI briefs and feeds into generation pipeline.
6. **Feature Update Cascade** (`/feature-updates`): Submit product changes → detect affected documents via 4 methods (Tier 1 propagation, semantic match, type match, compliance match) → flag REQUIRES_REVIEW → prioritised review queue.

### Key Business Rules

- **Persona mapping**: AI detects 19 detailed personas; documents tagged with 3 archetypes. `lib/personas.ts` maps all 19 → archetypes. Unknown personas skip persona filter (return all stage-eligible docs) with warning log.
- **Confidence thresholds**: >=0.80 auto-proceed (green), 0.60-0.79 "please review" (amber), <0.60 must explicitly confirm (red)
- **REQUIRES_REVIEW documents**: NEVER appear in recommendations
- **Google Docs sync**: Export document to Google Docs, edit in Docs, pull changes back. Uses `@replit/connectors-sdk` proxy with `google-drive` connector. DB fields `gdoc_id`/`gdoc_url` track link.
- **Immutable send logs**: Corrections via appended audit entry, originals remain
- **Propagation cascade**: Tier 1 update flags Tier 2 + Tier 3 dependents; Tier 2 flags Tier 3 only
- **QC evaluator**: Separate API call, separate system prompt, never shares context with generator
- **Terminology**: "Founding investor" (not shareholder), "Instant Investment" (not ASA), "EIS/SEIS relief"

## Structure

```text
artifacts-monorepo/
├── artifacts/
│   ├── api-server/              # Express API server (port 8080)
│   │   ├── src/routes/
│   │   │   ├── leads/           # CRUD + next-action
│   │   │   ├── documents/       # Registry + propagation
│   │   │   ├── recommendation/  # Analyze/rank/confirm-send/email-draft
│   │   │   ├── generation/      # Generate/regenerate/promote with QC
│   │   │   ├── content/         # Content bank + personas + gaps + feature-update
│   │   │   └── dashboard/       # Summary + activity + changelog + compliance
│   │   └── src/data/            # Seed data (registry.json, leads.json, compliance_constants.json)
│   ├── unlock-intel/            # React Vite frontend (port 22068)
│   │   └── src/pages/           # Dashboard, Recommend, Leads, Registry, ContentBank, Changelog, Generate
│   └── mockup-sandbox/          # Design preview server
├── lib/
│   ├── api-spec/                # OpenAPI spec + Orval config
│   ├── api-client-react/        # Generated React Query hooks
│   ├── api-zod/                 # Generated Zod schemas
│   ├── db/                      # Drizzle ORM (leads, documents, changelog tables)
│   └── integrations-anthropic-ai/ # Anthropic client via Replit proxy
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── tsconfig.json
└── package.json
```

## Database Schema

- **leads**: id, name, company, pipeline_stage, first_contact, last_contact, detected_persona, archived, send_log (JSONB), stage_history (JSONB), notes (JSONB)
- **documents**: id, file_code, type, name, filename, tier (1-3), category, lifecycle_status, review_state, version, description, pipeline_stage_relevance (JSONB), persona_relevance (JSONB), upstream_dependencies (JSONB), downstream_dependents (JSONB), is_generated, content, qc_history (JSONB)
- **changelog**: id, timestamp, action, document_id, lead_id, details, triggered_by

## TypeScript & Composite Projects

Every package extends `tsconfig.base.json` which sets `composite: true`. The root `tsconfig.json` lists all packages as project references.

- **Always typecheck from the root** — run `pnpm run typecheck`
- **Project references** — when package A depends on package B, A's `tsconfig.json` must list B in its `references` array

## Key Scripts

- `pnpm run build` — runs typecheck then builds all packages
- `pnpm run typecheck` — runs `tsc --build --emitDeclarationOnly`
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas
- `pnpm --filter @workspace/db run push` — push schema changes to DB
- `pnpm --filter @workspace/api-server run dev` — run API server
- `pnpm --filter @workspace/unlock-intel run dev` — run frontend

## Packages

### `artifacts/api-server` (`@workspace/api-server`)

Express 5 API server. Routes in `src/routes/`. Uses `@workspace/api-zod` for validation, `@workspace/db` for persistence, `@workspace/integrations-anthropic-ai` for AI calls.

- Entry: `src/index.ts` — reads PORT, seeds DB, starts Express
- Routes mounted at `/api`
- Seed data in `src/data/` (registry.json, leads.json, compliance_constants.json, content bank, email templates, persona guide)
- Text files (.md, .txt) imported via esbuild text loader

### `artifacts/unlock-intel` (`@workspace/unlock-intel`)

React + Vite frontend. Uses generated React Query hooks from `@workspace/api-client-react`.

- 11 pages: Dashboard, Recommend, Leads, LeadDetail, Registry, DocumentDetail, ContentBank, Changelog, Generate, GapAnalysis, FeatureUpdates
- Routing: wouter with base path from `import.meta.env.BASE_URL`
- Design: Dark navy sidebar, institutional styling, status color system

### `lib/db` (`@workspace/db`)

Drizzle ORM with PostgreSQL. Three tables: leads, documents, changelog.

### `lib/api-spec` (`@workspace/api-spec`)

OpenAPI 3.1 spec covering all endpoints. Codegen produces React Query hooks and Zod schemas.

### `lib/integrations-anthropic-ai` (`@workspace/integrations-anthropic-ai`)

Anthropic client configured via Replit AI Integrations proxy. No API key needed.

## Seed Data

- 17 documents in registry.json covering investor packs, case studies, briefs, email templates, persona guides
- 3 sample leads at different pipeline stages
- Compliance constants (BPR cap, VCT relief rate, pension IHT changes, EIS/SEIS rates, loss relief, annual limits, etc.)
- Coverage matrix config (`lib/coverage-matrix.ts`): 18 archetype×stage cells + 6 required doc types + 7 compliance field expectations
- Content bank markdown with messaging and positioning
- 19 investor personas with signals, pain points, objections
