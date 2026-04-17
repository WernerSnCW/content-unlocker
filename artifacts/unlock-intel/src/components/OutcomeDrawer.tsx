// Post-call outcome drawer. Slides in from the right when a call finishes.
// Shows the intelligence engine's output: Call Objectives for the next call
// (always leads), outcome tag, persona, hot button, signal changes, questions,
// qualification gates, content gates, demo coverage, NBA, email draft,
// post-close checklist, adviser loop, flags.
//
// Data source: /api/engine/contact/:id (engine view) + /api/engine/runs/:id
// (full output) + /api/engine/config/questions (question registry, cached).
//
// Phase 4.7 — Operator decisions + handoff layer added on top of 4.6.
//   - Handoff banner appears when viewing a handed review.
//   - Per-item approve/edit/reject controls on NBA, Email Draft,
//     Post-Close items, Adviser Loop items, Book 2.
//   - Hand to Closer button with note dialog.
//   - Data we don't yet produce (verbatim provenance, anchor phrase,
//     transcript prohibited-phrase detection) is NOT rendered; those land
//     with Phase 4.5a.

import { useEffect, useMemo, useState } from "react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Loader2, AlertCircle, ArrowRight, FileText, Send, SkipForward, Clock,
  Target, CheckCircle2, XCircle, MinusCircle, AlertTriangle, Mail,
  ListChecks, Users, Sparkles, Check, X as XIcon, Undo2, Edit3, UserPlus,
  CornerUpLeft,
} from "lucide-react";
import { cn } from "@/lib/utils";

const API_BASE = (import.meta.env.BASE_URL?.replace(/\/$/, "") || "") + "/api";

// ============================================================================
// Types (mirroring EngineOutputV3 server-side; see engine/v2/types.ts)
// ============================================================================

interface EngineSignal {
  id: string;
  code: string;
  state: string;
  evidence: string | null;
  confidence: string;
  updated_at: string;
}

interface EngineTransition {
  id: string;
  code: string;
  from_state: string | null;
  to_state: string;
  evidence: string | null;
  confidence: string | null;
  engine_run_id: string | null;
  transitioned_at: string;
}

interface EngineRunSummary {
  id: string;
  conversation_id: string | null;
  call_type: string;
  engine_version: string;
  created_at: string;
  summary: {
    persona: string;
    hotButton: string | null;
    signalUpdateCount: number;
    nextAction: string;
    c4Compliance: string;
    pack1: string;
    flags: number;
  };
}

interface InvestorState {
  id: string;
  persona: string;
  persona_confidence: string | null;
  persona_evidence: string | null;
  hot_button: string | null;
  hot_button_evidence: string | null;
  demo_score: number | null;
  pack1_gate: string;
  practical_problem: string | null;
  desired_outcome: string | null;
  decision_stakeholders: string | null;
}

interface EngineContactView {
  contactId: string;
  investorState: InvestorState | null;
  signals: EngineSignal[];
  transitions: EngineTransition[];
  runs: EngineRunSummary[];
}

interface FullRun {
  id: string;
  output: EngineOutputLike;
}

// EngineOutputV3-ish shape — typed loosely because older runs may not have V3 fields.
interface EngineOutputLike {
  personaAssessment?: { persona: string; confidence?: string };
  hotButton?: { primary?: string | null };
  signalUpdates?: Array<{ code: string; previousState: string; newState: string; evidence: string; confidence: string }>;
  gateStatus?: {
    c4Compliance: string;
    pack1: string;
    pack1BlockedReasons?: string[];
    [k: string]: any;
  };
  nextBestAction?: {
    actionType?: string;
    detail?: string;
    owner?: string;
    timing?: string;
    contentToSend?: { docId: number; docName: string; coverNoteDraft?: string };
  };
  flags?: Array<{ type: string; message: string }>;
  // V3 additions
  questionsDetected?: Array<{
    questionNumber: number;
    detected: boolean;
    signalTarget: string | null;
    investorResponse: string | null;
    inferredState: string | null;
    confidence: string;
  }>;
  demoSegmentAnalysis?: Array<{
    segment: number;
    segmentName: string;
    covered: boolean;
    signalOutcomes: { code: string; state: string }[];
    skipped: boolean;
    skipReason: string | null;
  }> | null;
  emailDraft?: {
    templateId: string;
    subject: string;
    body: string;
    attachmentDocId: number | null;
    attachmentDocName: string | null;
    coverNoteAngle: string | null;
    personalisationSources: string[];
    complianceCheck: { passed: boolean; violations: string[] };
    timing: string;
  } | null;
  postCloseActions?: Array<{
    action: string;
    owner: string;
    timing: string;
    detail?: string;
  }> | null;
  adviserLoopActions?: Array<{
    phase: "pre_call" | "during_call" | "post_call";
    actions: Array<{ action: string; owner: string; timing: string; detail?: string }>;
  }> | null;
  book2Routing?: {
    triggered: boolean;
    reason: string;
    actions: string[];
  } | null;
}

interface QuestionDef {
  qNum: number;
  text: string | null;
  call: 1 | 2 | 3;
  category: string;
  signal: string | null;
  gateRole: string | null;
}

// --- Phase 4.7 types ---
type ActionType = "nba" | "email" | "post_close_item" | "adviser_loop_item" | "book2";
type ActionDecision = "approved" | "edited" | "rejected" | "deferred";

interface OutcomeReviewRow {
  id: string;
  engine_run_id: string;
  contact_id: string;
  current_owner_user_id: string | null;
  status: "awaiting_review" | "under_review" | "handed_to_closer" | "handed_to_agent" | "actioned" | "stale_escaped";
  handed_from_user_id: string | null;
  hand_note: string | null;
  handed_at: string | null;
  claimed_at: string | null;
  resolved_at: string | null;
  resolution_notes: string | null;
  created_at: string;
  updated_at: string;
}
interface OutcomeActionDecisionRow {
  id: string;
  outcome_review_id: string;
  engine_run_id: string;
  action_type: ActionType;
  action_key: string;
  decision: ActionDecision;
  edited_payload: any | null;
  decided_by_user_id: string;
  decided_at: string;
}
interface UserRef {
  id: string;
  name: string | null;
  email: string;
}
interface ReviewBundle {
  review: OutcomeReviewRow;
  decisions: OutcomeActionDecisionRow[];
  currentOwner: UserRef | null;
  handedFrom: UserRef | null;
}
interface CloserOption {
  id: string;
  name: string | null;
  email: string;
  role: "closer" | "admin";
}

// ============================================================================
// Visual constants
// ============================================================================

const STATE_COLORS: Record<string, string> = {
  green: "bg-green-500/15 text-green-600 border-green-500/30",
  amber: "bg-amber-500/15 text-amber-600 border-amber-500/30",
  red: "bg-red-500/15 text-red-600 border-red-500/30",
  grey: "bg-muted text-muted-foreground border-border",
  n_a: "bg-muted/50 text-muted-foreground/60 border-border",
  confirmed: "bg-green-500/15 text-green-600 border-green-500/30",
  not_confirmed: "bg-red-500/15 text-red-600 border-red-500/30",
  unknown: "bg-muted text-muted-foreground border-border",
};

function stateClasses(state: string) {
  return STATE_COLORS[state] || STATE_COLORS.grey;
}

const PERSONA_LABELS: Record<string, string> = {
  preserver: "The Preserver",
  growth_seeker: "The Growth Seeker",
  legacy_builder: "The Legacy Builder",
  undetermined: "Undetermined",
};

// Per persona, which signal codes belong to the active "cluster" (if persona
// is known and any of these is still grey/null, it's a diagnostic miss).
const PERSONA_CLUSTERS: Record<string, string[]> = {
  growth_seeker: ["G1", "G2", "G3"],
  legacy_builder: ["L1", "L2"],
  preserver: ["P2", "P3"],
};

// Qualification gates — the three pre-EIS gates per Marie's brief:
//   QT  = tax rate qualification (higher/additional rate)
//   QL  = liquidity qualification (£40K+ deployable within 12 months)
//   DS  = decision_stakeholders (self-directed — no gatekeeper)
// DS isn't a signal; it's an investor_state string field. We treat its
// presence/content as the "state" for display purposes.
const QUALIFICATION_SIGNAL_CODES = ["QT", "QL"] as const;

// The five outcome tags used by call.tagged (Marie's operational taxonomy).
const OUTCOME_TAG_COLORS: Record<string, string> = {
  "EIS-QUALIFIED":   "bg-green-500/15 text-green-700 border-green-500/40",
  "LONG-HORIZON":    "bg-amber-500/15 text-amber-700 border-amber-500/40",
  "INTERMEDIARY":    "bg-blue-500/15 text-blue-700 border-blue-500/40",
  "CLOUDWORKZ":      "bg-purple-500/15 text-purple-700 border-purple-500/40",
  "CLOSED":          "bg-slate-500/15 text-slate-700 border-slate-500/40",
};

// ============================================================================
// Derivation helpers — client-side until Phase 4.5a
// ============================================================================

function groupSignalsByCategory(signals: EngineSignal[]): Record<string, EngineSignal[]> {
  const groups: Record<string, EngineSignal[]> = {
    qualification: [], core: [], problem: [], situational: [],
  };
  for (const s of signals) {
    const c = s.code;
    if (c === "QT" || c === "QL") groups.qualification.push(s);
    else if (c.startsWith("C")) groups.core.push(s);
    else if (c.startsWith("S")) groups.situational.push(s);
    else groups.problem.push(s);
  }
  return groups;
}

type CallObjective = {
  text: string;
  priority: 1 | 2 | 3 | 4 | 5;
  source:
    | "failed_qualification_gate"
    | "persona_cluster_gap"
    | "amber_signal_needing_movement"
    | "unanswered_gate_question"
    | "compliance_followup";
  signalCode: string | null;
};

/**
 * Temporary client-side derivation of the Call Objectives block for the NEXT
 * call. Priority order mirrors what Phase 4.5a will implement on the engine:
 *   1. Failed qualification gates — blocks EIS content entirely
 *   2. Persona-cluster gaps — wasted call otherwise
 *   3. Amber signals needing movement (core → situational → problem)
 *   4. Unanswered gate-role questions
 *   5. Unresolved compliance flags
 * Trims to top 5.
 *
 * When Phase 4.5a ships this function is deleted and the drawer reads
 * `output.callObjectives` directly from the engine.
 */
function deriveCallObjectives(
  signals: EngineSignal[],
  persona: string,
  questions: QuestionDef[],
  questionsDetected: EngineOutputLike["questionsDetected"] | undefined,
  flags: EngineOutputLike["flags"] | undefined,
  signalRegistry: Map<string, { name: string; priority: number }>,
): CallObjective[] {
  const out: CallObjective[] = [];
  const signalByCode = new Map(signals.map(s => [s.code, s]));

  // 1. Failed qualification gates
  for (const code of QUALIFICATION_SIGNAL_CODES) {
    const s = signalByCode.get(code);
    if (!s) continue;
    if (s.state === "not_confirmed" || s.state === "unknown" || s.state === "grey") {
      const name = signalRegistry.get(code)?.name ?? code;
      out.push({
        text: `Confirm ${name} (currently ${s.state})`,
        priority: 1,
        source: "failed_qualification_gate",
        signalCode: code,
      });
    }
  }

  // 2. Persona-cluster gaps
  if (persona && persona !== "undetermined") {
    const cluster = PERSONA_CLUSTERS[persona] ?? [];
    for (const code of cluster) {
      const s = signalByCode.get(code);
      const state = s?.state;
      if (!state || state === "grey") {
        const name = signalRegistry.get(code)?.name ?? code;
        out.push({
          text: `Surface ${code} (${name}) — persona signal not yet touched`,
          priority: 2,
          source: "persona_cluster_gap",
          signalCode: code,
        });
      }
    }
  }

  // 3. Amber signals — needing movement toward green
  const amberSignals = signals
    .filter(s => s.state === "amber")
    .sort((a, b) => {
      const pa = signalRegistry.get(a.code)?.priority ?? 99;
      const pb = signalRegistry.get(b.code)?.priority ?? 99;
      return pa - pb;
    });
  for (const s of amberSignals) {
    const name = signalRegistry.get(s.code)?.name ?? s.code;
    out.push({
      text: `Progress ${s.code} (${name}) — currently amber`,
      priority: 3,
      source: "amber_signal_needing_movement",
      signalCode: s.code,
    });
  }

  // 4. Unanswered gate-role questions (only if we have questionsDetected data)
  if (questionsDetected && questions.length > 0) {
    const qByNum = new Map(questions.map(q => [q.qNum, q]));
    for (const qd of questionsDetected) {
      if (qd.detected) continue;
      const qDef = qByNum.get(qd.questionNumber);
      if (!qDef?.gateRole) continue;
      out.push({
        text: `Ask Q${qd.questionNumber}: ${qDef.text ?? "(narrative prompt)"}`,
        priority: 4,
        source: "unanswered_gate_question",
        signalCode: qDef.signal,
      });
    }
  }

  // 5. Unresolved compliance flags
  if (flags) {
    for (const f of flags) {
      if (f.type?.toLowerCase().includes("compliance")) {
        out.push({
          text: `Resolve: ${f.message}`,
          priority: 5,
          source: "compliance_followup",
          signalCode: null,
        });
      }
    }
  }

  // Sort by priority then first-occurrence, trim to top 5
  out.sort((a, b) => a.priority - b.priority);
  return out.slice(0, 5);
}

// ============================================================================
// Main component
// ============================================================================

interface Props {
  open: boolean;
  contactId: string | null;
  contactName: string | null;
  conversationId: string | null;
  onClose: () => void;
  onSkip?: () => void;
  /** Latest outcome tag from call.tagged (five-outcome taxonomy). Passed by parent. */
  outcomeTag?: string | null;
}

export default function OutcomeDrawer({
  open, contactId, contactName, conversationId, onClose, onSkip, outcomeTag,
}: Props) {
  const [view, setView] = useState<EngineContactView | null>(null);
  const [fullRun, setFullRun] = useState<FullRun | null>(null);
  const [reviewBundle, setReviewBundle] = useState<ReviewBundle | null>(null);
  const [loading, setLoading] = useState(false);

  // Phase 4.7 — handoff dialog state
  const [handOffOpen, setHandOffOpen] = useState(false);
  const [handOffTargets, setHandOffTargets] = useState<CloserOption[]>([]);
  const [handOffTargetId, setHandOffTargetId] = useState<string>("");
  const [handOffNote, setHandOffNote] = useState("");
  const [handOffDirection, setHandOffDirection] = useState<"to_closer" | "to_agent">("to_closer");
  const [handOffSubmitting, setHandOffSubmitting] = useState(false);
  const [handOffError, setHandOffError] = useState<string | null>(null);

  // Decision submit state — prevents double-clicks / shows spinner per row
  const [decidingKey, setDecidingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);

  // Question registry + signal registry — fetched once, cached for session.
  const [questionRegistry, setQuestionRegistry] = useState<QuestionDef[]>([]);
  const [signalRegistryMap, setSignalRegistryMap] = useState<Map<string, { name: string; priority: number }>>(new Map());

  // Fetch question + signal registry once (lazy, on first drawer open)
  useEffect(() => {
    if (!open) return;
    if (questionRegistry.length > 0 && signalRegistryMap.size > 0) return;
    (async () => {
      try {
        const [qRes, sRes] = await Promise.all([
          fetch(`${API_BASE}/engine/config/questions`),
          fetch(`${API_BASE}/engine/config/signals`),
        ]);
        if (qRes.ok) {
          const qData = await qRes.json();
          setQuestionRegistry(qData.questions || []);
        }
        if (sRes.ok) {
          const sData = await sRes.json();
          const map = new Map<string, { name: string; priority: number }>();
          for (const s of sData.signals || []) map.set(s.code, { name: s.name, priority: s.priority });
          setSignalRegistryMap(map);
        }
      } catch { /* non-fatal — drawer still renders, just with less text */ }
    })();
  }, [open]);

  // Fetch engine view when drawer opens or when external refresh is requested
  useEffect(() => {
    if (!open || !contactId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/engine/contact/${contactId}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data: EngineContactView = await res.json();
        if (cancelled) return;
        setView(data);
        const run = conversationId
          ? data.runs.find(r => r.conversation_id === conversationId) ?? data.runs[0]
          : data.runs[0];
        if (run) {
          const r = await fetch(`${API_BASE}/engine/runs/${run.id}`);
          if (r.ok) {
            const full = await r.json();
            if (!cancelled) setFullRun({ id: full.id, output: full.output });
          }
          // Phase 4.7 — fetch the outcome_review for this run, if one exists.
          // 204 = no review created (tag's creates_outcome_review=false).
          try {
            const rev = await fetch(`${API_BASE}/outcome-reviews/by-run/${run.id}`);
            if (rev.ok && rev.status !== 204) {
              const bundle = await rev.json();
              if (!cancelled) setReviewBundle(bundle);
            } else if (!cancelled) {
              setReviewBundle(null);
            }
          } catch { /* non-fatal */ }
        } else {
          setFullRun(null);
          setReviewBundle(null);
        }
      } catch (err: any) {
        if (!cancelled) setError(err.message || "Failed to load");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [open, contactId, conversationId, refreshTick]);

  // Reload just the review bundle (after a decision or handoff action).
  const refreshReview = async () => {
    if (!reviewBundle?.review?.id && !fullRun?.id) return;
    const runId = fullRun?.id;
    if (!runId) return;
    try {
      const rev = await fetch(`${API_BASE}/outcome-reviews/by-run/${runId}`);
      if (rev.ok && rev.status !== 204) {
        const bundle = await rev.json();
        setReviewBundle(bundle);
      }
    } catch { /* ignore */ }
  };

  // Poll while drawer is open and we haven't got a run yet — covers the window
  // between call.ended (drawer opens) and call.tagged (engine run lands).
  useEffect(() => {
    if (!open || !contactId) return;
    if (view && view.runs.length > 0) return;
    const t = setInterval(() => setRefreshTick(x => x + 1), 4000);
    return () => clearInterval(t);
  }, [open, contactId, view]);

  const latestRun = view?.runs[0];
  const hasRun = !!latestRun;
  const output = fullRun?.output;
  const nba = output?.nextBestAction;
  const gates = output?.gateStatus;
  const flags = output?.flags || [];
  const signalUpdates = output?.signalUpdates || [];
  const persona = view?.investorState?.persona || output?.personaAssessment?.persona || "undetermined";
  const personaConfidence = view?.investorState?.persona_confidence || output?.personaAssessment?.confidence;
  const hotButton = view?.investorState?.hot_button || output?.hotButton?.primary;
  const grouped = groupSignalsByCategory(view?.signals || []);

  // V3-only pulls
  const questionsDetected = output?.questionsDetected;
  const demoSegments = output?.demoSegmentAnalysis;
  const emailDraft = output?.emailDraft;
  const postCloseActions = output?.postCloseActions;
  const adviserLoopActions = output?.adviserLoopActions;
  const book2 = output?.book2Routing;

  // Phase 4.7 — per-item decision lookup.
  // Build a map keyed by "<action_type>:<action_key>" → decision row, so
  // rendering can show "✓ Approved by X" or the edit/reject state next to
  // each actionable engine output.
  const decisionByKey = useMemo(() => {
    const m = new Map<string, OutcomeActionDecisionRow>();
    if (reviewBundle?.decisions) {
      for (const d of reviewBundle.decisions) {
        m.set(`${d.action_type}:${d.action_key}`, d);
      }
    }
    return m;
  }, [reviewBundle]);

  // Submit a per-item decision. Optimistic UX: show spinner on the row
  // while we POST, then refresh the review bundle on success.
  const submitDecision = async (
    actionType: ActionType,
    actionKey: string,
    decision: ActionDecision,
    editedPayload?: any,
  ) => {
    if (!reviewBundle?.review?.id) return;
    const rowKey = `${actionType}:${actionKey}`;
    setDecidingKey(rowKey);
    try {
      const res = await fetch(`${API_BASE}/outcome-reviews/${reviewBundle.review.id}/decisions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action_type: actionType,
          action_key: actionKey,
          decision,
          edited_payload: editedPayload ?? null,
        }),
      });
      if (res.ok) await refreshReview();
    } catch { /* swallowed — surfaced via missing state change */ }
    finally { setDecidingKey(null); }
  };

  // Open the hand-off dialog. Direction = to_closer by default, but if the
  // review's already on a closer (current owner is a closer/admin) and the
  // authed user is that owner, they can bounce back via to_agent.
  const openHandOff = async (direction: "to_closer" | "to_agent") => {
    setHandOffDirection(direction);
    setHandOffError(null);
    setHandOffNote("");
    setHandOffTargetId("");
    try {
      const res = await fetch(`${API_BASE}/users/closers`);
      if (res.ok) {
        const data = await res.json();
        setHandOffTargets(data.closers || []);
      }
    } catch { /* non-fatal */ }
    setHandOffOpen(true);
  };

  // Render the Approve / Edit / Reject triad for a given item. If a
  // decision already exists, show its decided-state + an Undo button
  // (which rejects the existing decision by resubmitting as "deferred"
  // — effectively clearing the commitment without a hard delete).
  //
  // Renders nothing when there's no review for this run (e.g. the applied
  // tag was configured creates_outcome_review=false).
  const renderDecisionBar = (actionType: ActionType, actionKey: string) => {
    if (!reviewBundle?.review?.id) return null;
    const rowKey = `${actionType}:${actionKey}`;
    const existing = decisionByKey.get(rowKey);
    const busy = decidingKey === rowKey;

    if (existing) {
      const color =
        existing.decision === "approved" ? "text-green-700 bg-green-500/10 border-green-500/30"
        : existing.decision === "edited" ? "text-amber-700 bg-amber-500/10 border-amber-500/30"
        : existing.decision === "rejected" ? "text-red-700 bg-red-500/10 border-red-500/30"
        : "text-muted-foreground bg-muted/50 border-border";
      const label =
        existing.decision === "approved" ? "Approved"
        : existing.decision === "edited" ? "Edited"
        : existing.decision === "rejected" ? "Rejected"
        : "Deferred";
      return (
        <div className={cn("flex items-center justify-between gap-2 rounded border px-2 py-1 text-xs", color)}>
          <span className="flex items-center gap-1.5">
            {existing.decision === "approved" && <Check className="w-3 h-3" />}
            {existing.decision === "rejected" && <XIcon className="w-3 h-3" />}
            {existing.decision === "edited" && <Edit3 className="w-3 h-3" />}
            <span className="font-medium">{label}</span>
            <span className="opacity-70">
              · {new Date(existing.decided_at).toLocaleTimeString()}
            </span>
          </span>
          <Button
            size="sm"
            variant="ghost"
            className="h-6 px-2 text-xs gap-1"
            disabled={busy}
            onClick={() => submitDecision(actionType, actionKey, "deferred")}
          >
            {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Undo2 className="w-3 h-3" />}
            Undo
          </Button>
        </div>
      );
    }

    return (
      <div className="flex items-center gap-1.5">
        <Button
          size="sm"
          variant="outline"
          className="h-7 px-2 text-xs gap-1 border-green-500/40 text-green-700 hover:bg-green-500/10"
          disabled={busy}
          onClick={() => submitDecision(actionType, actionKey, "approved")}
        >
          {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
          Approve
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-7 px-2 text-xs gap-1 border-amber-500/40 text-amber-700 hover:bg-amber-500/10"
          disabled={busy}
          title="Editing UI lands in a future pass — for now this marks the item as 'edited' (operator-acknowledged)"
          onClick={() => submitDecision(actionType, actionKey, "edited")}
        >
          <Edit3 className="w-3 h-3" /> Edit
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-7 px-2 text-xs gap-1 border-red-500/40 text-red-700 hover:bg-red-500/10"
          disabled={busy}
          onClick={() => submitDecision(actionType, actionKey, "rejected")}
        >
          <XIcon className="w-3 h-3" /> Reject
        </Button>
      </div>
    );
  };

  const submitHandOff = async () => {
    if (!reviewBundle?.review?.id) return;
    if (!handOffTargetId) { setHandOffError("Pick a user to hand to."); return; }
    setHandOffSubmitting(true);
    setHandOffError(null);
    try {
      const res = await fetch(`${API_BASE}/outcome-reviews/${reviewBundle.review.id}/hand-off`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to_user_id: handOffTargetId,
          note: handOffNote.trim() || null,
          direction: handOffDirection,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setHandOffError(body.message || body.error || `Request failed (${res.status})`);
        return;
      }
      setHandOffOpen(false);
      await refreshReview();
    } catch (err: any) {
      setHandOffError(err?.message || "Hand-off failed");
    } finally {
      setHandOffSubmitting(false);
    }
  };

  // Call Objectives — derive client-side (Phase 4.6 temporary)
  const callObjectives = useMemo(() => {
    if (!hasRun || !view) return [];
    return deriveCallObjectives(
      view.signals,
      persona,
      questionRegistry,
      questionsDetected,
      flags,
      signalRegistryMap,
    );
  }, [hasRun, view, persona, questionRegistry, questionsDetected, flags, signalRegistryMap]);

  // Qualification gates status (QT + QL + decision_stakeholders from investor_state)
  const qualificationGates = useMemo(() => {
    const signalByCode = new Map((view?.signals || []).map(s => [s.code, s]));
    const rows = [
      {
        id: "QT",
        label: "Tax rate (higher / additional)",
        state: signalByCode.get("QT")?.state ?? "unknown",
      },
      {
        id: "QL",
        label: "Liquidity (£40K+ deployable)",
        state: signalByCode.get("QL")?.state ?? "unknown",
      },
      {
        id: "DS",
        label: "Self-directed (no gatekeeper)",
        state: view?.investorState?.decision_stakeholders
          ? (view.investorState.decision_stakeholders.toLowerCase().includes("sole")
              || view.investorState.decision_stakeholders.toLowerCase().includes("self")
              ? "confirmed"
              : "not_confirmed")
          : "unknown",
      },
    ];
    const anyFailed = rows.some(r => r.state === "not_confirmed");
    return { rows, anyFailed };
  }, [view]);

  // Persona cluster gaps (L1/L2/G1/G2/G3/P2/P3 not yet touched)
  const personaClusterGaps = useMemo(() => {
    if (!persona || persona === "undetermined") return [];
    const cluster = PERSONA_CLUSTERS[persona] ?? [];
    const signalByCode = new Map((view?.signals || []).map(s => [s.code, s]));
    return cluster.filter(code => {
      const s = signalByCode.get(code);
      return !s || s.state === "grey";
    });
  }, [persona, view]);

  // Questions asked — detected vs. expected + critical misses
  const questionsSummary = useMemo(() => {
    if (!questionsDetected || questionRegistry.length === 0) return null;
    const qByNum = new Map(questionRegistry.map(q => [q.qNum, q]));
    const detected = questionsDetected.filter(q => q.detected).length;
    const total = questionsDetected.length;
    const criticalMisses = questionsDetected.filter(q => {
      if (q.detected) return false;
      const def = qByNum.get(q.questionNumber);
      return !!def?.gateRole;
    }).length;
    return { detected, total, criticalMisses };
  }, [questionsDetected, questionRegistry]);

  return (
    <Sheet open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent side="right" className="sm:max-w-[560px] w-full overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            Call Outcome
            {loading && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
          </SheetTitle>
          <SheetDescription>
            {contactName || "Contact"}
            {latestRun && <span className="ml-2 text-xs text-muted-foreground">· engine {latestRun.engine_version}</span>}
          </SheetDescription>
        </SheetHeader>

        <div className="mt-4 space-y-4">
          {error && (
            <Card className="border-destructive/30 bg-destructive/5">
              <CardContent className="py-3 text-sm text-destructive flex items-center gap-2">
                <AlertCircle className="w-4 h-4" /> {error}
              </CardContent>
            </Card>
          )}

          {!hasRun && !error && (
            <Card className="border-amber-500/30 bg-amber-500/5">
              <CardContent className="py-4 text-sm text-amber-700 dark:text-amber-400 flex items-center gap-2">
                <Clock className="w-4 h-4" />
                Awaiting engine output — transcript still being processed. This usually takes 10–60s after tagging.
              </CardContent>
            </Card>
          )}

          {hasRun && (
            <>
              {/* ============================================================
                  HAND-OFF BANNER — Phase 4.7
                  Shown when this review was handed from someone else. Gives
                  the recipient immediate context: who sent it, when, and
                  their note. Lives ABOVE Call Objectives because the
                  recipient needs to know WHY they're seeing this before
                  working through the output.
                ============================================================ */}
              {reviewBundle?.review && reviewBundle.handedFrom && reviewBundle.review.handed_at && (
                <Card className={cn(
                  "border-l-4",
                  reviewBundle.review.status === "handed_to_closer"
                    ? "border-l-purple-500 bg-purple-500/5 border-purple-500/30"
                    : "border-l-amber-500 bg-amber-500/5 border-amber-500/30",
                )}>
                  <CardContent className="py-3 px-4 space-y-1.5">
                    <div className="flex items-center gap-2 text-xs">
                      {reviewBundle.review.status === "handed_to_closer"
                        ? <UserPlus className="w-3.5 h-3.5 text-purple-700" />
                        : <CornerUpLeft className="w-3.5 h-3.5 text-amber-700" />}
                      <span className={cn(
                        "font-semibold uppercase tracking-wider",
                        reviewBundle.review.status === "handed_to_closer" ? "text-purple-700" : "text-amber-700",
                      )}>
                        {reviewBundle.review.status === "handed_to_closer"
                          ? "Handed to you by"
                          : "Bounced back by"}
                      </span>
                      <span className="font-medium">
                        {reviewBundle.handedFrom.name ?? reviewBundle.handedFrom.email}
                      </span>
                      <span className="text-muted-foreground">
                        · {new Date(reviewBundle.review.handed_at).toLocaleString()}
                      </span>
                    </div>
                    {reviewBundle.review.hand_note && (
                      <p className="text-sm leading-relaxed whitespace-pre-wrap pl-5">
                        {reviewBundle.review.hand_note}
                      </p>
                    )}
                  </CardContent>
                </Card>
              )}

              {/* ============================================================
                  CALL OBJECTIVES — NEXT CALL  (leads every output — canonical)
                  Rule: project_call_objectives_rule.md
                  Phase 4.6: derived client-side. Phase 4.5a will move to engine.
                ============================================================ */}
              <Card className="border-primary/50 bg-primary/[0.04]">
                <CardContent className="py-3 px-4">
                  <div className="flex items-center gap-2 mb-2">
                    <Target className="w-4 h-4 text-primary" />
                    <p className="text-xs font-semibold uppercase tracking-wider text-primary">
                      Call objectives — next call
                    </p>
                  </div>
                  {callObjectives.length === 0 ? (
                    <p className="text-sm text-muted-foreground italic">
                      No objectives derivable yet — awaiting signal data.
                    </p>
                  ) : (
                    <ul className="space-y-1.5">
                      {callObjectives.map((o, i) => (
                        <li key={i} className="flex items-start gap-2 text-sm">
                          <span className={cn(
                            "mt-0.5 inline-block w-1.5 h-1.5 rounded-full shrink-0",
                            o.priority === 1 ? "bg-red-500"
                              : o.priority === 2 ? "bg-amber-500"
                              : o.priority === 3 ? "bg-blue-500"
                              : "bg-muted-foreground/50",
                          )} />
                          <span>{o.text}</span>
                          {o.signalCode && (
                            <span className="text-xs text-muted-foreground/70 ml-auto font-mono shrink-0">
                              {o.signalCode}
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </CardContent>
              </Card>

              {/* ============================================================
                  BADGES ROW — outcome tag first, then persona/hot-button/demo
                ============================================================ */}
              <div className="flex flex-wrap gap-2">
                {outcomeTag && (
                  <Badge
                    variant="outline"
                    className={cn("gap-1 font-semibold", OUTCOME_TAG_COLORS[outcomeTag] ?? "")}
                  >
                    <span className="text-xs opacity-70">Outcome:</span>
                    {outcomeTag}
                  </Badge>
                )}
                <Badge variant="outline" className="gap-1">
                  <span className="text-muted-foreground">Persona:</span>
                  <span className="font-semibold">{PERSONA_LABELS[persona] || persona}</span>
                  {personaConfidence && <span className="text-xs opacity-60">({personaConfidence})</span>}
                </Badge>
                {hotButton && (
                  <Badge variant="outline" className="gap-1">
                    <span className="text-muted-foreground">Hot button:</span>
                    <span className="font-semibold capitalize">{hotButton}</span>
                  </Badge>
                )}
                {view?.investorState?.demo_score != null && (
                  <Badge variant="outline" className="gap-1">
                    <span className="text-muted-foreground">Demo score:</span>
                    <span className="font-semibold">{view.investorState.demo_score}/100</span>
                  </Badge>
                )}
                {book2?.triggered && (
                  <Badge variant="outline" className="gap-1 bg-indigo-500/10 text-indigo-700 border-indigo-500/30">
                    <span className="text-xs opacity-70">Book 2:</span>
                    <span className="font-semibold">{book2.reason || "triggered"}</span>
                  </Badge>
                )}
              </div>

              {/* ============================================================
                  SIGNAL CHANGES — this call
                ============================================================ */}
              {signalUpdates.length > 0 && (
                <Card>
                  <CardContent className="py-3">
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Signal changes this call</p>
                    <div className="space-y-1.5">
                      {signalUpdates.map((u) => (
                        <div key={u.code} className="flex items-center gap-2 text-sm">
                          <span className="font-mono text-xs w-10 shrink-0">{u.code}</span>
                          <Badge className={`${stateClasses(u.previousState)} text-xs`} variant="outline">{u.previousState}</Badge>
                          <ArrowRight className="w-3 h-3 text-muted-foreground shrink-0" />
                          <Badge className={`${stateClasses(u.newState)} text-xs`} variant="outline">{u.newState}</Badge>
                          {u.evidence && <span className="text-xs text-muted-foreground truncate">· {u.evidence}</span>}
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* ============================================================
                  QUESTIONS ASKED  (V3 — with persona-cluster completeness)
                ============================================================ */}
              {(questionsSummary || personaClusterGaps.length > 0) && (
                <Card>
                  <CardContent className="py-3 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                        Questions asked
                        {questionsSummary && (
                          <span className="ml-1 text-muted-foreground/80">
                            ({questionsSummary.detected} of {questionsSummary.total})
                          </span>
                        )}
                      </p>
                      {questionsSummary && questionsSummary.criticalMisses > 0 && (
                        <Badge variant="outline" className="bg-red-500/15 text-red-700 border-red-500/30 text-xs">
                          <AlertTriangle className="w-3 h-3 mr-1" />
                          {questionsSummary.criticalMisses} gate-role miss{questionsSummary.criticalMisses !== 1 ? "es" : ""}
                        </Badge>
                      )}
                    </div>

                    {/* Persona-cluster check row */}
                    {persona !== "undetermined" && PERSONA_CLUSTERS[persona] && (
                      <div className={cn(
                        "flex items-center gap-2 text-xs rounded px-2 py-1",
                        personaClusterGaps.length > 0
                          ? "bg-amber-500/10 border border-amber-500/30 text-amber-700"
                          : "bg-green-500/10 border border-green-500/30 text-green-700",
                      )}>
                        <span className="font-medium">Persona: {PERSONA_LABELS[persona]}</span>
                        <span className="opacity-80">·</span>
                        {PERSONA_CLUSTERS[persona].map(code => {
                          const covered = !personaClusterGaps.includes(code);
                          return (
                            <span key={code} className="flex items-center gap-0.5 font-mono">
                              {code}
                              {covered ? <CheckCircle2 className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
                            </span>
                          );
                        })}
                        {personaClusterGaps.length > 0 && (
                          <span className="ml-auto opacity-80">
                            {personaClusterGaps.length} missed
                          </span>
                        )}
                      </div>
                    )}

                    {/* Collapsible per-question detail — auto-open when any critical miss */}
                    {questionsSummary && questionsDetected && questionsDetected.length > 0 && (
                      <details
                        className="rounded border border-border text-sm"
                        open={questionsSummary.criticalMisses > 0}
                      >
                        <summary className="cursor-pointer py-1.5 px-2 text-xs text-muted-foreground hover:bg-muted/50">
                          Per-question detail
                        </summary>
                        <div className="p-2 space-y-1">
                          {questionsDetected.map((qd, i) => {
                            const def = questionRegistry.find(q => q.qNum === qd.questionNumber);
                            const isCritical = !!def?.gateRole;
                            return (
                              <div key={i} className="flex items-start gap-2 text-xs py-1 border-b border-border/50 last:border-b-0">
                                {qd.detected
                                  ? <CheckCircle2 className="w-3.5 h-3.5 text-green-600 mt-0.5 shrink-0" />
                                  : isCritical
                                    ? <XCircle className="w-3.5 h-3.5 text-red-600 mt-0.5 shrink-0" />
                                    : <MinusCircle className="w-3.5 h-3.5 text-muted-foreground/50 mt-0.5 shrink-0" />}
                                <div className="flex-1 min-w-0">
                                  <p>
                                    <span className="font-mono text-muted-foreground/70 mr-1">Q{qd.questionNumber}</span>
                                    {def?.text ?? <span className="italic text-muted-foreground">(narrative prompt)</span>}
                                  </p>
                                  {(qd.signalTarget || qd.inferredState) && (
                                    <p className="text-[10px] text-muted-foreground mt-0.5">
                                      {qd.signalTarget && <span className="font-mono">{qd.signalTarget}</span>}
                                      {qd.inferredState && <span> → {qd.inferredState}</span>}
                                    </p>
                                  )}
                                  {qd.investorResponse && (
                                    <p className="text-[10px] text-muted-foreground/80 italic mt-0.5 truncate">
                                      "{qd.investorResponse}"
                                    </p>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </details>
                    )}
                  </CardContent>
                </Card>
              )}

              {/* ============================================================
                  QUALIFICATION GATES  (three pre-EIS gates)
                ============================================================ */}
              <Card>
                <CardContent className="py-3 space-y-1.5">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">
                    Qualification gates
                  </p>
                  {qualificationGates.rows.map(row => (
                    <div key={row.id} className="flex items-center justify-between text-sm">
                      <span className="flex items-center gap-2">
                        <span className="font-mono text-xs text-muted-foreground w-6">{row.id}</span>
                        {row.label}
                      </span>
                      <Badge variant="outline" className={`${stateClasses(row.state)} text-xs`}>
                        {row.state}
                      </Badge>
                    </div>
                  ))}
                  {qualificationGates.anyFailed && (
                    <div className="mt-2 rounded px-2 py-1.5 text-xs bg-red-500/10 border border-red-500/30 text-red-700">
                      <AlertTriangle className="w-3 h-3 inline mr-1" />
                      Qualification failure — route suggestion: <strong>LONG-HORIZON</strong> (not CLOSED). Override in 4.7.
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* ============================================================
                  CONTENT GATES  (C4 + Pack 1)
                ============================================================ */}
              {gates && (
                <Card>
                  <CardContent className="py-3 space-y-1.5 text-sm">
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">Content gates</p>
                    <div className="flex items-center justify-between">
                      <span>C4 compliance</span>
                      <Badge variant="outline" className={gates.c4Compliance === "open"
                        ? "bg-green-500/15 text-green-600 border-green-500/30"
                        : "bg-red-500/15 text-red-600 border-red-500/30"}>
                        {gates.c4Compliance}
                      </Badge>
                    </div>
                    <div className="flex items-center justify-between">
                      <span>Pack 1</span>
                      <Badge variant="outline" className={gates.pack1 === "eligible"
                        ? "bg-green-500/15 text-green-600 border-green-500/30"
                        : "bg-amber-500/15 text-amber-600 border-amber-500/30"}>
                        {gates.pack1}
                      </Badge>
                    </div>
                    {gates.pack1 === "blocked" && gates.pack1BlockedReasons && gates.pack1BlockedReasons.length > 0 && (
                      <p className="text-xs text-muted-foreground pl-2">
                        {gates.pack1BlockedReasons.join(", ")}
                      </p>
                    )}
                  </CardContent>
                </Card>
              )}

              {/* ============================================================
                  DEMO SEGMENT COVERAGE  (V3)
                ============================================================ */}
              {demoSegments && demoSegments.length > 0 && (
                <Card>
                  <CardContent className="py-3 space-y-2">
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                      Demo segment coverage
                    </p>
                    <div className="space-y-1.5">
                      {demoSegments.map(seg => {
                        const status = seg.skipped ? "skipped" : seg.covered ? "covered" : "not_covered";
                        const icon = status === "covered"
                          ? <CheckCircle2 className="w-4 h-4 text-green-600 shrink-0" />
                          : status === "skipped"
                            ? <SkipForward className="w-4 h-4 text-amber-600 shrink-0" />
                            : <MinusCircle className="w-4 h-4 text-muted-foreground/60 shrink-0" />;
                        return (
                          <div key={seg.segment} className="flex items-start gap-2 text-sm">
                            {icon}
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="font-medium">{seg.segmentName}</span>
                                {seg.signalOutcomes.length > 0 && (
                                  <span className="flex gap-1">
                                    {seg.signalOutcomes.map((so, i) => (
                                      <Badge key={i} variant="outline" className={`${stateClasses(so.state)} text-[10px] font-mono`}>
                                        {so.code}
                                      </Badge>
                                    ))}
                                  </span>
                                )}
                              </div>
                              {seg.skipped && seg.skipReason && (
                                <p className="text-xs text-muted-foreground italic mt-0.5">Skip reason: {seg.skipReason}</p>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    {/* Red banner: C4 segment skipped is a compliance failure */}
                    {demoSegments.some(s => s.skipped && s.signalOutcomes.some(o => o.code === "C4")) && (
                      <div className="rounded px-2 py-1.5 text-xs bg-red-500/10 border border-red-500/30 text-red-700">
                        <AlertTriangle className="w-3 h-3 inline mr-1" />
                        C4 segment was skipped during demo — compliance failure flag.
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}

              {/* ============================================================
                  NEXT BEST ACTION  (existing, minus inline coverNoteDraft)
                ============================================================ */}
              {nba && (
                <Card className="border-primary/40 bg-primary/[0.02]">
                  <CardContent className="py-3 space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Next best action</p>
                        <p className="font-semibold text-sm mt-0.5">{nba.detail || nba.actionType}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {nba.owner} · {nba.timing}
                        </p>
                      </div>
                    </div>
                    {nba.contentToSend && (
                      <>
                        <Separator />
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <FileText className="w-3 h-3" />
                          <span>Send: {nba.contentToSend.docName} (doc {nba.contentToSend.docId})</span>
                        </div>
                      </>
                    )}
                    <div className="pt-1">
                      {renderDecisionBar("nba", "primary") ?? (
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            className="gap-1"
                            disabled
                            title="Sending requires Phase 7.5 website integration"
                          >
                            <Send className="w-3.5 h-3.5" /> Send
                          </Button>
                          <Button size="sm" variant="outline" className="gap-1" onClick={onSkip}>
                            <SkipForward className="w-3.5 h-3.5" /> Skip
                          </Button>
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* ============================================================
                  EMAIL DRAFT  (V3)
                ============================================================ */}
              {emailDraft && (
                <Card className="border-blue-500/30 bg-blue-500/[0.02]">
                  <CardContent className="py-3 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <Mail className="w-4 h-4 text-blue-600" />
                        <p className="text-xs font-semibold uppercase tracking-wide text-blue-700">Email draft</p>
                      </div>
                      <div className="flex gap-1">
                        <Badge variant="outline" className="text-[10px] font-mono">{emailDraft.templateId}</Badge>
                        <Badge variant="outline" className="text-[10px]">{emailDraft.timing}</Badge>
                      </div>
                    </div>
                    <p className="text-sm font-semibold">{emailDraft.subject}</p>
                    <div className="text-xs bg-muted/40 border border-border rounded p-2 whitespace-pre-wrap leading-relaxed max-h-48 overflow-y-auto">
                      {emailDraft.body}
                    </div>
                    {(emailDraft.attachmentDocName || emailDraft.attachmentDocId != null) && (
                      <div className="flex items-center gap-2 text-xs">
                        <FileText className="w-3 h-3 text-muted-foreground" />
                        <span className="rounded bg-muted/60 px-2 py-0.5">
                          📎 {emailDraft.attachmentDocName ?? `doc ${emailDraft.attachmentDocId}`}
                          {emailDraft.attachmentDocId != null && (
                            <span className="text-muted-foreground ml-1">(doc {emailDraft.attachmentDocId})</span>
                          )}
                        </span>
                      </div>
                    )}
                    {/* Compliance */}
                    <div>
                      {emailDraft.complianceCheck.passed ? (
                        <div className="flex items-center gap-1.5 text-xs text-green-700">
                          <CheckCircle2 className="w-3 h-3" />
                          <span>Compliance checks passed</span>
                        </div>
                      ) : (
                        <div className="rounded bg-red-500/10 border border-red-500/30 px-2 py-1.5 space-y-1">
                          <p className="text-xs font-medium text-red-700 flex items-center gap-1">
                            <AlertTriangle className="w-3 h-3" />
                            {emailDraft.complianceCheck.violations.length} compliance violation{emailDraft.complianceCheck.violations.length !== 1 ? "s" : ""}
                          </p>
                          {emailDraft.complianceCheck.violations.map((v, i) => (
                            <p key={i} className="text-xs text-red-700 pl-4">✗ {v}</p>
                          ))}
                        </div>
                      )}
                    </div>
                    {/* Personalisation sources */}
                    {emailDraft.personalisationSources.length > 0 && (
                      <div className="flex flex-wrap gap-1 items-center text-[10px] text-muted-foreground">
                        <span>Personalised from:</span>
                        {emailDraft.personalisationSources.map((s, i) => (
                          <Badge key={i} variant="outline" className="text-[10px] font-normal">
                            {s}
                          </Badge>
                        ))}
                      </div>
                    )}
                    {/* Phase 4.7 — per-item decision controls */}
                    <div className="pt-1">{renderDecisionBar("email", "primary")}</div>
                  </CardContent>
                </Card>
              )}

              {/* ============================================================
                  Book 2 routing decision (when triggered) — Phase 4.7
                  Book 2 routing is a single item; surface it as an
                  actionable card so the operator can approve the routing
                  or reject it (e.g. "no, don't route to book 2 this time").
                ============================================================ */}
              {book2?.triggered && (
                <Card className="border-indigo-500/30 bg-indigo-500/[0.02]">
                  <CardContent className="py-3 space-y-2">
                    <div className="flex items-center gap-2">
                      <Sparkles className="w-4 h-4 text-indigo-700" />
                      <p className="text-xs font-semibold uppercase tracking-wide text-indigo-700">Book 2 routing</p>
                    </div>
                    {book2.reason && <p className="text-sm">{book2.reason}</p>}
                    {book2.actions && book2.actions.length > 0 && (
                      <ul className="text-xs text-muted-foreground space-y-0.5 pl-3 list-disc list-inside">
                        {book2.actions.map((a, i) => (<li key={i}>{a}</li>))}
                      </ul>
                    )}
                    <div className="pt-1">{renderDecisionBar("book2", "primary")}</div>
                  </CardContent>
                </Card>
              )}

              {/* ============================================================
                  POST-CLOSE CHECKLIST  (V3)
                ============================================================ */}
              {postCloseActions && postCloseActions.length > 0 && (
                <Card className="border-green-500/30 bg-green-500/[0.02]">
                  <CardContent className="py-3 space-y-2">
                    <div className="flex items-center gap-2">
                      <ListChecks className="w-4 h-4 text-green-700" />
                      <p className="text-xs font-semibold uppercase tracking-wide text-green-700">Post-close checklist</p>
                    </div>
                    <div className="space-y-2.5">
                      {postCloseActions.map((a, i) => {
                        // Derive a stable item key — ideally the engine
                        // would emit unique IDs, but the (action, owner)
                        // pair is stable across identical runs and is
                        // fine for decision identity in 4.7.
                        const itemKey = `post_close:${i}:${a.action.slice(0, 40)}`;
                        return (
                          <div key={i} className="border-b border-border/50 last:border-b-0 pb-2 last:pb-0 space-y-1">
                            <div className="flex items-start gap-2 text-sm">
                              <CheckCircle2 className="w-3.5 h-3.5 text-green-600 mt-0.5 shrink-0 opacity-60" />
                              <div className="flex-1 min-w-0">
                                <p className="font-medium">{a.action}</p>
                                <p className="text-xs text-muted-foreground">
                                  {a.owner} · {a.timing}
                                </p>
                                {a.detail && <p className="text-xs text-muted-foreground/90 mt-0.5">{a.detail}</p>}
                              </div>
                            </div>
                            <div className="pl-5">{renderDecisionBar("post_close_item", itemKey)}</div>
                          </div>
                        );
                      })}
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* ============================================================
                  ADVISER LOOP  (V3)
                ============================================================ */}
              {adviserLoopActions && adviserLoopActions.length > 0 && (
                <Card className="border-purple-500/30 bg-purple-500/[0.02]">
                  <CardContent className="py-3 space-y-2">
                    <div className="flex items-center gap-2">
                      <Users className="w-4 h-4 text-purple-700" />
                      <p className="text-xs font-semibold uppercase tracking-wide text-purple-700">Adviser loop</p>
                    </div>
                    {(["pre_call", "during_call", "post_call"] as const).map(phase => {
                      const group = adviserLoopActions.find(g => g.phase === phase);
                      if (!group || group.actions.length === 0) return null;
                      const phaseLabel = phase === "pre_call" ? "Pre-call"
                        : phase === "during_call" ? "During call"
                        : "Post-call";
                      return (
                        <div key={phase} className="space-y-1.5">
                          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{phaseLabel}</p>
                          {group.actions.map((a, i) => {
                            const itemKey = `adviser_loop:${phase}:${i}:${a.action.slice(0, 40)}`;
                            return (
                              <div key={i} className="pl-2 space-y-1">
                                <div className="flex items-start gap-2 text-sm">
                                  <Sparkles className="w-3 h-3 text-purple-500 mt-1 shrink-0" />
                                  <div className="flex-1 min-w-0">
                                    <p>{a.action}</p>
                                    <p className="text-[10px] text-muted-foreground">{a.owner} · {a.timing}</p>
                                    {a.detail && <p className="text-xs text-muted-foreground/90 mt-0.5">{a.detail}</p>}
                                  </div>
                                </div>
                                <div className="pl-5">{renderDecisionBar("adviser_loop_item", itemKey)}</div>
                              </div>
                            );
                          })}
                        </div>
                      );
                    })}
                  </CardContent>
                </Card>
              )}

              {/* ============================================================
                  FLAGS  (compliance + other)
                ============================================================ */}
              {flags.length > 0 && (
                <Card className="border-amber-500/30 bg-amber-500/5">
                  <CardContent className="py-3 space-y-1">
                    <p className="text-xs font-medium text-amber-700 dark:text-amber-400 uppercase tracking-wide">
                      Flags ({flags.length})
                    </p>
                    {flags.map((f, i) => (
                      <div key={i} className="text-xs flex items-start gap-1.5">
                        <AlertCircle className="w-3 h-3 mt-0.5 text-amber-500 shrink-0" />
                        <span className="text-amber-700 dark:text-amber-400">
                          <span className="opacity-70">[{f.type}]</span> {f.message}
                        </span>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              )}

              {/* ============================================================
                  ALL SIGNALS  (collapsed)
                ============================================================ */}
              <details className="rounded border text-sm">
                <summary className="cursor-pointer py-2 px-3 text-xs font-medium text-muted-foreground hover:bg-muted/50">
                  All signals ({view?.signals.length || 0})
                </summary>
                <div className="p-3 space-y-3">
                  {(["qualification", "core", "problem", "situational"] as const).map((cat) => (
                    grouped[cat].length > 0 && (
                      <div key={cat}>
                        <p className="text-xs uppercase tracking-wide text-muted-foreground mb-1">{cat}</p>
                        <div className="flex flex-wrap gap-1.5">
                          {grouped[cat].map((s) => (
                            <Badge
                              key={s.id}
                              variant="outline"
                              className={`${stateClasses(s.state)} text-xs font-mono`}
                              title={s.evidence || ""}
                            >
                              {s.code} · {s.state}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    )
                  ))}
                </div>
              </details>

              {/* Run history */}
              {view && view.runs.length > 1 && (
                <details className="rounded border text-sm">
                  <summary className="cursor-pointer py-2 px-3 text-xs font-medium text-muted-foreground hover:bg-muted/50">
                    Previous runs ({view.runs.length - 1})
                  </summary>
                  <div className="p-3 space-y-1">
                    {view.runs.slice(1).map((r) => (
                      <div key={r.id} className="text-xs flex items-center justify-between py-1 border-b last:border-b-0">
                        <span>{new Date(r.created_at).toLocaleString()}</span>
                        <span className="text-muted-foreground">{r.call_type} · {r.summary.signalUpdateCount} updates · NBA: {r.summary.nextAction}</span>
                      </div>
                    ))}
                  </div>
                </details>
              )}
            </>
          )}

          {/* Fact find (existing) — always at the bottom when available */}
          {view?.investorState && (view.investorState.practical_problem || view.investorState.desired_outcome || view.investorState.decision_stakeholders) && (
            <Card>
              <CardContent className="py-3 space-y-1.5 text-sm">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Fact find</p>
                {view.investorState.practical_problem && (
                  <p><span className="text-muted-foreground">Problem:</span> {view.investorState.practical_problem}</p>
                )}
                {view.investorState.desired_outcome && (
                  <p><span className="text-muted-foreground">Outcome:</span> {view.investorState.desired_outcome}</p>
                )}
                {view.investorState.decision_stakeholders && (
                  <p><span className="text-muted-foreground">Stakeholders:</span> {view.investorState.decision_stakeholders}</p>
                )}
              </CardContent>
            </Card>
          )}

          {/* ============================================================
              REVIEW ACTIONS — Phase 4.7
              Hand to Closer / bounce back. Only shown when there IS a
              review to act on. The dialog itself is rendered outside
              the main scroll area so it overlays the drawer cleanly.
            ============================================================ */}
          {reviewBundle?.review && (
            <div className="flex gap-2 border-t border-border pt-3">
              {/* Primary action: agent → closer. */}
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5 flex-1"
                onClick={() => openHandOff("to_closer")}
              >
                <UserPlus className="w-3.5 h-3.5" />
                Hand to closer
              </Button>
              {/* Bounce back appears only when this review has already been
                  handed from someone else (banner present) — so a closer
                  viewing Marie's handoff can bounce it back with a note. */}
              {reviewBundle.handedFrom && (
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5 flex-1"
                  onClick={() => openHandOff("to_agent")}
                >
                  <CornerUpLeft className="w-3.5 h-3.5" />
                  Bounce back
                </Button>
              )}
            </div>
          )}

          {conversationId && (
            <Button variant="ghost" size="sm" className="w-full text-xs gap-1" asChild>
              <a href={`/api/aircall/webhook-log#conv-${conversationId}`} target="_blank" rel="noreferrer">
                <FileText className="w-3 h-3" /> View full transcript
              </a>
            </Button>
          )}
        </div>

        {/* ============================================================
            HAND-OFF DIALOG — Phase 4.7
            Agent picks a closer (or bouncing back — any user picker);
            adds an optional context note; submits.
          ============================================================ */}
        <Dialog open={handOffOpen} onOpenChange={setHandOffOpen}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>
                {handOffDirection === "to_closer" ? "Hand to closer" : "Bounce back"}
              </DialogTitle>
              <DialogDescription>
                {handOffDirection === "to_closer"
                  ? "Send this outcome to a closer. They'll see your note and the full engine output."
                  : "Send this outcome back with a note explaining what needs the original agent's attention."}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-3 py-1">
              <div className="space-y-1.5">
                <label className="text-sm font-medium">
                  {handOffDirection === "to_closer" ? "Closer" : "Recipient"}
                  <span className="text-destructive ml-0.5">*</span>
                </label>
                <Select value={handOffTargetId} onValueChange={setHandOffTargetId}>
                  <SelectTrigger>
                    <SelectValue placeholder={`Select ${handOffDirection === "to_closer" ? "closer" : "user"}…`} />
                  </SelectTrigger>
                  <SelectContent>
                    {handOffTargets.length === 0 ? (
                      <SelectItem value="__none__" disabled>
                        No eligible users
                      </SelectItem>
                    ) : handOffTargets.map(t => (
                      <SelectItem key={t.id} value={t.id}>
                        {t.name ?? t.email}
                        {t.role === "admin" && <span className="opacity-60 ml-1">(admin)</span>}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <label className="text-sm font-medium">Context note (optional)</label>
                <Textarea
                  value={handOffNote}
                  onChange={e => setHandOffNote(e.target.value)}
                  placeholder="Anything the recipient should know — e.g. 'They specifically asked about BPR — prep the BPR Explainer angle'"
                  rows={4}
                />
                <p className="text-[11px] text-muted-foreground">
                  Shown to the recipient as a banner at the top of the drawer when they open this outcome.
                </p>
              </div>

              {handOffError && (
                <p className="text-sm text-destructive">{handOffError}</p>
              )}
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setHandOffOpen(false)} disabled={handOffSubmitting}>
                Cancel
              </Button>
              <Button onClick={submitHandOff} disabled={handOffSubmitting || !handOffTargetId}>
                {handOffSubmitting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                {handOffDirection === "to_closer" ? "Hand over" : "Send back"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </SheetContent>
    </Sheet>
  );
}
