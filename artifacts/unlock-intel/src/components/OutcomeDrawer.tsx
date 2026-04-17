// Post-call outcome drawer. Slides in from the right when a call finishes.
// Shows the intelligence engine's output: Call Objectives for the next call
// (always leads), outcome tag, persona, hot button, signal changes, questions,
// qualification gates, content gates, demo coverage, NBA, email draft,
// post-close checklist, adviser loop, flags.
//
// Data source: /api/engine/contact/:id (engine view) + /api/engine/runs/:id
// (full output) + /api/engine/config/questions (question registry, cached).
//
// Phase 4.6 — Bucket 1 only:
//   - Display only; no approve/edit/reject controls (4.7 territory)
//   - Call Objectives block derived client-side until Phase 4.5a moves
//     derivation into the engine output contract
//   - Data we don't yet produce (verbatim provenance, anchor phrase,
//     transcript prohibited-phrase detection) is NOT rendered; those land
//     with Phase 4.5a

import { useEffect, useMemo, useState } from "react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  Loader2, AlertCircle, ArrowRight, FileText, Send, SkipForward, Clock,
  Target, CheckCircle2, XCircle, MinusCircle, AlertTriangle, Mail,
  ListChecks, Users, Sparkles,
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
  const [loading, setLoading] = useState(false);
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
        } else {
          setFullRun(null);
        }
      } catch (err: any) {
        if (!cancelled) setError(err.message || "Failed to load");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [open, contactId, conversationId, refreshTick]);

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
                    <div className="flex gap-2 pt-1">
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
                    <div className="space-y-1.5">
                      {postCloseActions.map((a, i) => (
                        <div key={i} className="flex items-start gap-2 text-sm border-b border-border/50 last:border-b-0 pb-1.5 last:pb-0">
                          <CheckCircle2 className="w-3.5 h-3.5 text-green-600 mt-0.5 shrink-0 opacity-60" />
                          <div className="flex-1 min-w-0">
                            <p className="font-medium">{a.action}</p>
                            <p className="text-xs text-muted-foreground">
                              {a.owner} · {a.timing}
                            </p>
                            {a.detail && <p className="text-xs text-muted-foreground/90 mt-0.5">{a.detail}</p>}
                          </div>
                        </div>
                      ))}
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
                        <div key={phase} className="space-y-1">
                          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{phaseLabel}</p>
                          {group.actions.map((a, i) => (
                            <div key={i} className="flex items-start gap-2 text-sm pl-2">
                              <Sparkles className="w-3 h-3 text-purple-500 mt-1 shrink-0" />
                              <div className="flex-1 min-w-0">
                                <p>{a.action}</p>
                                <p className="text-[10px] text-muted-foreground">{a.owner} · {a.timing}</p>
                                {a.detail && <p className="text-xs text-muted-foreground/90 mt-0.5">{a.detail}</p>}
                              </div>
                            </div>
                          ))}
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

          {conversationId && (
            <Button variant="ghost" size="sm" className="w-full text-xs gap-1" asChild>
              <a href={`/api/aircall/webhook-log#conv-${conversationId}`} target="_blank" rel="noreferrer">
                <FileText className="w-3 h-3" /> View full transcript
              </a>
            </Button>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
