// Phase 4.8 session 3 — Outcome detail page, redesigned.
//
// Philosophy (per Werner's 2026-04-20 feedback):
//   - This page is the WORKSPACE, not a bigger drawer.
//   - Split surfaces by PURPOSE: actions you take (workspace) vs evidence
//     the engine produced (reference).
//   - Actions are primary, visible without scrolling past reference.
//   - Engine recommends ONE of everything by default; operators can
//     layer on top — add attachments, override timing, add notes.
//
// Layout:
//   [Header]          contact + outcome tag + status + admin reclaim
//   [Handoff banner]  when review was handed from another user
//   [Workspace]       email editor + attachments + follow-up + notes
//                     + post-close + adviser loop + book 2
//   [Reference]       collapsed accordions for intelligence evidence
//   [History]         collapsed accordions for decision + handoff trail

import { useEffect, useMemo, useState } from "react";
import { Link, useRoute, useLocation } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Loader2, AlertCircle, AlertTriangle, ArrowLeft, ArrowRight, CheckCircle2,
  X as XIcon, Clock, FileText, Mail, UserPlus, CornerUpLeft,
  ListChecks, Users, Sparkles, Edit3, Save, RotateCcw, Undo2, Check, History,
  ShieldAlert, Calendar as CalendarIcon, StickyNote, Plus, Target, Brain, HelpCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { apiFetch } from "@/lib/apiClient";

const API_BASE = (import.meta.env.BASE_URL?.replace(/\/$/, "") || "") + "/api";

// ============================================================================
// Types
// ============================================================================

type ActionType = "nba" | "email" | "post_close_item" | "adviser_loop_item" | "book2";
type ActionDecision = "approved" | "edited" | "rejected" | "deferred";

interface EngineSignalRow {
  id: string; code: string; state: string; evidence: string | null; confidence: string; updated_at: string;
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
  current_pressure: string | null;
  personal_angle: string | null;
  desired_outcome: string | null;
  portfolio_shape: string | null;
  annual_tax_liability: string | number | null;
  decision_stakeholders: string | null;
  questions_for_call3: string | null;
  exact_phrases: string[] | null;
  decision_style: string;
  book_track: string | null;
}
interface ReviewRow {
  id: string; engine_run_id: string; contact_id: string;
  current_owner_user_id: string | null;
  status: string;
  handed_from_user_id: string | null;
  hand_note: string | null; handed_at: string | null;
  claimed_at: string | null; resolved_at: string | null; resolution_notes: string | null;
  created_at: string; updated_at: string;
}
interface DecisionRow {
  id: string; outcome_review_id: string; engine_run_id: string;
  action_type: ActionType; action_key: string;
  decision: ActionDecision;
  edited_payload: any | null;
  decided_by_user_id: string; decided_at: string;
}
interface UserRef { id: string; name: string | null; email: string; }
interface ReviewBundle {
  review: ReviewRow; decisions: DecisionRow[];
  currentOwner: UserRef | null; handedFrom: UserRef | null;
  // Added in Phase 4.8 session 4 — server pre-joins for the header
  contact: {
    id: string; first_name: string; last_name: string;
    email: string | null; phone: string | null; company: string | null;
    last_call_outcome: string | null;
  } | null;
  outcomeTag: string | null;
}
interface EngineOutput {
  engineVersion: string; processedAt: string; callType: string;
  signalUpdates?: Array<{ code: string; previousState: string; newState: string; evidence: string; confidence: string }>;
  personaAssessment?: { persona: string; confidence?: string; evidence?: string };
  hotButton?: { primary?: string | null; evidence?: string };
  gateStatus?: { c4Compliance: string; pack1: string; pack1BlockedReasons?: string[] };
  nextBestAction?: {
    actionType?: string; detail?: string; owner?: string; timing?: string;
    contentToSend?: { docId: number; docName: string; coverNoteDraft?: string };
  };
  flags?: Array<{ type: string; message: string }>;
  questionsDetected?: Array<{ questionNumber: number; detected: boolean; signalTarget: string | null; investorResponse: string | null; inferredSignalState: string | null; confidence: string }>;
  demoSegmentAnalysis?: Array<{ segment: number; segmentName: string; covered: boolean; signalOutcomes: { code: string; state: string }[]; skipped: boolean; skipReason: string | null }> | null;
  emailDraft?: {
    templateId: string; subject: string; body: string;
    attachmentDocId: number | null; attachmentDocName: string | null;
    coverNoteAngle: string | null; personalisationSources: string[];
    complianceCheck: { passed: boolean; violations: string[] }; timing: string;
  } | null;
  postCloseActions?: Array<{ action: string; owner: string; timing: string; detail?: string }> | null;
  adviserLoopActions?: Array<{ phase: "pre_call" | "during_call" | "post_call"; actions: Array<{ action: string; owner: string; timing: string; detail?: string }> }> | null;
  book2Routing?: { triggered: boolean; reason: string; actions: string[] } | null;
}
interface EngineContactView {
  contactId: string;
  investorState: InvestorState | null;
  signals: EngineSignalRow[];
  transitions: any[];
  runs: Array<{ id: string; call_type: string; engine_version: string; created_at: string; conversation_id: string | null }>;
}
interface ContactRow {
  id: string; first_name: string; last_name: string;
  email: string | null; phone: string | null; company: string | null;
  last_call_outcome?: string | null;
}
interface DocOption {
  docId: number;
  docName: string;
  usedFor?: string[];
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
const stateClasses = (s: string) => STATE_COLORS[s] || STATE_COLORS.grey;

const PERSONA_LABELS: Record<string, string> = {
  preserver: "The Preserver",
  growth_seeker: "The Growth Seeker",
  legacy_builder: "The Legacy Builder",
  undetermined: "Undetermined",
};
const STATUS_LABELS: Record<string, string> = {
  awaiting_review: "Awaiting review",
  under_review: "Under review",
  handed_to_closer: "Handed to closer",
  handed_to_agent: "Bounced back",
  actioned: "Actioned",
  stale_escaped: "Stale",
};
const OUTCOME_COLORS: Record<string, string> = {
  "EIS-QUALIFIED": "bg-green-500/15 text-green-700 border-green-500/40",
  "LONG-HORIZON":  "bg-amber-500/15 text-amber-700 border-amber-500/40",
  "INTERMEDIARY":  "bg-blue-500/15 text-blue-700 border-blue-500/40",
  "CLOUDWORKZ":    "bg-purple-500/15 text-purple-700 border-purple-500/40",
  "CLOSED":        "bg-slate-500/15 text-slate-700 border-slate-500/40",
};

// ============================================================================
// Page
// ============================================================================

export default function OutcomeDetailPage() {
  const [, params] = useRoute("/outcomes/:id");
  const reviewId = params?.id ?? null;
  const { data: currentUser } = useCurrentUser();
  const role = String(currentUser?.user?.role ?? "agent");
  const isAdmin = role === "admin";

  const [bundle, setBundle] = useState<ReviewBundle | null>(null);
  const [view, setView] = useState<EngineContactView | null>(null);
  const [output, setOutput] = useState<EngineOutput | null>(null);
  const [availableDocs, setAvailableDocs] = useState<DocOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [decidingKey, setDecidingKey] = useState<string | null>(null);

  const load = async () => {
    if (!reviewId) return;
    setLoading(true);
    setError(null);
    try {
      const rRes = await apiFetch(`${API_BASE}/outcome-reviews/${reviewId}`);
      if (!rRes.ok) throw new Error(`Review load failed: HTTP ${rRes.status}`);
      const b: ReviewBundle = await rRes.json();
      setBundle(b);

      const [vRes, runRes, docsRes] = await Promise.all([
        apiFetch(`${API_BASE}/engine/contact/${b.review.contact_id}`),
        apiFetch(`${API_BASE}/engine/runs/${b.review.engine_run_id}`),
        apiFetch(`${API_BASE}/engine/config/documents`),
      ]);

      if (vRes.ok) setView(await vRes.json());
      if (runRes.ok) {
        const full = await runRes.json();
        setOutput(full.output);
      }
      if (docsRes.ok) {
        const docData = await docsRes.json();
        setAvailableDocs(docData.documents || []);
      }
    } catch (err: any) {
      setError(err?.message || "Failed to load outcome");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [reviewId]);

  const submitDecision = async (
    actionType: ActionType, actionKey: string, decision: ActionDecision, editedPayload?: any,
  ) => {
    if (!bundle?.review.id) return;
    const rowKey = `${actionType}:${actionKey}`;
    setDecidingKey(rowKey);
    try {
      const res = await apiFetch(`${API_BASE}/outcome-reviews/${bundle.review.id}/decisions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action_type: actionType, action_key: actionKey, decision, edited_payload: editedPayload ?? null }),
      });
      if (res.ok) {
        const rRes = await apiFetch(`${API_BASE}/outcome-reviews/${bundle.review.id}`);
        if (rRes.ok) setBundle(await rRes.json());
      }
    } catch { /* silent */ }
    finally { setDecidingKey(null); }
  };

  // Admin reclaim
  const [reclaimTargetId, setReclaimTargetId] = useState<string>("");
  const [reclaimUsers, setReclaimUsers] = useState<Array<{ id: string; name: string | null; email: string; role: string }>>([]);
  useEffect(() => {
    if (!isAdmin) return;
    (async () => {
      try {
        const res = await apiFetch(`${API_BASE}/users/closers`);
        if (res.ok) setReclaimUsers((await res.json()).closers || []);
      } catch { /* ignore */ }
    })();
  }, [isAdmin]);
  const submitReclaim = async () => {
    if (!bundle?.review.id) return;
    const to = reclaimTargetId === "__unclaim__" ? null : reclaimTargetId || null;
    try {
      const res = await apiFetch(`${API_BASE}/outcome-reviews/${bundle.review.id}/reclaim`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to_user_id: to }),
      });
      if (res.ok) await load();
    } catch { /* ignore */ }
  };

  // Notes — save independently of actioning
  const [notes, setNotes] = useState("");
  const [notesDirty, setNotesDirty] = useState(false);
  const [notesSaving, setNotesSaving] = useState(false);
  useEffect(() => {
    if (bundle?.review.resolution_notes != null) {
      setNotes(bundle.review.resolution_notes || "");
      setNotesDirty(false);
    }
  }, [bundle?.review?.id]);
  const saveNotes = async () => {
    if (!bundle?.review.id) return;
    setNotesSaving(true);
    try {
      const res = await apiFetch(`${API_BASE}/outcome-reviews/${bundle.review.id}/notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes: notes || null }),
      });
      if (res.ok) {
        setNotesDirty(false);
        await load();
      }
    } finally { setNotesSaving(false); }
  };

  // Derived
  const decisionByKey = useMemo(() => {
    const m = new Map<string, DecisionRow>();
    if (bundle?.decisions) for (const d of bundle.decisions) m.set(`${d.action_type}:${d.action_key}`, d);
    return m;
  }, [bundle]);

  const persona = view?.investorState?.persona || output?.personaAssessment?.persona || "undetermined";
  const hotButton = view?.investorState?.hot_button || output?.hotButton?.primary;
  const outcomeTag = bundle?.outcomeTag ?? null;
  const contact = bundle?.contact ?? null;

  // ==========================================================================
  // RENDER
  // ==========================================================================

  if (loading) {
    return (
      <div className="max-w-6xl mx-auto py-12 text-center text-muted-foreground">
        <Loader2 className="w-6 h-6 animate-spin mx-auto" />
      </div>
    );
  }

  if (error || !bundle || !reviewId) {
    return (
      <div className="max-w-6xl mx-auto space-y-4">
        <Link href="/outcomes" className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
          <ArrowLeft className="w-4 h-4" /> Back to outcomes
        </Link>
        <Card className="border-destructive/30 bg-destructive/5">
          <CardContent className="py-4 text-sm text-destructive flex items-center gap-2">
            <AlertCircle className="w-4 h-4" /> {error || "Outcome not found"}
          </CardContent>
        </Card>
      </div>
    );
  }

  const r = bundle.review;
  const contactName = contact
    ? `${contact.first_name ?? ""} ${contact.last_name ?? ""}`.trim() || "Contact"
    : "Contact";

  return (
    <div className="max-w-6xl mx-auto space-y-5 pb-16">
      {/* ======================================================================
          HEADER — outcome tag is the lead visual.
      ====================================================================== */}
      <div className="space-y-2">
        <Link href="/outcomes" className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
          <ArrowLeft className="w-4 h-4" /> Back to outcomes
        </Link>
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="space-y-1">
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-3xl font-bold tracking-tight">{contactName}</h1>
              {outcomeTag && (
                <Badge variant="outline" className={cn("text-sm font-semibold px-3 py-1", OUTCOME_COLORS[outcomeTag] ?? "")}>
                  {outcomeTag}
                </Badge>
              )}
              <Badge variant="outline" className="text-xs">{STATUS_LABELS[r.status] ?? r.status}</Badge>
            </div>
            <p className="text-sm text-muted-foreground">
              {contact?.company && <>{contact.company} · </>}
              Engine {output?.engineVersion ?? "?"} · {output?.callType ?? "?"} · updated {new Date(r.updated_at).toLocaleString()}
            </p>
          </div>
          {isAdmin && (
            <div className="flex items-center gap-2">
              <Select value={reclaimTargetId} onValueChange={setReclaimTargetId}>
                <SelectTrigger className="w-[200px] h-9"><SelectValue placeholder="Reassign to…" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__unclaim__">Unclaim</SelectItem>
                  {reclaimUsers.map(u => (
                    <SelectItem key={u.id} value={u.id}>
                      {u.name ?? u.email} {u.role === "admin" && <span className="opacity-60 ml-1">(admin)</span>}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button variant="outline" size="sm" className="gap-1" disabled={!reclaimTargetId} onClick={submitReclaim}>
                <ShieldAlert className="w-3.5 h-3.5" /> Reclaim
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* Quick-glance badges row */}
      <div className="flex flex-wrap gap-2">
        <Badge variant="outline"><span className="text-muted-foreground mr-1">Persona:</span>
          <span className="font-semibold">{PERSONA_LABELS[persona] || persona}</span></Badge>
        {hotButton && <Badge variant="outline"><span className="text-muted-foreground mr-1">Hot button:</span>
          <span className="font-semibold capitalize">{hotButton}</span></Badge>}
        {view?.investorState?.demo_score != null && (
          <Badge variant="outline"><span className="text-muted-foreground mr-1">Demo score:</span>
            <span className="font-semibold">{view.investorState.demo_score}/100</span></Badge>
        )}
        {bundle.currentOwner && (
          <Badge variant="outline"><span className="text-muted-foreground mr-1">Owner:</span>
            <span className="font-semibold">{bundle.currentOwner.name ?? bundle.currentOwner.email}</span></Badge>
        )}
      </div>

      {/* Handoff banner */}
      {bundle.handedFrom && r.handed_at && (
        <Card className={cn(
          "border-l-4 bg-card",
          r.status === "handed_to_closer"
            ? "border-l-purple-500 border-purple-500/40"
            : "border-l-amber-500 border-amber-500/40",
        )}>
          <CardContent className="py-4 px-5 space-y-1.5">
            <div className="flex items-center gap-2 text-xs">
              {r.status === "handed_to_closer"
                ? <UserPlus className="w-3.5 h-3.5 text-purple-700" />
                : <CornerUpLeft className="w-3.5 h-3.5 text-amber-700" />}
              <span className={cn(
                "font-semibold uppercase tracking-wider",
                r.status === "handed_to_closer" ? "text-purple-700" : "text-amber-700",
              )}>
                {r.status === "handed_to_closer" ? "Handed to you by" : "Bounced back by"}
              </span>
              <span className="font-medium">{bundle.handedFrom.name ?? bundle.handedFrom.email}</span>
              <span className="text-muted-foreground">· {new Date(r.handed_at).toLocaleString()}</span>
            </div>
            {r.hand_note && <p className="text-sm leading-relaxed whitespace-pre-wrap pl-5">{r.hand_note}</p>}
          </CardContent>
        </Card>
      )}

      {/* Flags (kept prominent — compliance matters) */}
      {output?.flags && output.flags.length > 0 && (
        <Card className="border-amber-500/30 bg-amber-500/5">
          <CardContent className="py-3 px-5 space-y-1">
            <p className="text-xs font-medium text-amber-700 uppercase tracking-wide">
              Flags ({output.flags.length})
            </p>
            {output.flags.map((f, i) => (
              <div key={i} className="text-sm flex items-start gap-1.5">
                <AlertCircle className="w-3.5 h-3.5 mt-0.5 text-amber-500 shrink-0" />
                <span className="text-amber-700"><span className="opacity-70">[{f.type}]</span> {f.message}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* ======================================================================
          TABS — Action / Intelligence / History
          Header (contact + outcome + badges + handoff + flags) stays above.
          Most operator time is on Action. Intelligence is a click away when
          they want the "why". History is audit — rarely visited.
      ====================================================================== */}
      <Tabs defaultValue="action" className="w-full">
        <TabsList>
          <TabsTrigger value="action" className="gap-1.5">
            <Target className="w-3.5 h-3.5" /> Action
            <TabBadge count={openActionCount({ output, decisionByKey })} />
          </TabsTrigger>
          <TabsTrigger value="intelligence" className="gap-1.5">
            <Brain className="w-3.5 h-3.5" /> Intelligence
          </TabsTrigger>
          <TabsTrigger value="history" className="gap-1.5">
            <History className="w-3.5 h-3.5" /> History
            {bundle.decisions.length > 0 && <TabBadge count={bundle.decisions.length} muted />}
          </TabsTrigger>
        </TabsList>

        {/* ============================================================
            ACTION TAB — everything the operator DOES
        ============================================================ */}
        <TabsContent value="action" className="space-y-4 mt-4">
          {output?.emailDraft && (
            <EmailWorkspace
              email={output.emailDraft}
              decision={decisionByKey.get("email:primary")}
              busy={decidingKey === "email:primary"}
              availableDocs={availableDocs}
              nbaDoc={output.nextBestAction?.contentToSend ?? null}
              onSubmitDecision={submitDecision}
            />
          )}

          {output?.nextBestAction && !output.emailDraft && (
            <NBAWorkspace
              nba={output.nextBestAction}
              decision={decisionByKey.get("nba:primary")}
              busy={decidingKey === "nba:primary"}
              onSubmitDecision={submitDecision}
            />
          )}

          <FollowUpWorkspace nba={output?.nextBestAction} />

          {output?.postCloseActions && output.postCloseActions.length > 0 && (
            <Card className="border-l-4 border-l-green-500 bg-card">
              <CardContent className="py-4 px-5 space-y-3">
                <div className="flex items-center gap-2">
                  <ListChecks className="w-4 h-4 text-green-700" />
                  <p className="text-sm font-semibold uppercase tracking-wider text-green-700">Post-close checklist</p>
                </div>
                {output.postCloseActions.map((a, i) => {
                  const key = `post_close:${i}:${a.action.slice(0, 40)}`;
                  return (
                    <div key={i} className="space-y-2 border-b border-border/50 last:border-b-0 pb-3 last:pb-0">
                      <div className="flex items-start gap-2 text-sm">
                        <CheckCircle2 className="w-4 h-4 text-green-600 mt-0.5 opacity-60 shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="font-medium">{a.action}</p>
                          <p className="text-xs text-muted-foreground">{a.owner} · {a.timing}</p>
                          {a.detail && <p className="text-sm text-muted-foreground/90 mt-1">{a.detail}</p>}
                        </div>
                      </div>
                      <DecisionBar
                        actionType="post_close_item"
                        actionKey={key}
                        decision={decisionByKey.get(`post_close_item:${key}`)}
                        busy={decidingKey === `post_close_item:${key}`}
                        onSubmit={submitDecision}
                      />
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          )}

          {output?.adviserLoopActions && output.adviserLoopActions.length > 0 && (
            <Card className="border-l-4 border-l-purple-500 bg-card">
              <CardContent className="py-4 px-5 space-y-3">
                <div className="flex items-center gap-2">
                  <Users className="w-4 h-4 text-purple-700" />
                  <p className="text-sm font-semibold uppercase tracking-wider text-purple-700">Adviser loop</p>
                </div>
                {(["pre_call", "during_call", "post_call"] as const).map(phase => {
                  const group = output.adviserLoopActions?.find(g => g.phase === phase);
                  if (!group || group.actions.length === 0) return null;
                  const phaseLabel = phase === "pre_call" ? "Pre-call" : phase === "during_call" ? "During call" : "Post-call";
                  return (
                    <div key={phase} className="space-y-2">
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{phaseLabel}</p>
                      {group.actions.map((a, i) => {
                        const key = `adviser_loop:${phase}:${i}:${a.action.slice(0, 40)}`;
                        return (
                          <div key={i} className="pl-3 space-y-2">
                            <div className="flex items-start gap-2 text-sm">
                              <Sparkles className="w-3 h-3 text-purple-500 mt-1.5 shrink-0" />
                              <div className="flex-1 min-w-0">
                                <p className="font-medium">{a.action}</p>
                                <p className="text-xs text-muted-foreground">{a.owner} · {a.timing}</p>
                                {a.detail && <p className="text-sm text-muted-foreground/90 mt-1">{a.detail}</p>}
                              </div>
                            </div>
                            <div className="pl-5">
                              <DecisionBar
                                actionType="adviser_loop_item"
                                actionKey={key}
                                decision={decisionByKey.get(`adviser_loop_item:${key}`)}
                                busy={decidingKey === `adviser_loop_item:${key}`}
                                onSubmit={submitDecision}
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          )}

          {output?.book2Routing?.triggered && (
            <Card className="border-l-4 border-l-indigo-500 bg-card">
              <CardContent className="py-4 px-5 space-y-2">
                <p className="text-sm font-semibold uppercase tracking-wider text-indigo-700">Book 2 routing</p>
                {output.book2Routing.reason && <p className="text-sm">{output.book2Routing.reason}</p>}
                {output.book2Routing.actions && output.book2Routing.actions.length > 0 && (
                  <ul className="text-sm text-muted-foreground space-y-0.5 pl-5 list-disc">
                    {output.book2Routing.actions.map((a, i) => <li key={i}>{a}</li>)}
                  </ul>
                )}
                <DecisionBar
                  actionType="book2"
                  actionKey="primary"
                  decision={decisionByKey.get("book2:primary")}
                  busy={decidingKey === "book2:primary"}
                  onSubmit={submitDecision}
                />
              </CardContent>
            </Card>
          )}

          {/* OPERATOR NOTES */}
          <Card>
            <CardContent className="py-4 px-5 space-y-2">
              <div className="flex items-center gap-2">
                <StickyNote className="w-4 h-4 text-muted-foreground" />
                <p className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Operator notes</p>
              </div>
              <p className="text-xs text-muted-foreground">
                Free-form notes for yourself or whoever picks this up next. Not sent to the investor.
              </p>
              <Textarea
                value={notes}
                onChange={(e) => { setNotes(e.target.value); setNotesDirty(true); }}
                rows={4}
                placeholder="e.g. Adviser wants the IHT-5M-estate version; avoid portfolio language."
              />
              <div className="flex justify-end">
                <Button size="sm" onClick={saveNotes} disabled={!notesDirty || notesSaving} className="gap-1">
                  {notesSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                  Save notes
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ============================================================
            INTELLIGENCE TAB — everything the engine saw (expanded, no
            collapsibles — this is the FOCUS of this tab, not a footnote)
        ============================================================ */}
        <TabsContent value="intelligence" className="space-y-4 mt-4">
          {/* Signal changes */}
          {output?.signalUpdates && output.signalUpdates.length > 0 && (
            <Card>
              <CardContent className="py-4 px-5 space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Signal changes this call</p>
                  <Badge variant="outline" className="text-[10px]">{output.signalUpdates.length}</Badge>
                </div>
                <div className="space-y-3">
                  {output.signalUpdates.map(u => (
                    <div key={u.code} className="grid grid-cols-[auto_auto_auto_auto_1fr] gap-3 items-start text-sm">
                      <span className="font-mono text-xs w-10 shrink-0 pt-1">{u.code}</span>
                      <Badge className={cn("text-xs mt-0.5", stateClasses(u.previousState))} variant="outline">{u.previousState}</Badge>
                      <ArrowRight className="w-3 h-3 text-muted-foreground mt-1.5" />
                      <Badge className={cn("text-xs mt-0.5", stateClasses(u.newState))} variant="outline">{u.newState}</Badge>
                      {u.evidence && (
                        <p className="text-sm text-muted-foreground whitespace-pre-wrap break-words leading-relaxed">"{u.evidence}"</p>
                      )}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Fact find */}
          {view?.investorState && (
            <Card>
              <CardContent className="py-4 px-5 space-y-3">
                <p className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Fact find</p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                  <FactFindField label="Practical problem" value={view.investorState.practical_problem} />
                  <FactFindField label="Current pressure" value={view.investorState.current_pressure} />
                  <FactFindField label="Personal angle" value={view.investorState.personal_angle} />
                  <FactFindField label="Desired outcome" value={view.investorState.desired_outcome} />
                  <FactFindField label="Decision stakeholders" value={view.investorState.decision_stakeholders} />
                  <FactFindField label="Decision style" value={view.investorState.decision_style} />
                  <FactFindField label="Portfolio shape" value={view.investorState.portfolio_shape} />
                  <FactFindField label="Annual tax liability" value={view.investorState.annual_tax_liability ? `£${view.investorState.annual_tax_liability}` : null} />
                  <FactFindField label="Questions for Call 3" value={view.investorState.questions_for_call3} fullWidth />
                </div>
                {view.investorState.exact_phrases && view.investorState.exact_phrases.length > 0 && (
                  <div className="space-y-1.5 pt-2 border-t">
                    <p className="text-xs text-muted-foreground uppercase tracking-wide">Verbatim phrases</p>
                    <ul className="space-y-1">
                      {view.investorState.exact_phrases.map((q, i) => (
                        <li key={i} className="text-sm italic text-muted-foreground pl-3 border-l-2 border-primary/30">"{q}"</li>
                      ))}
                    </ul>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Questions */}
          {output?.questionsDetected && output.questionsDetected.length > 0 && (
            <Card>
              <CardContent className="py-4 px-5 space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Questions asked</p>
                  <Badge variant="outline" className="text-[10px]">
                    {output.questionsDetected.filter(q => q.detected).length} of {output.questionsDetected.length}
                  </Badge>
                </div>
                <div className="space-y-1">
                  {output.questionsDetected.map((qd, i) => (
                    <div key={i} className="flex items-start gap-2 text-sm py-1 border-b border-border/50 last:border-b-0">
                      {qd.detected
                        ? <CheckCircle2 className="w-3.5 h-3.5 text-green-600 mt-0.5 shrink-0" />
                        : <XIcon className="w-3.5 h-3.5 text-muted-foreground/40 mt-0.5 shrink-0" />}
                      <div className="flex-1 min-w-0">
                        <p>
                          <span className="font-mono text-muted-foreground/70 mr-1">Q{qd.questionNumber}</span>
                          {qd.signalTarget && <span className="font-mono text-xs text-muted-foreground/70 mr-2">{qd.signalTarget}</span>}
                          {qd.inferredSignalState && <span className="text-xs text-muted-foreground">→ {qd.inferredSignalState}</span>}
                        </p>
                        {qd.investorResponse && (
                          <p className="text-xs text-muted-foreground italic mt-0.5">"{qd.investorResponse}"</p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Gates */}
          {output?.gateStatus && (
            <Card>
              <CardContent className="py-4 px-5 space-y-2">
                <p className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Gates</p>
                <div className="space-y-1.5 text-sm">
                  <div className="flex items-center justify-between">
                    <span>C4 compliance</span>
                    <Badge variant="outline" className={output.gateStatus.c4Compliance === "open"
                      ? "bg-green-500/15 text-green-600 border-green-500/30"
                      : "bg-red-500/15 text-red-600 border-red-500/30"}>
                      {output.gateStatus.c4Compliance}
                    </Badge>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Pack 1</span>
                    <Badge variant="outline" className={output.gateStatus.pack1 === "eligible"
                      ? "bg-green-500/15 text-green-600 border-green-500/30"
                      : "bg-amber-500/15 text-amber-600 border-amber-500/30"}>
                      {output.gateStatus.pack1}
                    </Badge>
                  </div>
                  {output.gateStatus.pack1 === "blocked" && output.gateStatus.pack1BlockedReasons && (
                    <p className="text-xs text-muted-foreground pl-2">
                      {output.gateStatus.pack1BlockedReasons.join(", ")}
                    </p>
                  )}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Empty state */}
          {!output?.signalUpdates?.length && !view?.investorState && !output?.questionsDetected?.length && (
            <Card>
              <CardContent className="py-12 text-center text-muted-foreground">
                <HelpCircle className="w-8 h-8 mx-auto mb-2 opacity-40" />
                <p className="text-sm">No intelligence output available for this run.</p>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* ============================================================
            HISTORY TAB — audit trail
        ============================================================ */}
        <TabsContent value="history" className="space-y-4 mt-4">
          {/* Decision timeline */}
          <Card>
            <CardContent className="py-4 px-5 space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Decision timeline</p>
                <Badge variant="outline" className="text-[10px]">{bundle.decisions.length}</Badge>
              </div>
              {bundle.decisions.length === 0 ? (
                <p className="text-sm text-muted-foreground italic py-4 text-center">
                  No decisions yet. Approve, edit, or reject actions on the Action tab to start the audit trail.
                </p>
              ) : (
                <div className="space-y-1.5">
                  {bundle.decisions
                    .slice()
                    .sort((a, b) => new Date(b.decided_at).getTime() - new Date(a.decided_at).getTime())
                    .map(d => (
                      <div key={d.id} className="text-xs flex items-center gap-2 border-b border-border/50 last:border-b-0 pb-1.5 last:pb-0">
                        <span className="w-36 font-mono text-muted-foreground shrink-0">
                          {new Date(d.decided_at).toLocaleString()}
                        </span>
                        <Badge variant="outline" className={cn(
                          "text-[10px]",
                          d.decision === "approved" ? "bg-green-500/10 text-green-700 border-green-500/30"
                          : d.decision === "rejected" ? "bg-red-500/10 text-red-700 border-red-500/30"
                          : d.decision === "edited" ? "bg-amber-500/10 text-amber-700 border-amber-500/30"
                          : "bg-muted text-muted-foreground border-border"
                        )}>{d.decision}</Badge>
                        <span className="text-muted-foreground">{d.action_type}:{d.action_key.slice(0, 60)}</span>
                      </div>
                    ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Review metadata */}
          <Card>
            <CardContent className="py-4 px-5 space-y-2 text-sm">
              <p className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Review metadata</p>
              <dl className="space-y-1 text-sm">
                <div className="flex justify-between"><dt className="text-muted-foreground">Review ID</dt><dd className="font-mono text-xs">{r.id}</dd></div>
                <div className="flex justify-between"><dt className="text-muted-foreground">Engine run</dt><dd className="font-mono text-xs">{r.engine_run_id}</dd></div>
                <div className="flex justify-between"><dt className="text-muted-foreground">Created</dt><dd>{new Date(r.created_at).toLocaleString()}</dd></div>
                <div className="flex justify-between"><dt className="text-muted-foreground">Last updated</dt><dd>{new Date(r.updated_at).toLocaleString()}</dd></div>
                {r.claimed_at && <div className="flex justify-between"><dt className="text-muted-foreground">Claimed</dt><dd>{new Date(r.claimed_at).toLocaleString()}</dd></div>}
                {r.resolved_at && <div className="flex justify-between"><dt className="text-muted-foreground">Resolved</dt><dd>{new Date(r.resolved_at).toLocaleString()}</dd></div>}
              </dl>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

// Count how many actionable items still await a decision — used for the
// Action tab badge. Stays small on purpose (single digit is fine).
function openActionCount({ output, decisionByKey }: {
  output: EngineOutput | null;
  decisionByKey: Map<string, DecisionRow>;
}): number {
  if (!output) return 0;
  let count = 0;
  if (output.emailDraft && !decisionByKey.has("email:primary")) count++;
  if (output.nextBestAction && !output.emailDraft && !decisionByKey.has("nba:primary")) count++;
  if (output.book2Routing?.triggered && !decisionByKey.has("book2:primary")) count++;
  for (const [i, a] of (output.postCloseActions ?? []).entries()) {
    const k = `post_close_item:post_close:${i}:${a.action.slice(0, 40)}`;
    if (!decisionByKey.has(k)) count++;
  }
  for (const group of output.adviserLoopActions ?? []) {
    for (const [i, a] of group.actions.entries()) {
      const k = `adviser_loop_item:adviser_loop:${group.phase}:${i}:${a.action.slice(0, 40)}`;
      if (!decisionByKey.has(k)) count++;
    }
  }
  return count;
}

function TabBadge({ count, muted }: { count: number; muted?: boolean }) {
  if (count === 0) return null;
  return (
    <Badge variant="outline" className={cn(
      "ml-1 text-[10px] px-1.5 py-0",
      muted ? "bg-muted text-muted-foreground" : "bg-primary/15 text-primary border-primary/30",
    )}>
      {count}
    </Badge>
  );
}

// ============================================================================
// Sub-components
// ============================================================================

function Collapsible({ title, count, children }: { title: string; count?: number; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <Card>
      <CardContent className="p-0">
        <button
          className="w-full flex items-center justify-between px-5 py-3 text-left hover:bg-muted/40 rounded"
          onClick={() => setOpen(o => !o)}
        >
          <span className="text-sm font-medium flex items-center gap-2">
            <span className={cn("inline-block transition-transform", open ? "rotate-90" : "")}>▸</span>
            {title}
            {count !== undefined && (
              <Badge variant="outline" className="text-[10px] ml-1">{count}</Badge>
            )}
          </span>
        </button>
        {open && (
          <div className="px-5 py-3 pt-2 border-t">{children}</div>
        )}
      </CardContent>
    </Card>
  );
}

function FactFindField({ label, value, fullWidth }: { label: string; value: string | null | undefined; fullWidth?: boolean }) {
  return (
    <div className={cn(fullWidth && "md:col-span-2")}>
      <p className="text-xs text-muted-foreground">{label}</p>
      {value ? (
        <p className="mt-0.5 whitespace-pre-wrap leading-relaxed">{value}</p>
      ) : (
        <p className="mt-0.5 text-muted-foreground/50 italic">— not captured</p>
      )}
    </div>
  );
}

function DecisionBar({
  actionType, actionKey, decision, busy, onSubmit,
}: {
  actionType: ActionType; actionKey: string;
  decision: DecisionRow | undefined; busy: boolean;
  onSubmit: (t: ActionType, k: string, d: ActionDecision, payload?: any) => void;
}) {
  if (decision) {
    const color =
      decision.decision === "approved" ? "text-green-700 bg-green-500/10 border-green-500/30"
      : decision.decision === "edited" ? "text-amber-700 bg-amber-500/10 border-amber-500/30"
      : decision.decision === "rejected" ? "text-red-700 bg-red-500/10 border-red-500/30"
      : "text-muted-foreground bg-muted/50 border-border";
    const label =
      decision.decision === "approved" ? "Approved"
      : decision.decision === "edited" ? "Edited"
      : decision.decision === "rejected" ? "Rejected" : "Deferred";
    return (
      <div className={cn("flex items-center justify-between gap-2 rounded border px-3 py-1.5 text-xs", color)}>
        <span className="flex items-center gap-1.5">
          {decision.decision === "approved" && <Check className="w-3 h-3" />}
          {decision.decision === "rejected" && <XIcon className="w-3 h-3" />}
          {decision.decision === "edited" && <Edit3 className="w-3 h-3" />}
          <span className="font-medium">{label}</span>
          <span className="opacity-70">· {new Date(decision.decided_at).toLocaleString()}</span>
        </span>
        <Button size="sm" variant="ghost" className="h-6 px-2 text-xs gap-1" disabled={busy}
                onClick={() => onSubmit(actionType, actionKey, "deferred")}>
          {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Undo2 className="w-3 h-3" />} Undo
        </Button>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      <Button size="sm" variant="outline" disabled={busy}
              className="h-7 px-3 text-xs gap-1 border-green-500/40 text-green-700 hover:bg-green-500/10"
              onClick={() => onSubmit(actionType, actionKey, "approved")}>
        {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />} Approve
      </Button>
      <Button size="sm" variant="outline" disabled={busy}
              className="h-7 px-3 text-xs gap-1 border-red-500/40 text-red-700 hover:bg-red-500/10"
              onClick={() => onSubmit(actionType, actionKey, "rejected")}>
        <XIcon className="w-3 h-3" /> Reject
      </Button>
    </div>
  );
}

// ============================================================================
// NBA-only workspace (when there's no email draft — e.g. schedule_call NBAs)
// ============================================================================
function NBAWorkspace({
  nba, decision, busy, onSubmitDecision,
}: {
  nba: NonNullable<EngineOutput["nextBestAction"]>;
  decision: DecisionRow | undefined;
  busy: boolean;
  onSubmitDecision: (t: ActionType, k: string, d: ActionDecision, payload?: any) => void;
}) {
  return (
    <Card className="border-l-4 border-l-primary bg-card">
      <CardContent className="py-4 px-5 space-y-3">
        <p className="text-sm font-semibold uppercase tracking-wider text-primary">Next best action</p>
        <p className="font-semibold text-base">{nba.detail || nba.actionType}</p>
        <p className="text-sm text-muted-foreground">{nba.owner} · {nba.timing}</p>
        {nba.contentToSend && (
          <>
            <Separator />
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <FileText className="w-4 h-4" />
              <span>Send: <span className="font-medium">{nba.contentToSend.docName}</span> (doc {nba.contentToSend.docId})</span>
            </div>
          </>
        )}
        <DecisionBar
          actionType="nba" actionKey="primary"
          decision={decision} busy={busy}
          onSubmit={onSubmitDecision}
        />
      </CardContent>
    </Card>
  );
}

// ============================================================================
// EMAIL WORKSPACE — the centerpiece.
// Editable subject + body + token replacer + ATTACHMENTS picker.
// Attachments default to the NBA-recommended doc; operator can add more
// or remove entirely. Selection saved as edited_payload on the decision.
// ============================================================================
function EmailWorkspace({
  email, decision, busy, availableDocs, nbaDoc, onSubmitDecision,
}: {
  email: NonNullable<EngineOutput["emailDraft"]>;
  decision: DecisionRow | undefined;
  busy: boolean;
  availableDocs: DocOption[];
  nbaDoc: { docId: number; docName: string } | null;
  onSubmitDecision: (t: ActionType, k: string, d: ActionDecision, payload?: any) => void;
}) {
  const initialFromDecision = decision?.decision === "edited" ? decision.edited_payload : null;

  const initialSubject: string = initialFromDecision?.subject ?? email.subject;
  const initialBody: string = initialFromDecision?.body ?? email.body;
  // Default attachment list = whatever the engine's email draft carried
  // plus the NBA's recommended doc if different. Operator can prune /add.
  const initialAttachments: DocOption[] = useMemo(() => {
    if (Array.isArray(initialFromDecision?.attachments) && initialFromDecision.attachments.length > 0) {
      return initialFromDecision.attachments;
    }
    const out: DocOption[] = [];
    if (email.attachmentDocId != null) {
      out.push({ docId: email.attachmentDocId, docName: email.attachmentDocName ?? `Doc ${email.attachmentDocId}` });
    }
    if (nbaDoc && !out.find(d => d.docId === nbaDoc.docId)) {
      out.push({ docId: nbaDoc.docId, docName: nbaDoc.docName });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [subject, setSubject] = useState(initialSubject);
  const [body, setBody] = useState(initialBody);
  const [attachments, setAttachments] = useState<DocOption[]>(initialAttachments);
  const [addDocId, setAddDocId] = useState<string>("");
  const [editMode, setEditMode] = useState(false);

  // Tokens
  const tokens = useMemo(() => {
    const all = `${subject}\n${body}`.match(/\[[A-Z_0-9]+\]/g) || [];
    return Array.from(new Set(all));
  }, [subject, body]);
  const [tokenValues, setTokenValues] = useState<Record<string, string>>({});

  const applyTokens = () => {
    let ns = subject, nb = body;
    for (const [t, v] of Object.entries(tokenValues)) {
      if (!v) continue;
      const esc = t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const re = new RegExp(esc, "g");
      ns = ns.replace(re, v); nb = nb.replace(re, v);
    }
    setSubject(ns); setBody(nb); setTokenValues({});
  };
  const reset = () => {
    setSubject(email.subject); setBody(email.body);
    setAttachments(initialAttachments); setTokenValues({});
  };
  const addAttachment = () => {
    if (!addDocId) return;
    const found = availableDocs.find(d => String(d.docId) === addDocId);
    if (!found) return;
    if (attachments.find(a => a.docId === found.docId)) return; // already attached
    setAttachments(prev => [...prev, { docId: found.docId, docName: found.docName }]);
    setAddDocId("");
  };
  const removeAttachment = (docId: number) => {
    setAttachments(prev => prev.filter(a => a.docId !== docId));
  };
  const saveEdits = () => {
    onSubmitDecision("email", "primary", "edited", { subject, body, attachments });
    setEditMode(false);
  };
  const isDirty = subject !== initialSubject
    || body !== initialBody
    || JSON.stringify(attachments) !== JSON.stringify(initialAttachments);
  const attachmentCandidates = availableDocs.filter(d => !attachments.find(a => a.docId === d.docId));

  return (
    <Card className="border-l-4 border-l-blue-500 bg-card">
      <CardContent className="py-4 px-5 space-y-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            <Mail className="w-4 h-4 text-blue-600" />
            <p className="text-sm font-semibold uppercase tracking-wider text-blue-700">Email to send</p>
            <Badge variant="outline" className="text-[10px] font-mono">{email.templateId}</Badge>
            <Badge variant="outline" className="text-[10px]">{email.timing}</Badge>
          </div>
          {!editMode && (
            <Button variant="outline" size="sm" className="gap-1.5 border-blue-500/40 text-blue-700 hover:bg-blue-500/10"
                    onClick={() => setEditMode(true)}>
              <Edit3 className="w-3.5 h-3.5" /> Edit subject & body
            </Button>
          )}
        </div>

        {tokens.length > 0 && (
          <div className="rounded bg-amber-500/10 border border-amber-500/30 px-3 py-2 space-y-2">
            <p className="text-xs font-medium text-amber-700 flex items-center gap-1.5">
              <AlertTriangle className="w-3 h-3" /> Replace placeholders before sending
            </p>
            <div className="space-y-1.5">
              {tokens.map(t => (
                <div key={t} className="flex items-center gap-2">
                  <span className="font-mono text-xs text-amber-900 w-20 shrink-0">{t}</span>
                  <Input
                    value={tokenValues[t] ?? ""}
                    onChange={e => setTokenValues(v => ({ ...v, [t]: e.target.value }))}
                    placeholder={t === "[DAY]" ? "e.g. Tuesday 23 April" : t === "[TIME]" ? "e.g. 2pm" : "value"}
                    className="h-7 text-xs flex-1"
                  />
                </div>
              ))}
            </div>
            <Button size="sm" variant="outline" className="h-7 text-xs"
                    disabled={!Object.values(tokenValues).some(v => v)}
                    onClick={applyTokens}>
              Apply to email
            </Button>
          </div>
        )}

        {/* Subject */}
        {editMode ? (
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Subject</label>
            <Input value={subject} onChange={e => setSubject(e.target.value)} />
          </div>
        ) : (
          <p className="text-base font-semibold">{subject}</p>
        )}

        {/* Body */}
        {editMode ? (
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Body</label>
            <Textarea value={body} onChange={e => setBody(e.target.value)} rows={14} className="font-mono text-sm" />
          </div>
        ) : (
          <div className="text-sm bg-muted/40 border border-border rounded p-3 whitespace-pre-wrap leading-relaxed">
            {body}
          </div>
        )}

        {/* ATTACHMENTS — pickable, multi-doc */}
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            Attachments ({attachments.length})
          </p>
          <div className="flex flex-wrap gap-2">
            {attachments.map(a => (
              <Badge key={a.docId} variant="outline" className="gap-1.5 pr-1 text-xs">
                <FileText className="w-3 h-3" />
                {a.docName} <span className="text-muted-foreground">(doc {a.docId})</span>
                {nbaDoc?.docId === a.docId && (
                  <span className="text-[9px] uppercase text-blue-700 bg-blue-500/10 border border-blue-500/30 rounded px-1 py-px ml-0.5">NBA</span>
                )}
                <button onClick={() => removeAttachment(a.docId)}
                        className="ml-0.5 p-0.5 rounded hover:bg-destructive/10 hover:text-destructive">
                  <XIcon className="w-3 h-3" />
                </button>
              </Badge>
            ))}
            {attachments.length === 0 && (
              <p className="text-xs text-muted-foreground italic">No attachments selected.</p>
            )}
          </div>
          {attachmentCandidates.length > 0 && (
            <div className="flex items-center gap-2">
              <Select value={addDocId} onValueChange={setAddDocId}>
                <SelectTrigger className="h-8 w-[280px] text-xs">
                  <SelectValue placeholder="+ Add document…" />
                </SelectTrigger>
                <SelectContent>
                  {attachmentCandidates.map(d => (
                    <SelectItem key={d.docId} value={String(d.docId)}>
                      <span className="font-medium">{d.docName}</span>
                      <span className="text-muted-foreground ml-2">(doc {d.docId})</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button size="sm" variant="outline" disabled={!addDocId} onClick={addAttachment} className="gap-1 h-8">
                <Plus className="w-3 h-3" /> Add
              </Button>
            </div>
          )}
        </div>

        {/* Compliance */}
        <div>
          {email.complianceCheck.passed ? (
            <div className="flex items-center gap-1.5 text-xs text-green-700">
              <CheckCircle2 className="w-3 h-3" /> Compliance checks passed
            </div>
          ) : (
            <div className="rounded bg-red-500/10 border border-red-500/30 px-3 py-2 space-y-1">
              <p className="text-xs font-medium text-red-700 flex items-center gap-1">
                <AlertTriangle className="w-3 h-3" />
                {email.complianceCheck.violations.length} compliance violation{email.complianceCheck.violations.length !== 1 ? "s" : ""}
              </p>
              {email.complianceCheck.violations.map((v, i) => (
                <p key={i} className="text-xs text-red-700 pl-4">✗ {v}</p>
              ))}
            </div>
          )}
        </div>

        {/* Actions */}
        {editMode ? (
          <div className="flex items-center gap-2 pt-1">
            <Button size="sm" onClick={saveEdits} disabled={!isDirty || busy} className="gap-1">
              {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
              Save edits
            </Button>
            <Button size="sm" variant="outline" onClick={() => setEditMode(false)} disabled={busy}>Cancel</Button>
            <Button size="sm" variant="ghost" className="gap-1 text-muted-foreground" onClick={reset} disabled={busy}>
              <RotateCcw className="w-3.5 h-3.5" /> Reset to engine original
            </Button>
          </div>
        ) : (
          <DecisionBar
            actionType="email" actionKey="primary"
            decision={decision} busy={busy}
            onSubmit={onSubmitDecision}
          />
        )}
      </CardContent>
    </Card>
  );
}

// ============================================================================
// FOLLOW-UP WORKSPACE — explicit scheduling surface.
// Parses NBA.timing into a default date ("24_48_hours" = +2 days) but lets
// the operator override. Persists as decision edited_payload on nba:primary
// — that's the engine's timing that the scheduler will consume when
// Phase 7.5 wires actual calendar/CRM updates.
// ============================================================================
function FollowUpWorkspace({ nba }: { nba: EngineOutput["nextBestAction"] | undefined }) {
  // Default from NBA.timing — simple heuristic. Phase 7.5 replaces this.
  const defaultDate = useMemo(() => {
    const d = new Date();
    const t = nba?.timing ?? "";
    if (t === "24_48_hours") d.setDate(d.getDate() + 2);
    else if (t === "immediate") { /* today */ }
    else d.setDate(d.getDate() + 1);
    return d.toISOString().slice(0, 10);
  }, [nba?.timing]);

  const [date, setDate] = useState(defaultDate);
  const [time, setTime] = useState("");
  const [reason, setReason] = useState("");
  // NOTE: this UI persists nothing yet — Phase 7.5 wires actual calendar
  // / contact.callback_date updates. For now this is a visible workspace
  // to set intent; saved state comes when the scheduler backend lands.

  return (
    <Card>
      <CardContent className="py-4 px-5 space-y-3">
        <div className="flex items-center gap-2">
          <CalendarIcon className="w-4 h-4 text-muted-foreground" />
          <p className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Follow-up</p>
          {nba?.timing && (
            <Badge variant="outline" className="text-[10px]">Engine: {nba.timing}</Badge>
          )}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div>
            <label className="text-xs text-muted-foreground">Date</label>
            <Input type="date" value={date} onChange={e => setDate(e.target.value)} />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Time (optional)</label>
            <Input type="time" value={time} onChange={e => setTime(e.target.value)} />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Reason</label>
            <Input value={reason} onChange={e => setReason(e.target.value)}
                   placeholder="Callback per investor preference" />
          </div>
        </div>
        <p className="text-xs text-muted-foreground italic">
          Schedule persistence lands with Phase 7.5 (website/calendar integration). For now this
          surface captures your intent alongside the email.
        </p>
      </CardContent>
    </Card>
  );
}
