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

### Aircall's native Pipedrive integration — MUST be disabled

Aircall's native Pipedrive integration logs **every** call as a Pipedrive Activity (no per-call or per-tag filter). It also auto-creates Persons for unknown phone numbers. If enabled alongside our custom adapter, every cold call would flow into Pipedrive as prospecting noise AND we would create duplicate Activity records from our side.

**Setup task when we enable Phase 8:** turn off all Pipedrive call-logging in the Aircall dashboard (Integrations → Pipedrive → disable). Document this as a go-live checklist item. Verify post-deploy by checking that no Activities appear in Pipedrive for test calls until our adapter fires.

### Sync direction — per-field policy

Default direction is one-way push from us (we are authoritative). A small number of fields are one-way the other way because Pipedrive is the place where those values are actually managed (Tom edits them there). Explicit policy:

| Field / entity | Direction | Notes |
|---|---|---|
| Person name / email / phone | Us → Pipedrive | On dispatch and on update |
| Custom fields (`unlock_persona`, `unlock_hot_button`, `unlock_engine_signals_summary`, `unlock_demo_score`, `unlock_last_call_outcome`) | Us → Pipedrive | Re-synced after every engine run |
| Deal existence (create) | Us → Pipedrive | Triggered by qualifying outcome or NBA |
| Deal **stage** | Pipedrive → us | Once a Deal exists, Tom drives the stage. We ingest on `deal.stage_changed` webhook and use it as engine evidence. |
| Deal value | Pipedrive → us | Tom sets when known |
| Activity creation | Us → Pipedrive | From NBA |
| Activity completed | Pipedrive → us | Triggers downstream logic |
| Email send | Us → Pipedrive (write only) | Uses Pipedrive's mailbox API |
| Email opened / replied | Pipedrive → us | Feeds engine evidence |
| Deal won/lost | Either direction | Whichever side detects first; idempotent |

Pipedrive manual edits to our custom fields are **ignored** — our next engine run will overwrite. If a field ever needs to be bidirectional, that's a deliberate ADR change.

### Idempotency — store Pipedrive IDs on our side

Every outbound push must be idempotent. We store the Pipedrive record ID against our local record:

- `contacts.pipedrive_person_id` (column exists; currently never written)
- `contacts.pipedrive_deal_id` (column exists)
- `engine_artifacts_sent.pipedrive_activity_id` (to add in Phase 8)
- `lead_conversations.pipedrive_activity_id` (to add — for call-log mirror if we want one)

Retries, duplicate webhook deliveries, or parallel webhook handlers must all converge on the same Pipedrive record via these IDs.

### Inbound webhook handling — dead-letter queue

Pipedrive webhooks arrive via HTTPS. Requirements:

1. **Signature verification** on every inbound request. Reject unsigned or mis-signed payloads.
2. **Persist first, process second** — store the raw payload in a `pipedrive_webhook_events` table (`status: pending | processing | done | failed`, `attempts`, `last_error`) before any business logic.
3. **Retry with backoff** on failure: 1 min, 5 min, 15 min, 1 hr, give up after 5 attempts. Failed events stay queryable.
4. **Idempotent processing** — every handler handles repeat events without side effects.

### Rate limiting + backoff

Pipedrive has per-token rate limits (typically 100 req/10s, check current plan docs). The adapter wraps every API call with:

- **Token-bucket limiter** shared across all callers
- **Exponential backoff on 429** (1s, 2s, 4s, 8s, fail)
- **5xx retry** with jitter

Background jobs (e.g. bulk custom-field resync) run at a lower priority than user-facing actions.

### Audit log

Every outbound push writes one row to `pipedrive_audit_log`:

```
{ id, timestamp, local_entity_type, local_entity_id, action, pipedrive_object, pipedrive_id, request_body_hash, success, error_message, duration_ms }
```

Retained 90 days minimum. Indispensable for troubleshooting integration issues without live Pipedrive access.

## Rationale

- **Leverage rather than duplicate.** Pipedrive's email infrastructure, deal board, and multi-user surface would take months to build ourselves and be mediocre.
- **Keep the operator in one UI.** The headless-send requirement is non-negotiable; the workflow breaks if the operator has to tab-switch mid-call.
- **Explicit sync ownership per field.** Default one-way app → Pipedrive for state we author; selective one-way Pipedrive → app for state Tom manages (deal stage, deal value, activity completion, email tracking). No ambiguous bidirectional fields unless an ADR explicitly opens one.
- **Disable Aircall's native integration.** It syncs every call with no filtering, incompatible with our "only qualified data in Pipedrive" principle, and would cause duplicate Activity records alongside our adapter.
- **Deferred build.** Pipedrive integration is Phase 8 — after the engine + UI is proven. Building it earlier risks iterating integration semantics against a moving engine spec.

## Consequences

### Build artefacts (Phase 8)

- `pipedriveAdapter.ts` service module with narrow methods: `findOrCreatePerson`, `findOrCreateDeal`, `updateDealStage`, `sendEmail`, `createActivity`, `upsertCustomFields`, `closeDeal`, `logNote`. Everything else in the codebase calls these.
- Document registry table linking our `doc_id` to `pipedrive_file_id`.
- New `pipedrive_webhook_events` table — payload-first dead-letter queue for inbound webhooks.
- New `pipedrive_audit_log` table — records every outbound API call.
- Credentials (API token, company domain, webhook secret) stored in `integration_configs` under a new `pipedrive` provider entry.
- Token-bucket rate limiter shared across all callers.
- Retry worker that drains the webhook dead-letter queue.
- Columns to add: `engine_artifacts_sent.pipedrive_activity_id`, `lead_conversations.pipedrive_activity_id` (if we mirror call logs).

### Go-live checklist

- **Disable Aircall's native Pipedrive integration** in Aircall's dashboard (Integrations → Pipedrive → off). Verify post-deploy that no Activities appear in Pipedrive for test calls until our adapter fires.
- Confirm Tom has connected his mailbox in Pipedrive; surface a clear "mailbox disconnected" error in the Outcome Drawer if not.
- Verify Pipedrive plan's API rate limits and email send quota; ensure the limiter's defaults stay inside them.
- Audit Pipedrive's Activity/Deal quota cost to ensure we stay within the plan.
- Verify webhook signature verification end-to-end with a known-good and known-bad payload.

### Ongoing responsibilities

- **All Pipedrive state maintained by our adapter.** Manual edits to our custom fields in Pipedrive are ignored — next engine run overwrites.
- Schema evolution is bidirectional: if a new custom field is added in Pipedrive dashboard, we must decide whether to consume it and update the sync-direction table.
- Every new feature that writes to Pipedrive must also add an audit-log entry and adhere to idempotency via stored Pipedrive IDs.

## Supersedes

None. First ADR for Pipedrive scope.
