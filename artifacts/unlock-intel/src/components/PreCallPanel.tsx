// Phase 5 — Pre-call Intelligence Panel.
//
// Replaces the empty "Call Prep" card on Call Command. Pulls engine
// intelligence for the contact the operator is about to call (or has
// loaded for preview) and surfaces it as pre-call context.
//
// Purpose — close the asymmetry:
//   - Post-call: rich intelligence via the Outcome Drawer + /outcomes
//   - Pre-call: EMPTY before this panel. Operators started every
//     follow-up blind.
//
// What this shows (when intelligence exists):
//   - Who (persona + hot button + demo score) and last outcome
//   - Fact-find summary: problem / outcome / stakeholders — in the
//     investor's own words from prior calls
//   - Verbatim phrases — distinctive language for the opener
//   - Questions to ask on THIS call — filtered from QUESTION_REGISTRY
//     by the inferred next-call number AND prioritised toward signals
//     still amber/grey (where movement is needed)
//   - Signal state overview (compact)

import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Loader2, Target, Brain, Sparkles, Quote, ArrowRight, Headphones,
  MessageCircle, Users, FileText, ListChecks, AlertTriangle,
  Monitor, Clock, Shield,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { apiFetch } from "@/lib/apiClient";

const API_BASE = (import.meta.env.BASE_URL?.replace(/\/$/, "") || "") + "/api";

// ============================================================================
// Types — mirror server-side shapes
// ============================================================================

interface InvestorState {
  id: string;
  persona: string;
  hot_button: string | null;
  demo_score: number | null;
  practical_problem: string | null;
  current_pressure: string | null;
  personal_angle: string | null;
  desired_outcome: string | null;
  decision_stakeholders: string | null;
  exact_phrases: string[] | null;
  questions_for_call3: string | null;
}
interface EngineSignal {
  id: string; code: string; state: string; evidence: string | null; confidence: string; updated_at: string;
}
interface EngineRunSummary {
  id: string; call_type: string; engine_version: string; created_at: string;
  summary: {
    persona: string; hotButton: string | null; signalUpdateCount: number; nextAction: string;
    c4Compliance: string; pack1: string; flags: number;
  };
}
interface EngineContactView {
  contactId: string;
  investorState: InvestorState | null;
  signals: EngineSignal[];
  transitions: any[];
  runs: EngineRunSummary[];
}
interface QuestionDef {
  qNum: number;
  text: string | null;
  call: 1 | 2 | 3;
  category: string;
  signal: string | null;
  gateRole: string | null;
  // Persona-specific variants — Q13 has different text per persona.
  // Resolver below picks the right one based on investor state.
  variants?: Record<string, { text: string; signal: string }> | null;
}
interface SignalDef {
  code: string;
  name: string;
  category: string;
  persona: string | null;
  priority: number;
  gateRole: string | null;
}
interface DemoSegmentDef {
  segment: number;
  name: string;
  durationMins: number;
  screenShare: boolean;
  signalsSurfaced: string[];
  alsoCaptures?: string[];
  captures?: string[];
  personaBeliefsSurfaced?: Record<string, string[]> | null;
  expectedOutcome: string | null;
  criticalGate: string | null;
  note: string | null;
  questionsUsed: number[];
}

const PERSONA_LABELS: Record<string, string> = {
  preserver: "The Preserver",
  growth_seeker: "The Growth Seeker",
  legacy_builder: "The Legacy Builder",
  undetermined: "Persona undetermined",
};

const STATE_COLORS: Record<string, string> = {
  green: "bg-green-500/15 text-green-700 border-green-500/30",
  amber: "bg-amber-500/15 text-amber-700 border-amber-500/30",
  red: "bg-red-500/15 text-red-700 border-red-500/30",
  grey: "bg-muted text-muted-foreground border-border",
  confirmed: "bg-green-500/15 text-green-700 border-green-500/30",
  not_confirmed: "bg-red-500/15 text-red-700 border-red-500/30",
  unknown: "bg-muted text-muted-foreground border-border",
};

// ============================================================================
// Component
// ============================================================================

interface Props {
  contactId: string | null;
  contactName?: string;
  /** Number of prior call_attempts on the contact row, used as a weak
   * signal for inferring next-call-number when no engine_runs exist. */
  callAttempts?: number;
  lastCallOutcome?: string | null;
}

export default function PreCallPanel({
  contactId, contactName, callAttempts, lastCallOutcome,
}: Props) {
  const [view, setView] = useState<EngineContactView | null>(null);
  const [questions, setQuestions] = useState<QuestionDef[]>([]);
  const [signalDefs, setSignalDefs] = useState<Map<string, SignalDef>>(new Map());
  const [demoSegments, setDemoSegments] = useState<DemoSegmentDef[]>([]);
  // Latest engine_run's full output — used to extract the engine's
  // previous recommendation (contentToSend) for the sub-header context.
  const [lastRunRecommendation, setLastRunRecommendation] = useState<{
    docName: string | null;
    actionType: string | null;
  } | null>(null);
  // Previous outcome review (if one exists for the latest run). Lets us:
  //   (1) link "Full engine output →" to the specific review page
  //   (2) warn if the previous review is still unfinalised
  //   (3) summarise what the operator approved / edited / rejected last time
  const [previousReview, setPreviousReview] = useState<{
    id: string;
    status: string;
    decisions: Array<{
      action_type: string;
      action_key: string;
      decision: string;
      edited_payload: any;
    }>;
  } | null>(null);
  const [loading, setLoading] = useState(false);

  // Fetch the engine view + registries on contact change.
  // Registries (questions, signals, demo segments) are cached across
  // contact switches — only fetched once.
  useEffect(() => {
    if (!contactId) { setView(null); setLastRunRecommendation(null); return; }
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const [vRes, qRes, sRes, dRes] = await Promise.all([
          apiFetch(`${API_BASE}/engine/contact/${contactId}`),
          questions.length === 0 ? apiFetch(`${API_BASE}/engine/config/questions`) : null,
          signalDefs.size === 0 ? apiFetch(`${API_BASE}/engine/config/signals`) : null,
          demoSegments.length === 0 ? apiFetch(`${API_BASE}/engine/config/demo-segments`) : null,
        ]);
        if (cancelled) return;
        let viewData: EngineContactView | null = null;
        if (vRes.ok) {
          viewData = await vRes.json();
          setView(viewData);
        }
        if (qRes && qRes.ok) {
          const qData = await qRes.json();
          setQuestions(qData.questions || []);
        }
        if (sRes && sRes.ok) {
          const sData = await sRes.json();
          const map = new Map<string, SignalDef>();
          for (const s of sData.signals || []) map.set(s.code, s);
          setSignalDefs(map);
        }
        if (dRes && dRes.ok) {
          const dData = await dRes.json();
          setDemoSegments(dData.segments || []);
        }

        // Second-pass: if we got a view with runs, pull the latest
        // engine_run's FULL output for the last-recommendation context,
        // and the associated outcome review (if one was created) for the
        // "what was done" summary + link-to-finalise banner.
        const latestRunId = viewData?.runs?.[0]?.id;
        if (latestRunId) {
          const [runRes, revRes] = await Promise.all([
            apiFetch(`${API_BASE}/engine/runs/${latestRunId}`),
            apiFetch(`${API_BASE}/outcome-reviews/by-run/${latestRunId}`),
          ]);
          if (!cancelled && runRes.ok) {
            const fullRun = await runRes.json();
            const nba = fullRun?.output?.nextBestAction;
            setLastRunRecommendation({
              docName: nba?.contentToSend?.docName ?? null,
              actionType: nba?.actionType ?? null,
            });
          }
          if (!cancelled && revRes.ok && revRes.status !== 204) {
            const bundle = await revRes.json();
            setPreviousReview({
              id: bundle.review.id,
              status: bundle.review.status,
              decisions: bundle.decisions ?? [],
            });
          } else if (!cancelled) {
            setPreviousReview(null);
          }
        } else {
          setLastRunRecommendation(null);
          setPreviousReview(null);
        }
      } catch { /* silent — panel falls back to empty state */ }
      finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contactId]);

  // Infer which call this is. The engine's latest run tells us the PRIOR
  // call's type; the next call usually advances one stage.
  //   no runs + call_attempts=0    → call 1 (cold_call)
  //   last run = cold_call         → call 2 (demo)
  //   last run = demo              → call 3 (opportunity)
  //   last run = opportunity       → call 3 (repeated)
  const nextCallNumber: 1 | 2 | 3 = useMemo(() => {
    const latest = view?.runs?.[0];
    if (!latest) return callAttempts && callAttempts > 0 ? 2 : 1;
    if (latest.call_type === "cold_call") return 2;
    if (latest.call_type === "demo") return 3;
    return 3;
  }, [view, callAttempts]);

  // Derive "questions to ask on this call".
  // Filter registry by call number, then prioritise:
  //   1. Gate-role questions (C4 compliance, etc.)
  //   2. Questions whose target signal is grey/unknown (never surfaced)
  //   3. Questions whose target signal is amber (needs progression)
  //   4. Drop questions where the signal is already green/confirmed
  //      (don't waste airtime on resolved signals)
  const questionsToAsk = useMemo(() => {
    if (questions.length === 0) return [];
    const signalByCode = new Map((view?.signals ?? []).map(s => [s.code, s]));
    const persona = view?.investorState?.persona ?? "undetermined";
    const scored = questions
      .filter(q => q.call === nextCallNumber)
      .map(q => {
        // Q13 + any future variant question: pick the persona-specific text
        // + signal. If persona isn't known yet, skip the variant (show the
        // question as narrative/generic).
        let text = q.text;
        let targetSignal = q.signal;
        if (q.variants && persona !== "undetermined" && q.variants[persona]) {
          text = q.variants[persona].text;
          targetSignal = q.variants[persona].signal;
        } else if (q.variants) {
          // Persona undetermined — we can't pick a variant. Skip the
          // question rather than showing a raw placeholder.
          return null;
        }
        const signal = targetSignal ? signalByCode.get(targetSignal) : null;
        const state = signal?.state ?? (targetSignal ? "grey" : "n_a");
        // priority 0 = highest
        let priority = 5;
        if (q.gateRole) priority = 1;
        else if (state === "grey" || state === "unknown" || state === "n_a") priority = 2;
        else if (state === "amber") priority = 3;
        else if (state === "green" || state === "confirmed") priority = 10; // deprioritise — already established
        else if (state === "red") priority = 4;
        return { q, resolvedText: text, resolvedSignal: targetSignal, state, priority };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null)
      .filter(x => x.priority < 10) // drop already-green/confirmed
      .sort((a, b) => a.priority - b.priority || a.q.qNum - b.q.qNum)
      .slice(0, 8);
    return scored;
  }, [questions, nextCallNumber, view]);

  // ==========================================================================
  // RENDER
  // ==========================================================================

  if (!contactId) {
    return (
      <div className="rounded-lg border border-border/50 bg-muted/30 p-4 text-sm">
        <p className="font-medium text-foreground mb-1 flex items-center gap-1.5">
          <Headphones className="w-4 h-4" /> Call Prep
        </p>
        <p className="text-muted-foreground">Load a contact to see pre-call intelligence.</p>
      </div>
    );
  }

  const hasIntel = !!view?.investorState
    || (view?.signals && view.signals.length > 0)
    || (view?.runs && view.runs.length > 0);

  if (loading && !hasIntel) {
    return (
      <div className="rounded-lg border border-border/50 bg-muted/30 p-4 text-sm flex items-center gap-2">
        <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
        <span className="text-muted-foreground">Loading pre-call intelligence…</span>
      </div>
    );
  }

  if (!hasIntel) {
    return (
      <div className="rounded-lg border border-border/50 bg-muted/30 p-4 text-sm space-y-1">
        <p className="font-medium text-foreground flex items-center gap-1.5">
          <Headphones className="w-4 h-4" /> Call Prep
        </p>
        <p className="text-muted-foreground">
          First call with {contactName ?? "this contact"} — no prior engine output yet. Use Call 1 cold-call questions.
        </p>
        {questions.length > 0 && (
          <QuestionList
            questions={questions.filter(q => q.call === 1).slice(0, 5).map(q => ({ q, state: "grey", priority: 2 }))}
          />
        )}
      </div>
    );
  }

  const state = view!.investorState;
  const signals = view!.signals;
  const runs = view!.runs;
  const persona = state?.persona ?? "undetermined";
  const hotButton = state?.hot_button;
  const lastRun = runs[0];
  const priorCallCount = runs.length;
  void signals; // signals surface per-question; no summary row (see footer)

  const callLabel = nextCallNumber === 1 ? "Call 1 · Cold call"
                 : nextCallNumber === 2 ? "Call 2 · Demo"
                 : "Call 3 · Opportunity";

  // Time-since-last-call — human-friendly duration. Shown in the sub-
  // header so operators have callback-timing context at a glance.
  const lastCallAgoLabel = (() => {
    if (!lastRun?.created_at) return null;
    const diffMs = Date.now() - new Date(lastRun.created_at).getTime();
    const mins = Math.round(diffMs / 60_000);
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.round(mins / 60);
    if (hrs < 48) return `${hrs}h ago`;
    const days = Math.round(hrs / 24);
    return `${days}d ago`;
  })();

  return (
    <div className="rounded-lg border border-border bg-card">
      {/* Header — call number + intelligence summary */}
      <div className="px-4 py-3 border-b border-border/50 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-md bg-primary/15 text-primary flex items-center justify-center shrink-0">
            <Brain className="w-4 h-4" />
          </div>
          <div>
            <p className="font-medium text-sm">Call Prep</p>
            <p className="text-xs text-muted-foreground">
              {callLabel}
              {priorCallCount > 0 && ` · ${priorCallCount} prior call${priorCallCount !== 1 ? "s" : ""}`}
              {lastCallAgoLabel && <> · last {lastCallAgoLabel}</>}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1.5 flex-wrap justify-end">
          {persona !== "undetermined" && (
            <Badge variant="outline" className="text-xs">{PERSONA_LABELS[persona] ?? persona}</Badge>
          )}
          {hotButton && (
            <Badge variant="outline" className="text-xs capitalize">{hotButton}</Badge>
          )}
          {state?.demo_score != null && state.demo_score > 0 && (
            <Badge variant="outline" className="text-xs">Demo {state.demo_score}</Badge>
          )}
          {lastCallOutcome && (
            <Badge variant="outline" className="text-xs">Last: {lastCallOutcome}</Badge>
          )}
        </div>
      </div>

      {/* Unfinalised-review banner — when the previous call produced a
          review that the operator hasn't worked through yet (or is still
          in progress). Prompts them to close the loop before the next
          call so outcomes don't stack up unresolved. */}
      {previousReview && (previousReview.status === "awaiting_review"
        || previousReview.status === "under_review"
        || previousReview.status === "handed_to_closer"
        || previousReview.status === "handed_to_agent") && (
        <div className="px-4 py-2 border-b border-amber-500/40 bg-amber-500/5 flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 text-xs text-amber-700">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
            <span>
              Previous outcome not finalised
              {previousReview.status === "handed_to_closer" && <> (handed to closer)</>}
              {previousReview.status === "handed_to_agent" && <> (bounced back)</>}
            </span>
          </div>
          <Link
            href={`/outcomes/${previousReview.id}`}
            className="text-xs text-amber-700 hover:text-foreground inline-flex items-center gap-0.5 font-medium"
          >
            Finalise <ArrowRight className="w-3 h-3" />
          </Link>
        </div>
      )}

      {/* Last-call recommendation reminder — when there's something the
          engine previously suggested sending, surface it here so the
          operator opens the new call with that context in mind. */}
      {lastRunRecommendation?.docName && (
        <div className="px-4 py-2 border-b border-border/50 text-xs flex items-center gap-1.5 text-muted-foreground">
          <FileText className="w-3.5 h-3.5" />
          <span>
            Engine previously recommended:{" "}
            <span className="font-medium text-foreground">{lastRunRecommendation.docName}</span>
          </span>
        </div>
      )}

      {/* "What was done last call" — summary of decisions from the
          previous outcome review. Gives the operator context on WHAT
          the prior outcome actually ended in (email approved? action
          rejected? Intelligence they still need to chase up?).
          Only rendered when decisions exist. */}
      {previousReview && previousReview.decisions.length > 0 && (
        <div className="px-4 py-2.5 border-b border-border/50 space-y-1.5">
          <div className="flex items-center gap-1.5">
            <ListChecks className="w-3.5 h-3.5 text-muted-foreground" />
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Previously actioned
            </p>
          </div>
          <ul className="space-y-0.5">
            {previousReview.decisions
              .filter(d => d.decision !== "deferred")
              .map((d, i) => {
                const label = decisionLabel(d.action_type, d.action_key, d.edited_payload);
                const verb = d.decision === "approved" ? "Approved"
                           : d.decision === "edited" ? "Edited"
                           : d.decision === "rejected" ? "Rejected"
                           : d.decision;
                const color = d.decision === "approved" ? "text-green-700"
                            : d.decision === "edited" ? "text-amber-700"
                            : d.decision === "rejected" ? "text-red-700"
                            : "text-muted-foreground";
                return (
                  <li key={i} className="text-xs flex items-start gap-1.5">
                    <span className={cn("font-medium shrink-0", color)}>{verb}:</span>
                    <span className="text-muted-foreground">{label}</span>
                  </li>
                );
              })}
          </ul>
          {/* Footnote: decisions are currently intent, not execution.
              Phase 7.5 wires actual sends. */}
          <p className="text-[10px] text-muted-foreground/70 italic pt-0.5">
            Decisions are recorded intent. Real send/schedule lands with Phase 7.5.
          </p>
        </div>
      )}

      {/* Demo agenda — shown when the NEXT call is a demo. The 6-segment
          DEMO_SEGMENTS config is the structure; duration sums to ~47
          minutes. Critical gate annotations (e.g. "C4 must be green before
          segment 3") surface inline. */}
      {nextCallNumber === 2 && demoSegments.length > 0 && (
        <div className="px-4 py-3 border-b border-border/50 space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <Monitor className="w-3.5 h-3.5 text-primary" />
              <p className="text-xs font-semibold uppercase tracking-wider text-primary">
                Demo agenda
              </p>
            </div>
            <span className="text-[10px] text-muted-foreground">
              {demoSegments.reduce((sum, s) => sum + s.durationMins, 0)} min total
            </span>
          </div>
          <ol className="space-y-1.5">
            {demoSegments.map(seg => {
              // Which signals from this segment are still grey/amber —
              // so the operator sees where this segment is ESSENTIAL.
              const signalByCode = new Map((view?.signals ?? []).map(s => [s.code, s]));
              const personaCluster = persona !== "undetermined"
                ? (seg.personaBeliefsSurfaced?.[persona] ?? [])
                : [];
              const allSignals = [...seg.signalsSurfaced, ...personaCluster];
              const unresolved = allSignals.filter(code => {
                const st = signalByCode.get(code)?.state;
                return !st || st === "grey" || st === "amber" || st === "unknown";
              });
              return (
                <li key={seg.segment} className="flex items-start gap-2 text-xs leading-tight">
                  <span className="font-mono text-muted-foreground shrink-0 w-6 text-right">
                    {seg.segment}.
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="font-medium text-sm">{seg.name}</span>
                      <Badge variant="outline" className="text-[10px]">
                        <Clock className="w-2.5 h-2.5 mr-0.5" /> {seg.durationMins}m
                      </Badge>
                      {seg.screenShare && (
                        <Badge variant="outline" className="text-[10px]">
                          <Monitor className="w-2.5 h-2.5 mr-0.5" /> share
                        </Badge>
                      )}
                      {seg.criticalGate && (
                        <Badge variant="outline" className="text-[10px] bg-red-500/10 text-red-700 border-red-500/30">
                          <Shield className="w-2.5 h-2.5 mr-0.5" /> gate
                        </Badge>
                      )}
                    </div>
                    {allSignals.length > 0 && (
                      <p className="text-[10px] text-muted-foreground mt-0.5">
                        Surfaces: {allSignals.map(code => {
                          const name = signalDefs.get(code)?.name ?? code;
                          const st = signalByCode.get(code)?.state;
                          const isUnresolved = unresolved.includes(code);
                          return (
                            <span
                              key={code}
                              className={cn(
                                "mr-1.5",
                                isUnresolved ? "font-medium text-foreground" : "opacity-60"
                              )}
                            >
                              {name}{st && st !== "grey" ? ` (${st})` : ""}
                            </span>
                          );
                        })}
                      </p>
                    )}
                    {seg.criticalGate && (
                      <p className="text-[10px] text-red-700 mt-0.5">
                        <AlertTriangle className="w-2.5 h-2.5 inline mr-0.5" />
                        {seg.criticalGate}
                      </p>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        </div>
      )}

      {/* Questions to ask on THIS call — headline section */}
      {questionsToAsk.length > 0 && (
        <div className="px-4 py-3 border-b border-border/50 space-y-2">
          <div className="flex items-center gap-1.5">
            <Target className="w-3.5 h-3.5 text-primary" />
            <p className="text-xs font-semibold uppercase tracking-wider text-primary">
              Questions to ask on this call
            </p>
          </div>
          <ul className="space-y-1.5">
            {questionsToAsk.map(({ q, resolvedText, resolvedSignal, state: sigState, priority }) => {
              const signalName = resolvedSignal ? (signalDefs.get(resolvedSignal)?.name ?? null) : null;
              return (
                <li key={q.qNum} className="flex items-start gap-2 text-sm leading-tight">
                  <span className={cn(
                    "mt-1.5 inline-block w-1.5 h-1.5 rounded-full shrink-0",
                    priority === 1 ? "bg-red-500"
                    : priority === 2 ? "bg-amber-500"
                    : priority === 3 ? "bg-blue-500"
                    : "bg-muted-foreground/50",
                  )} />
                  <div className="flex-1 min-w-0">
                    <p>{resolvedText ?? <span className="italic text-muted-foreground">(narrative prompt)</span>}</p>
                    {resolvedSignal && (
                      <p className="text-[10px] text-muted-foreground mt-0.5">
                        {signalName ? (
                          <span>
                            Moves <span className="font-medium">{signalName}</span>
                            {sigState && <span className="ml-1 opacity-70">({sigState})</span>}
                          </span>
                        ) : (
                          <span>Q{q.qNum}</span>
                        )}
                        {q.gateRole && <span className="ml-1.5 font-semibold text-red-700">· GATE</span>}
                      </p>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* Fact-find summary — what we know about them */}
      {state && (state.practical_problem || state.desired_outcome || state.decision_stakeholders || (state.exact_phrases?.length ?? 0) > 0) && (
        <div className="px-4 py-3 border-b border-border/50 space-y-2">
          <div className="flex items-center gap-1.5">
            <FileText className="w-3.5 h-3.5 text-muted-foreground" />
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              What we know
            </p>
          </div>
          <div className="space-y-1.5 text-sm">
            {state.practical_problem && (
              <FactLine label="Problem" value={state.practical_problem} />
            )}
            {state.desired_outcome && (
              <FactLine label="Outcome" value={state.desired_outcome} />
            )}
            {state.decision_stakeholders && (
              <FactLine label="Stakeholders" value={state.decision_stakeholders} />
            )}
            {state.personal_angle && (
              <FactLine label="Angle" value={state.personal_angle} />
            )}
          </div>
          {(state.exact_phrases?.length ?? 0) > 0 && (
            <div className="space-y-1 pt-1">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wide flex items-center gap-1">
                <Quote className="w-3 h-3" /> Their words
              </p>
              <ul className="space-y-0.5">
                {state.exact_phrases!.slice(0, 3).map((p, i) => (
                  <li key={i} className="text-xs italic text-muted-foreground leading-snug pl-2 border-l-2 border-primary/30">
                    "{p}"
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* Signal state is already surfaced per-question in "Questions to
          ask" — each question shows the signal it moves + current state.
          A summary count row added nothing actionable, so it's dropped.
          Deeper signal detail is a click away on the outcome page. */}
      {lastRun && (
        <div className="px-4 py-2 border-t border-border/50 flex items-center justify-end text-xs">
          <Link
            href={previousReview?.id ? `/outcomes/${previousReview.id}` : "/outcomes"}
            className="text-muted-foreground hover:text-foreground inline-flex items-center gap-0.5"
          >
            Full engine output <ArrowRight className="w-3 h-3" />
          </Link>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Sub-components
// ============================================================================

// Humanise a decision row for the "Previously actioned" summary.
// The engine tags decisions by action_type + action_key; we translate
// those into plain-language labels the operator recognises.
function decisionLabel(actionType: string, actionKey: string, editedPayload: any): string {
  switch (actionType) {
    case "nba":
      return "Next best action";
    case "email":
      if (editedPayload?.subject) {
        return `Email: "${String(editedPayload.subject).slice(0, 60)}"`;
      }
      return "Email draft";
    case "book2":
      return "Book 2 routing";
    case "post_close_item":
      // action_key shape: "post_close:0:action text snippet"
      return `Post-close: ${actionKey.split(":").slice(2).join(":").slice(0, 60)}`;
    case "adviser_loop_item":
      // action_key shape: "adviser_loop:pre_call:0:action text snippet"
      const parts = actionKey.split(":");
      const phase = parts[1];
      const phaseLabel = phase === "pre_call" ? "Pre-call" : phase === "during_call" ? "During call" : "Post-call";
      return `Adviser ${phaseLabel}: ${parts.slice(3).join(":").slice(0, 60)}`;
    default:
      return `${actionType}: ${actionKey.slice(0, 60)}`;
  }
}

function FactLine({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="text-[10px] uppercase tracking-wide text-muted-foreground mr-1.5">{label}</span>
      <span className="text-sm">{value}</span>
    </div>
  );
}

function QuestionList({ questions }: { questions: Array<{ q: QuestionDef; state: string; priority: number }> }) {
  return (
    <ul className="mt-2 space-y-1">
      {questions.map(({ q, priority }) => (
        <li key={q.qNum} className="flex items-start gap-2 text-xs">
          <span className={cn(
            "mt-1 inline-block w-1.5 h-1.5 rounded-full shrink-0",
            priority === 1 ? "bg-red-500" : priority === 2 ? "bg-amber-500" : "bg-muted-foreground/50",
          )} />
          <span>{q.text ?? <span className="italic text-muted-foreground">(narrative prompt)</span>}</span>
        </li>
      ))}
    </ul>
  );
}
