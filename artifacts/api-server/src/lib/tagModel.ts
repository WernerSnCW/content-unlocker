// Canonical model for Aircall tag outcomes and side-effects.
// See: docs/decisions/001-tag-outcome-side-effect-model.md
// This is the single source of truth; the webhook handler, fillQueue,
// and settings UI all import from here.

export type Outcome =
  | "interested"
  | "no-interest"
  | "no-answer"
  | "callback-requested"
  | "meeting-booked"
  | "hung-up"
  | "do-not-call"
  | "does-not-exist";

export type SideEffect =
  | "none"
  | "record_only"
  | "cool_off"
  | "immediate_recall"
  | "callback_1d"
  | "callback_2d"
  | "callback_3d"
  | "callback_7d"
  | "exclude_from_campaign"
  | "global_exclude";

export const OUTCOMES: readonly Outcome[] = [
  "interested",
  "no-interest",
  "no-answer",
  "callback-requested",
  "meeting-booked",
  "hung-up",
  "do-not-call",
  "does-not-exist",
];

export const SIDE_EFFECTS: readonly SideEffect[] = [
  "none",
  "record_only",
  "cool_off",
  "immediate_recall",
  "callback_1d",
  "callback_2d",
  "callback_3d",
  "callback_7d",
  "exclude_from_campaign",
  "global_exclude",
];

// Outcomes that permanently remove a contact from all future dispatch.
export const TERMINAL_OUTCOMES: readonly Outcome[] = ["do-not-call", "does-not-exist"];

// Allowed combinations. UI dropdowns constrain to these; webhook handler
// rejects anything outside this matrix. `record_only` is allowed on every
// outcome — it means "append this tag to the conversation as metadata
// without changing contact state".
export const ALLOWED_SIDE_EFFECTS: Record<Outcome, readonly SideEffect[]> = {
  interested: ["none", "record_only"],
  "no-interest": ["exclude_from_campaign", "cool_off", "none", "record_only"],
  "no-answer": ["cool_off", "immediate_recall", "none", "record_only"],
  "callback-requested": ["callback_1d", "callback_2d", "callback_3d", "callback_7d", "record_only"],
  "meeting-booked": ["none", "record_only"],
  "hung-up": ["cool_off", "immediate_recall", "none", "record_only"],
  "do-not-call": ["global_exclude", "record_only"],
  "does-not-exist": ["global_exclude", "record_only"],
};

// Human-readable labels for the settings UI
export const OUTCOME_LABELS: Record<Outcome, string> = {
  "interested": "Interested",
  "no-interest": "Not interested",
  "no-answer": "No answer",
  "callback-requested": "Callback requested",
  "meeting-booked": "Meeting booked",
  "hung-up": "Hung up",
  "do-not-call": "Do not call",
  "does-not-exist": "Number does not exist",
};

export const SIDE_EFFECT_LABELS: Record<SideEffect, string> = {
  "none": "None — engine decides next step",
  "record_only": "Record tag only (no state change)",
  "cool_off": "Cool-off for N days",
  "immediate_recall": "Immediate recall (bottom of today's queue)",
  "callback_1d": "Callback in 1 day",
  "callback_2d": "Callback in 2 days",
  "callback_3d": "Callback in 3 days",
  "callback_7d": "Callback in 7 days",
  "exclude_from_campaign": "Exclude from this campaign",
  "global_exclude": "Archive — never call again",
};

// Default cool-off in days, used when side_effect = "cool_off".
export const DEFAULT_COOL_OFF_DAYS = 28;

// Default max call attempts cap, used when integration_configs does not specify one.
export const DEFAULT_MAX_CALL_ATTEMPTS = 3;

// Map a callback_Nd side-effect to its delay in days.
export function callbackDays(sideEffect: SideEffect): number | null {
  switch (sideEffect) {
    case "callback_1d": return 1;
    case "callback_2d": return 2;
    case "callback_3d": return 3;
    case "callback_7d": return 7;
    default: return null;
  }
}

// True if the (outcome, sideEffect) pair is permitted.
export function isAllowedCombination(outcome: Outcome, sideEffect: SideEffect): boolean {
  return ALLOWED_SIDE_EFFECTS[outcome]?.includes(sideEffect) ?? false;
}

// Shape stored in integration_configs.config.tag_mapping and used by the webhook.
export interface TagMapping {
  aircall_tag: string;
  outcome: Outcome;
  side_effect: SideEffect;
  // Optional per-mapping override for the cool_off side-effect. Only meaningful
  // when side_effect === "cool_off"; ignored otherwise. Undefined/null = use
  // the global cool_off_days value from integration_configs.
  cool_off_days?: number | null;

  // --- Closer routing ---
  // When true, applying this tag stamps the contact with an assigned_closer_id
  // so a closer picks up the contact on their next fillQueue (instead of cold
  // agents). Outcome-agnostic: the admin chooses which tags trigger handoff.
  maps_to_closer?: boolean;
  // Optional: if set to a specific user_id (a closer), ONLY that closer can
  // pick up. Null + maps_to_closer=true means "any closer" (stamped as 'any'
  // on contacts.assigned_closer_id).
  closer_agent_id?: string | null;

  // --- Fallback follow-up date ---
  // If set and the applied side_effect does NOT already schedule a callback
  // (i.e. side_effect is not one of callback_1d/2d/3d/7d), the system sets
  // contacts.callback_date = NOW() + default_followup_days days.
  // Use case: "Cloudworkz" tag (interested) → default 1 day; "demo" tag
  // (meeting-booked) → default 2 days, in case the agent didn't capture the
  // real meeting date at tag-time.
  default_followup_days?: number | null;
}

// Default mapping seeded when no config is present.
export const DEFAULT_TAG_MAPPING: TagMapping[] = [
  { aircall_tag: "Cloudworkz", outcome: "interested", side_effect: "none" },
  { aircall_tag: "Not Interested", outcome: "no-interest", side_effect: "exclude_from_campaign" },
  { aircall_tag: "No Answer", outcome: "no-answer", side_effect: "immediate_recall" },
  { aircall_tag: "Callbacks", outcome: "callback-requested", side_effect: "callback_1d" },
  { aircall_tag: "DNC", outcome: "do-not-call", side_effect: "global_exclude" },
  { aircall_tag: "demo", outcome: "meeting-booked", side_effect: "none" },
  { aircall_tag: "Hung Up", outcome: "hung-up", side_effect: "cool_off" },
  { aircall_tag: "DNE", outcome: "does-not-exist", side_effect: "global_exclude" },
];
