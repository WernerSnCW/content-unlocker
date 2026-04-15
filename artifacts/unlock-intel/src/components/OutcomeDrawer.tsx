// Post-call outcome drawer. Slides in from the right when a call finishes.
// Shows the intelligence engine's output: persona, hot button, signal changes,
// next best action, gates, flags.
//
// Data source: /api/engine/contact/:id — populated by the backend after
// call.tagged processes the transcript through the engine. Auto-refreshes via
// the parent page's SSE subscription (the drawer just reflects parent state).

import { useEffect, useState } from "react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Loader2, AlertCircle, CheckCircle2, ArrowRight, FileText, Send, SkipForward, Clock } from "lucide-react";

const API_BASE = (import.meta.env.BASE_URL?.replace(/\/$/, "") || "") + "/api";

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
  output: any; // EngineOutput JSON
}

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

interface Props {
  open: boolean;
  contactId: string | null;
  contactName: string | null;
  conversationId: string | null;
  onClose: () => void;
  onSkip?: () => void;
}

export default function OutcomeDrawer({ open, contactId, contactName, conversationId, onClose, onSkip }: Props) {
  const [view, setView] = useState<EngineContactView | null>(null);
  const [fullRun, setFullRun] = useState<FullRun | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);

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
        // If we have runs, pull the full output of the most recent one that
        // matches this conversation (or just the newest run).
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
  const flags: { type: string; message: string }[] = output?.flags || [];
  const signalUpdates: { code: string; previousState: string; newState: string; evidence: string; confidence: string }[] = output?.signalUpdates || [];
  const persona = view?.investorState?.persona || output?.personaAssessment?.persona || "undetermined";
  const personaConfidence = view?.investorState?.persona_confidence || output?.personaAssessment?.confidence;
  const hotButton = view?.investorState?.hot_button || output?.hotButton?.primary;
  const grouped = groupSignalsByCategory(view?.signals || []);

  return (
    <Sheet open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent side="right" className="sm:max-w-[520px] w-full overflow-y-auto">
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
              {/* Persona + hot button */}
              <div className="flex flex-wrap gap-2">
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
              </div>

              {/* Signal changes this call */}
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

              {/* Gates */}
              {gates && (
                <Card>
                  <CardContent className="py-3 space-y-1.5 text-sm">
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">Gates</p>
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
                    {gates.pack1 === "blocked" && gates.pack1BlockedReasons?.length > 0 && (
                      <p className="text-xs text-muted-foreground pl-2">
                        {gates.pack1BlockedReasons.join(", ")}
                      </p>
                    )}
                  </CardContent>
                </Card>
              )}

              {/* Next best action */}
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
                        <div className="space-y-1">
                          <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            <FileText className="w-3 h-3" />
                            <span>Document {nba.contentToSend.docId}: {nba.contentToSend.docName}</span>
                          </div>
                          {nba.contentToSend.coverNoteDraft && (
                            <div className="mt-1 p-2 bg-muted/50 rounded text-xs whitespace-pre-wrap font-mono leading-relaxed">
                              {nba.contentToSend.coverNoteDraft}
                            </div>
                          )}
                        </div>
                      </>
                    )}
                    <div className="flex gap-2 pt-1">
                      <Button
                        size="sm"
                        className="gap-1"
                        disabled
                        title="Sending requires Pipedrive integration (Phase 8)"
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

              {/* Flags */}
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

              {/* Full signal grid (collapsed below the fold) */}
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

          {view?.investorState && (view.investorState.practical_problem || view.investorState.desired_outcome) && (
            <Card>
              <CardContent className="py-3 space-y-1.5 text-sm">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Fact find</p>
                {view.investorState.practical_problem && (
                  <p><span className="text-muted-foreground">Problem:</span> {view.investorState.practical_problem}</p>
                )}
                {view.investorState.desired_outcome && (
                  <p><span className="text-muted-foreground">Outcome:</span> {view.investorState.desired_outcome}</p>
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
