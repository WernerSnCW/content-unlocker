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
  const [loading, setLoading] = useState(false);

  // Fetch the engine view + question/signal registries on contact change.
  // Registries are cached across contact switches — only fetched once.
  useEffect(() => {
    if (!contactId) { setView(null); return; }
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const [vRes, qRes, sRes] = await Promise.all([
          apiFetch(`${API_BASE}/engine/contact/${contactId}`),
          questions.length === 0 ? apiFetch(`${API_BASE}/engine/config/questions`) : null,
          signalDefs.size === 0 ? apiFetch(`${API_BASE}/engine/config/signals`) : null,
        ]);
        if (cancelled) return;
        if (vRes.ok) setView(await vRes.json());
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
            <p className="text-xs text-muted-foreground">{callLabel}{priorCallCount > 0 && ` · ${priorCallCount} prior call${priorCallCount !== 1 ? "s" : ""}`}</p>
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
          <Link href={`/outcomes`} className="text-muted-foreground hover:text-foreground inline-flex items-center gap-0.5">
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
