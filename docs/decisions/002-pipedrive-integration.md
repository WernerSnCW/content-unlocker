# ADR 002 — Pipedrive Integration as Execution Substrate

**Status:** Accepted
**Date:** 2026-04-14
**Author:** Werner / Claude Code session

## Context

The architecture note (v6) commits the app to pushing qualified leads to Pipedrive. But Pipedrive's role wasn't formally scoped beyond that — the question of *what Pipedrive does for us day-to-day* was unresolved.

Our app already covers:
- Contact ingestion, pool and call-list management
- Aircall dialling + call outcome capture
- Transcript capture + intelligence engine + next-best-action (NBA) decisions

What our app does *not* cover and does not want to build:
- Email sending infrastructure (mailbox auth, deliverability, open/click tracking)
- A visual deal pipeline board
- Multi-user activity timeline
- Third-party integrations (e-sign, accounting, proposal tools)

## Decision

Pipedrive is the **execution substrate**. Our app is the **brain** and the **only UI the operator uses during calling**.

### Role split

| Responsibility | Owner |
|---|---|
| Contact pool, call lists, dispatch, queue | App |
| Calling, transcripts, tag outcomes | App + Aircall |
| Belief/signal engine, NBA decisions | App |
| Deal pipeline board (visual) | Pipedrive |
| Email sending + open/click tracking | Pipedrive (via Tom's connected mailbox) |
| Activity timeline + notes | Pipedrive |
| Multi-user visibility | Pipedrive |
| **Source of truth** | App (Pipedrive mirrors, never authoritative) |

### Deliberate duplication in Pipedrive

Custom fields on the Pipedrive person/deal, mirrored from our DB:

- `unlock_persona` (Preserver / Growth Seeker / Legacy Builder / Undetermined)
- `unlock_hot_button` (family / freedom / legacy / relief / significance)
- `unlock_engine_signals_summary` (short text; e.g. "C1:green, C4:amber, S2:amber")
- `unlock_last_call_outcome`
- `unlock_demo_score`
- `unlock_contact_url` — link back to our app

Tom gets context inside Pipedrive without switching apps. Our DB wins on conflicts.

### Document storage — Pattern A

Canonical documents (Access Explainer, Pack 1, IHT Guide, etc.) are uploaded once into Pipedrive Files. Our DB maintains a lookup:

| our doc_id | doc_name | pipedrive_file_id |
|---|---|---|
| 100 | One-Pager | 123456 |
| 140 | Access Explainer | 123457 |
| 170 | IHT Planning | 123458 |

When the engine recommends `docId: 140`, the integration attaches `pipedrive_file_id: 123457` to the Pipedrive email.

### Send flow — must be headless

**CRITICAL:** Operator never navigates to Pipedrive during the calling workflow. When [Preview & Send] is clicked in our app's Outcome Drawer:

1. Our app finds/creates the Pipedrive person + deal
2. Our app calls Pipedrive's API to send the email directly from Tom's connected mailbox, with:
   - Cover note as body
   - Doc attached from Pipedrive Files
3. Our app creates a Pipedrive Activity marked as completed, referencing the engine_run
4. Our app logs the send in `engine_artifacts_sent`
5. Toast confirms; operator returns to calling queue

Recipient sees the email as coming from Tom's real mailbox, not a system address. Full Pipedrive email tracking applies.

### Preview step while calibrating

Early iterations of the drawer show the final email draft (subject, body, attachment filename) inline with [Send] and [Cancel]. Once the engine's cover-note drafting is trusted, this can become fire-and-forget.

### NBA → Pipedrive action mapping

| Engine NBA `actionType` | Pipedrive Action |
|---|---|
| `send_content` | Send email (headless) + create completed Activity |
| `schedule_call` | Create Activity "Call [date]" |
| `schedule_adviser_call` | Create Activity "Three-way with adviser" |
| `reserve_stock` | Update deal stage + create Activity "SeedLegals initiation" |
| `escalate_to_tom` | Assign deal to Tom |
| `move_to_nurture` | Move deal to nurture pipeline/stage |
| `close_deal` | Mark won/lost with reason |
| `initiate_seedlegals` | Create Activity + move stage |

### Feedback loop

Pipedrive webhooks feed back into our engine as evidence:

- `email.opened` / `email.replied` → engine_runs can cite these as evidence when re-scoring signals
- `activity.completed` → updates NBA status
- `deal.stage_changed` → triggers belief re-scoring (e.g. a manual stage move may imply signals changed)

## Rationale

- **Leverage rather than duplicate.** Pipedrive's email infrastructure, deal board, and multi-user surface would take months to build ourselves and be mediocre.
- **Keep the operator in one UI.** The headless-send requirement is non-negotiable; the workflow breaks if the operator has to tab-switch mid-call.
- **One-way authoritative sync.** Data flows from app → Pipedrive for state; from Pipedrive → app only for evidence events. No merge conflicts.
- **Deferred build.** Pipedrive integration is Phase 8 — after the engine + UI is proven. Building it earlier risks iterating integration semantics against a moving engine spec.

## Consequences

- A Pipedrive adapter service module (`pipedriveAdapter.ts` or similar) with narrow methods: `findOrCreatePerson`, `findOrCreateDeal`, `updateStage`, `sendEmail`, `createActivity`, `logEmail`.
- Webhook handlers for Pipedrive events (email open/reply, activity complete, stage change).
- A small document registry table linking our `doc_id` to `pipedrive_file_id`, updated when docs are re-uploaded.
- Credentials (API token, company domain) stored in `integration_configs` under a new `pipedrive` provider entry.
- Pipedrive mailbox must be connected by Tom as a one-time setup — we surface a clear error in the drawer if it's disconnected rather than failing silently.
- Rate limits and email quotas must be verified against Tom's plan before go-live.
- Cost: every Activity / Deal uses quota on Tom's Pipedrive plan; the integration should batch where possible.

## Supersedes

None. First ADR for Pipedrive scope.
