# ADR 001 — Tag → Outcome → Side-Effect Model

**Status:** Accepted
**Date:** 2026-04-14
**Author:** Werner / Claude Code session

## Context

The Aircall webhook stores a free-form JSON `tag_mapping` in `integration_configs`. Any combination of `{aircall_tag, outcome, side_effect}` is accepted; the webhook handler only understands a handful of `side_effect` strings (`cool_off`, `callback`) and silently ignores anything else. This produces:

- Silent failures when operators map tags to side-effects that have no handler
- No way to express "never call again" cleanly — `no-interest` only has a soft exclusion
- Inconsistent semantics across outcomes — some outcomes have default side-effects, some don't
- Hardcoded `MAX_CALL_ATTEMPTS = 3` rather than a configurable value
- A latent bug: the `interested` bucket in `fillQueue` has no date filter, so interested contacts are re-dispatched every single day until something else happens

## Decision

Adopt a three-layer model with validated combinations:

### Layer 1 — Canonical outcomes

Finite enum. Adding a new outcome requires code change.

| Outcome | Meaning | Terminal? |
|---|---|---|
| `interested` | Moving forward; engine NBA drives next step | No |
| `no-interest` | Not for this campaign, may fit others | No (campaign-local) |
| `no-answer` | Didn't pick up | No |
| `callback-requested` | They asked to be called back later | No |
| `meeting-booked` | Demo/meeting scheduled | No |
| `hung-up` | Answered and ended early | No |
| `do-not-call` | Explicit DNC request | **Yes** |
| `does-not-exist` | Wrong/dead number | **Yes** |

Dropped from the V1 model: `not-now` (redundant — either `no-interest` or `callback-requested`).

### Layer 2 — Canonical side effects

Finite enum. Adding a new side-effect requires code change.

| Side Effect | Behaviour |
|---|---|
| `none` | Return to pool under normal rules; intelligence engine decides next step |
| `cool_off` | Excluded from dispatch for N days (default 28, configurable) |
| `immediate_recall` | Re-dispatched onto same call list today, bottom of queue. Does NOT count against `max_call_attempts`. |
| `callback_1d` / `_2d` / `_3d` / `_7d` | Sets `callback_date = now + N days`; picked up by callback bucket on that date |
| `exclude_from_campaign` | Stays in pool but filtered out of this campaign's future dispatches via `exclude_outcomes` |
| `global_exclude` | `dispatch_status = 'archived'` — permanently out of every future call list |

### Layer 3 — Tag mapping with allowed-combinations matrix

The settings UI renders `outcome` as a dropdown; `side_effect` dropdown filters dynamically to only the combinations valid for the selected outcome:

| Outcome | Valid Side Effects |
|---|---|
| `interested` | `none` |
| `no-interest` | `exclude_from_campaign`, `cool_off`, `none` |
| `no-answer` | `cool_off`, `immediate_recall`, `none` |
| `callback-requested` | `callback_1d`, `callback_2d`, `callback_3d`, `callback_7d` |
| `meeting-booked` | `none` |
| `hung-up` | `cool_off`, `immediate_recall`, `none` |
| `do-not-call` | `global_exclude` (forced — UI hides the dropdown) |
| `does-not-exist` | `global_exclude` (forced — UI hides the dropdown) |

### Canonical mappings for current Aircall tags

| Aircall Tag | Outcome | Default Side Effect |
|---|---|---|
| `Cloudworkz` | `interested` | `none` |
| `Not Interested` | `no-interest` | `exclude_from_campaign` |
| `No Answer` | `no-answer` | `immediate_recall` (operator may switch to `cool_off`) |
| `Callbacks` | `callback-requested` | `callback_1d` (operator picks 1d / 2d / 3d / 7d) |
| `DNC` | `do-not-call` | `global_exclude` |
| `demo` | `meeting-booked` | `none` (may retire once NBA books demos autonomously) |
| `Hung Up` | `hung-up` | `cool_off` (operator may switch to `immediate_recall`) |
| `DNE` | `does-not-exist` | `global_exclude` |

### Configurable max_call_attempts

Move from hardcoded constant to `integration_configs.config.max_call_attempts` (default 3, range 1–10). Applies to the retry bucket (contacts with `no-answer` / `hung-up` outcomes whose side-effect put them back in rotation). `immediate_recall` dispatches do **not** count against the cap — operator chose to retry.

### Immediate recall mechanics

When a tag fires with `immediate_recall`:

1. Close the active call-list membership (normal `call.ended` behaviour)
2. Immediately create a new active membership on the **same** call list
3. Set `dispatch_date = now`, `dispatch_status = 'dispatched'`
4. Apply a new priority tier (5) in `getCallList` ordering so the contact sorts **below** fresh contacts (tier 4), landing at the bottom of today's queue
5. Contact is re-called today without waiting for tomorrow's fill

### Universal callback_date filter (critical bug fix)

All outcome buckets in `fillQueue` must respect a `callback_date` filter:

```
eligible IF callback_date IS NULL OR callback_date <= now
```

The engine's NBA populates `callback_date` post-call based on the action's `timing` field:

| NBA Timing | callback_date |
|---|---|
| `immediate` | `NULL` |
| `24_48_hours` | `now + 2 days` |
| `scheduled` (operator-set) | operator's date |
| explicit date | that date |

This closes the loop so interested/retry contacts only resurface on the day the engine says they're due.

## Rationale

- **Decouple but constrain.** Fully decoupled is too loose (nonsense combinations silently fail). Fully coupled is too rigid (operators can't express valid variants like "no-answer with immediate recall vs. cool-off"). The allowed-combinations matrix is the right middle ground.
- **Validation in UI rather than at write time.** Surfacing only valid options to the operator prevents errors being entered in the first place.
- **Configurable max_call_attempts.** Different campaigns may have different tolerance for persistence.
- **Universal callback_date.** A single field drives "when is this contact next eligible" regardless of outcome bucket. Avoids per-bucket logic duplication.
- **Terminal outcomes use `dispatch_status = 'archived'`** rather than a separate flag so existing queries that filter `!= 'archived'` continue to work unchanged.

## Consequences

- Existing `DEFAULT_TAG_MAPPING` in `aircall/index.ts:17` will be replaced by canonical constants in a dedicated module, imported by both the webhook handler and the settings UI.
- `dispatchService.ts` updates: add callback_date filter to interested + retry buckets; add priority tier 5 for `immediate_recall`; use configurable max_call_attempts from `integration_configs`.
- Webhook handler (`applyTagOutcome` at `aircall/index.ts:109`) updated to implement new side-effect types: `immediate_recall`, `global_exclude`, `callback_Nd`, `exclude_from_campaign`.
- Engine persistence (`saveEngineRun`) updated to set `callback_date` on the contact based on `nextBestAction.timing`.
- Settings UI gains a max_call_attempts number input and a tag-mapping editor with dynamically-filtered dropdowns.
- Existing integrations that relied on specific tag_mapping JSON must be migrated — but since the default was hardcoded and in-memory, this is a one-time seeding rather than a data migration.

## Supersedes

Supersedes the free-form tag mapping previously accepted by `aircall/index.ts`. No prior ADR.
