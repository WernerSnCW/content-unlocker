# ADR 004 — Website (Lovable/Supabase) Integration

**Status:** Accepted
**Date:** 2026-04-14
**Author:** Werner / Claude Code session

## Context

The Unlock website at `www.unlockdd.com` is built on Lovable Cloud (Supabase) with its own database, auth (custom magic-link), Edge Functions, and Storage. It already implements:

- **Document registry** — 17 documents by slug, with access tiers (open / portal_unlocked / hard_gated)
- **Investor portal** — per-investor `document_permissions` JSONB map (slug → locked/unlocked) and a pipeline `stage` enum
- **Read tracking** — `document_reads` capturing session time and read_seconds per (investor, doc)
- **Access request queue** — `document_access_requests` for pull-based access workflow
- **Admin surface** — pipeline board, permission matrix, request approvals
- **Storage** — private bucket of PDFs

Our app (Replit + Drizzle + Postgres) already implements:

- Contacts pool, call lists, dispatch
- Aircall call handling + intelligence engine
- NBA generation that recommends documents by numeric `doc_id` (e.g. 140 "Access Explainer")

The two systems run on separate databases on separate stacks. They need to integrate so that:

1. Engine NBAs can **unlock recommended documents** for investors on the portal
2. Engine can **transition pipeline stages** based on call outcomes
3. Website can **notify our app** of inbound web leads (visitor requests a document) so they enter our call flow as warm leads
4. Website read/request events can **feed engine evidence** (did they read the doc?)

## Decision

### Three-layer architecture

| Layer | System | Responsibilities |
|---|---|---|
| **Brain** | Our Replit app | Contacts, call flow, transcripts, engine, NBA decisions, single source of truth for call/intelligence state |
| **Content & Engagement** | Website (Lovable/Supabase) | Document storage, serving, per-investor permissions, reading telemetry, stage pipeline, magic-link auth |
| **CRM board (optional)** | Pipedrive (ADR 002 — reduced role) | Visual sales pipeline for Tom. No longer the execution substrate. Does not gate inbound leads. |

### Integration boundary — Edge Functions only

Our app **never** talks to the website's Supabase directly. All communication goes through Edge Functions:

- **`POST /functions/v1/app-to-portal`** — our app → website
  ```
  { investor_id, unlocks?: ["slug1", "slug2"], stage_event?: "pack_1_sent", source_call_id }
  ```
  Updates `document_permissions` and `investor_portal.stage`. Edge Function uses service role internally. Returns `{ success, current_permissions, current_stage }`.

- **`POST /functions/v1/app-lookup-investor`** — our app → website
  Lookup by email/phone to resolve our contact → website investor_id.

- **(Webhook back) `POST /api/web-inbound/lead`** — website → our app
  Fires when:
  - Visitor submits document-request form
  - Magic-link verified (investor logs into portal)
  - Document read milestone hit (e.g. 80% read)

### Authentication

Both directions authenticated via **shared secret** stored in `integration_configs`:
- Website stores our app's webhook-inbound secret
- Our app stores the secret the Edge Functions require
- Plus **HMAC-SHA256 signature** on payload body to prevent replay and tampering
- Request timestamp included; reject if > 5 minutes old

### Inbound web leads — direct to our app, NOT via Pipedrive

Contrary to earlier discussions: Pipedrive is **not** the inbound gatekeeper. Web leads flow directly:

```
Visitor fills form on website → Website Edge Function stores request
  → Website webhook fires POST /api/web-inbound/lead to our app
  → Our app creates contact with source='web', warm_flag=true,
    populated with portal_activity snapshot (docs read, session time)
  → Contact enters our call pool with a "Web Lead" priority tier
  → Engine treats them as warm — different NBA flow (no cold-call script)
```

Rationale:
- The website knows far more than Pipedrive ever will (read time, docs accessed, magic-link identity). Routing through Pipedrive is lossy.
- Direct is faster (no Pipedrive webhook delay).
- One fewer system in the critical path for lead intake.
- Tom's operator UI is our app, not Pipedrive — leads should land where operators look.

### Document mapping — numeric doc_id ↔ website slug

Our engine references documents by `doc_id` (100, 120, 140, 150, 160, 170, 180, 181, 182). The website uses string slugs (`one-pager`, `pack-1`, `access-explainer`, etc.). Bridge with a table in our DB:

```sql
engine_document_mapping (
  engine_doc_id INT PRIMARY KEY,
  website_slug TEXT UNIQUE NOT NULL,
  doc_name TEXT NOT NULL,
  first_seen_at TIMESTAMP,
  last_synced_at TIMESTAMP
)
```

Admin page fetches the website's `documents` table via an Edge Function (`GET /functions/v1/list-documents`) and surfaces unmapped slugs / orphaned doc_ids for Tom to reconcile.

**Seed mapping (today):**

| engine_doc_id | website_slug | doc_name |
|---|---|---|
| 100 | one-pager | One-Pager / Founding Investor Opportunity |
| 120 | pack-1 | Pack 1 — Founding Investor Brief |
| 140 | access-explainer | Access Explainer |
| 150 | eis-guide | EIS: The Investor's Secret Weapon |
| 160 | eis-case-studies | EIS 2026: Five Case Studies |
| 170 | iht-planning | EIS & IHT: A Strategy for the £5M Estate |
| 180 | eis-fee-comparison | EIS: What You Pay and What You Keep |
| 181 | portfolio-stress-test | Five Questions About Your Portfolio |
| 182 | bpr-explainer | BPR & EIS — What the Cap Means for Your Estate |

8 website slugs are not currently engine-referenced (exit-strategy, faq, market-size, platform-whitepaper, private-guide, three-pager, uk-investment-landscape, pack-2). These remain manually-shareable via the admin portal. When a new engine doc_id is added to the config, we add a mapping row.

### Stage alignment — enum-bridge-table pattern

Website stages: `awareness → demo_booked → demo_done → pack1_sent → due_diligence → committed`.

Engine's V3 `PIPELINE_STAGES` config is rewritten to use **logical event names** (not numeric stages, not hardcoded values):

```typescript
pipelineTransition: {
  event: "pack_1_sent",   // logical name in the engine's vocabulary
  reason: "..."
}
```

The adapter layer translates `engine_event → website_stage` via a mapping table in our DB:

```sql
stage_mapping (
  engine_event TEXT PRIMARY KEY,
  website_stage TEXT NOT NULL,
  probability INT,
  updated_at TIMESTAMP
)
```

**Seed:**

| engine_event | website_stage | probability |
|---|---|---|
| awareness | awareness | 0 |
| demo_booked | demo_booked | 20 |
| demo_done | demo_done | 50 |
| pack_1_sent | pack1_sent | 75 |
| due_diligence | due_diligence | 85 |
| committed | committed | 100 |

**Future change workflow:** if the website renames `pack1_sent` to `proposal_sent`, update the mapping table row. Engine code and fixtures are untouched. If a new stage is added (e.g. `signed`), add a new `engine_event` + row + one engine config entry. CONFIG_ONLY change per ADR 003 versioning.

**Principle (generalised):** cross-system enums always bridge via a table, never hardcoded translations. Same pattern should apply to the doc mapping and any future shared enum (call outcomes, roles, etc.).

### Push + pull document access

Both paths land in the same `document_permissions` map:

- **Push** (engine-driven): NBA → `app-to-portal` Edge Function → auto-unlock. Logged in `engine_artifacts_sent`.
- **Pull** (investor-driven): visitor hits locked doc → request → Tom approves via admin → unlock. No change to existing flow.

No conflict because permissions are additive. If engine already unlocked `pack-1`, a subsequent request from the investor for `pack-1` is a no-op.

### Document reading as engine evidence

Website fires `POST /api/web-inbound/lead` with event `doc_read_milestone` when:
- Investor opens a doc for the first time
- Session read_seconds crosses a threshold (e.g. 120s for substantive read)

Our app stores this on the conversation or as a new `engine_evidence` record. Engine can cite it when re-scoring signals (e.g. "read BPR Explainer for 4 minutes" is strong evidence for L2 belief movement).

### Configuration

New entries in `integration_configs` under a `lovable` provider:

```json
{
  "site_url": "https://www.unlockdd.com",
  "edge_function_base": "https://<project-ref>.supabase.co/functions/v1",
  "shared_secret": "...",
  "inbound_webhook_secret": "..."
}
```

### Supabase migration — not happening

We considered migrating our Replit app to Supabase for a single shared database. Rejected because:
- Our app has substantial Drizzle/node-postgres infrastructure already working
- Supabase migration would take 1-2 weeks and provides nothing we need that the Edge Function boundary doesn't already give us
- Two specialised systems with a clean API boundary is simpler to reason about than one shared schema with two apps both writing

## Rationale

- **Bounded integration surface.** Edge Functions are the only touchpoint. Schema changes on either side don't cascade.
- **Website owns content, our app owns intelligence.** Each system does what it's best at.
- **Enum-bridge tables over hardcoded translations.** Future renames are config-only edits.
- **Direct web → our app for inbound.** Pipedrive adds latency and loses portal-activity richness; it shouldn't be in this path.
- **Pipedrive downgraded to optional CRM view.** If Tom wants a visual pipeline board, he gets it. If not, it isn't a dependency. See ADR 002 amendment.

## Consequences

### Build artefacts (Phase 7.5)

- New `lovableAdapter.ts` module with narrow methods: `unlockDocuments(investorId, slugs)`, `setStage(investorId, event)`, `lookupInvestor(email)`.
- New table `engine_document_mapping` + admin UI for mapping slugs to doc_ids.
- New table `stage_mapping` + admin UI for stage bridge.
- Inbound webhook `/api/web-inbound/lead` + HMAC verification middleware.
- Shared-secret config in `integration_configs` under `lovable` provider.
- EngineOutput (V3) adds optional `stage_event`, `unlock_slugs` fields (populated by adapter, not engine — engine emits logical names, adapter resolves).
- Website-side Edge Functions (written by website team, not us): `app-to-portal`, `app-lookup-investor`, `list-documents`, outbound webhook sender.

### Ongoing responsibilities

- **We own:** call flow, engine, decisions about what to unlock and when.
- **Website owns:** content, reading UX, permissions storage, magic-link auth, admin portal UX.
- **Stage + doc mapping:** owned by our app, but reviewed whenever either side changes an enum.
- **Version skew:** each side can deploy independently. If website adds a stage, admin adds a row in `stage_mapping` before the engine config is extended to emit the new event.

### Go-live checklist

- Both sides agree on the `lovable` provider config structure
- Shared secret generated and stored on both sides (never logged)
- Document mapping table seeded with the 9 initial doc_ids
- Stage mapping table seeded with 6 stages
- Inbound webhook tested end-to-end (website form → our app contact appears as web lead)
- Push flow tested end-to-end (engine NBA → portal unlock visible to investor)
- Read-milestone webhook tested (investor reads doc → evidence lands in our app)

## Supersedes

- Earlier plan to use Pipedrive as execution substrate — **partially supersedes ADR 002** (see amendment in that file).
- No prior ADR on website integration.
