# ADR 003 — Intelligence Engine Phase Plan

**Status:** Accepted
**Date:** 2026-04-14
**Author:** Werner / Claude Code session

## Context

The V2 intelligence engine (spec `402_SPEC_Intelligence_Engine_V2_CURRENT.md`) is a large piece of work: new config-driven rules, new DB schema, new UI surface, and replacement of the existing `beliefAnalysisService` / `intelligenceService` / `analysisPipeline`. Landing it in one step would be high-risk and hard to review.

We need a phase plan that keeps the app functional at every step and lets the engine be validated against real transcripts before the UI depends on it.

## Decision

Ship the engine in 8 phases. Phases 1–3 are already shipped (see commit log around 2026-04-14).

### Shipped

**Phase 1 — Engine core.** Pure module at `artifacts/api-server/src/engine/v2/` — config (Part A), types (Part B), 10 functions (Part C), test fixtures (Part D), version (Part E). No DB, no API, no UI. 16 fixtures passing.

**Phase 2 — Persistence.** Five new tables (`engine_investor_state`, `engine_signals`, `engine_signal_transitions`, `engine_runs`, `engine_artifacts_sent`) and `engine_version` column on `lead_conversations`. Persistence service (`loadInvestor`, `saveEngineRun`, read helpers).

**Phase 3 — Transcript wiring.** `handleTranscriptionCreated` now runs the engine after storing a transcript. Inspection endpoints: `GET /engine/version`, `GET /engine/contact/:id`, `GET /engine/runs/:id`, `POST /engine/reprocess`.

### Remaining

**Pre-Phase 4 — Pool management hygiene.** Must land before the Outcome Drawer so it shows coherent data. See [ADR 001](./001-tag-outcome-side-effect-model.md) for the full spec: tag → outcome → side-effect canonical model, allowed-combinations matrix, `immediate_recall` mechanics, configurable `max_call_attempts`, and the critical universal `callback_date` filter fix.

**Phase 4 — Post-call Outcome Drawer.** Right-side slide-out on Call Command. Polls `/api/engine/contact/:id` after `call.ended` until the engine run lands (up to ~2 min). Contents:
- Persona + confidence badge, hot-button chip
- Signal changes (before → after)
- NBA card with document + cover note preview + [Send] / [Skip] buttons
- Gate status, flags
- Link to full transcript

[Send] is headless via Pipedrive (see [ADR 002](./002-pipedrive-integration.md)). Early iterations show a preview before firing.

**Phase 5 — Pre-call Intelligence Panel.** Replaces the empty Call Prep card on Call Command for the currently-loaded contact. Persona, hot button, profile summary, prior-call count, last outcome. Shows accumulated context. For fresh contacts, shows "no prior intelligence yet".

**Phase 6 — V1 migration + retirement.** Map existing `lead_beliefs` state enum (ESTABLISHED / PARTIAL / ABSENT / UNKNOWN / BLOCKED) to V2 states (green / amber / red / grey / red). Copy into `engine_signals`. Deprecate and remove `beliefAnalysisService`, `intelligenceService`, `analysisPipeline`. Remove or rebuild the old Beliefs tab on `lead-detail.tsx`.

**Phase 7 — Engine update mechanism.** Admin surface for future V3/V4 spec drops to be mechanical. Version check endpoint already exists (`GET /api/engine/version`). Add admin page listing current signals / gates / routing with last-updated timestamps. Document the CONFIG_ONLY / ADDITIVE / BREAKING update workflow.

**Phase 8 — Pipedrive integration.** Full execution substrate per [ADR 002](./002-pipedrive-integration.md). Adapter service, webhook handlers, document registry, credentials in `integration_configs`.

## Rationale

- **Phased delivery keeps each piece testable.** Every phase is reviewable and deployable in isolation.
- **Pool management before UI.** The Outcome Drawer's recommendations depend on contact eligibility being correct — otherwise it'll show stale or misleading data.
- **Pipedrive last.** The engine must be producing good recommendations before we wire the execution layer. Otherwise we're shipping a decision-loop that automates bad decisions.
- **V1 retirement in Phase 6, not before.** Keep the old code functional until V2 has run against real calls for long enough to build confidence.

## Consequences

- Don't start Phase 4 before the pool management work lands.
- Phase 6 needs a migration script + test plan before flipping the UI.
- Phase 8's integration scope is self-contained — the preceding phases don't depend on Pipedrive being in place.

## Supersedes

None.
