// Phase 4.8 session 2 — Dedicated Outcome detail page.
//
// The drawer (OutcomeDrawer) remains the compact triage surface on
// Call Command. This page is the full workspace — expanded quotes,
// full fact-find, inline email editing, admin controls. Opened by
// clicking a row on /outcomes.
//
// Intentionally duplicates some fetch + derivation logic from
// OutcomeDrawer rather than refactoring — the two surfaces will
// diverge (page adds editors, admin controls, decision history) and
// sharing through a tangle of props would cost more than copy-paste.

import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useRoute, useLocation } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Loader2, AlertCircle, AlertTriangle, ArrowLeft, ArrowRight, CheckCircle2,
  XCircle, MinusCircle, Clock, FileText, Mail, Target, UserPlus, CornerUpLeft,
  ListChecks, Users, Sparkles, Edit3, Save, RotateCcw, Undo2, Check, X as XIcon,
  History, ShieldAlert,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { apiFetch } from "@/lib/apiClient";

const API_BASE = (import.meta.env.BASE_URL?.replace(/\/$/, "") || "") + "/api";

// ============================================================================
// Types — mirror server-side shapes. Keep in sync with OutcomeDrawer.
// ============================================================================

type ActionType = "nba" | "email" | "post_close_item" | "adviser_loop_item" | "book2";
type ActionDecision = "approved" | "edited" | "rejected" | "deferred";

interface EngineSignalRow {
  id: string;
  code: string;
  state: string;
  evidence: string | null;
  confidence: string;
  updated_at: string;
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
  id: string;
  engine_run_id: string;
  contact_id: string;
  current_owner_user_id: string | null;
  status: string;
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
interface UserRef { id: string; name: string | null; email: string; }
interface ReviewBundle {
  review: ReviewRow;
  decisions: OutcomeActionDecisionRow[];
  currentOwner: UserRef | null;
  handedFrom: UserRef | null;
}

interface EngineOutput {
  engineVersion: string;
  processedAt: string;
  callType: string;
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
  id: string;
  first_name: string;
  last_name: string;
  email: string | null;
  phone: string | null;
  company: string | null;
}

// ============================================================================
// Visual constants — shared pattern with drawer
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

// ============================================================================
// Page
// ============================================================================

export default function OutcomeDetailPage() {
  const [, params] = useRoute("/outcomes/:id");
  const [, setLocation] = useLocation();
  const reviewId = params?.id ?? null;
  const { data: currentUser } = useCurrentUser();
  const role = String(currentUser?.user?.role ?? "agent");
  const isAdmin = role === "admin";

  const [bundle, setBundle] = useState<ReviewBundle | null>(null);
  const [view, setView] = useState<EngineContactView | null>(null);
  const [contact, setContact] = useState<ContactRow | null>(null);
  const [output, setOutput] = useState<EngineOutput | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const decidingKeyRef = useRef<string | null>(null);
  const [decidingKey, setDecidingKey] = useState<string | null>(null);

  const load = async () => {
    if (!reviewId) return;
    setLoading(true);
    setError(null);
    try {
      // 1. The review bundle — fetches review + decisions + owner/handed_from
      const rRes = await apiFetch(`${API_BASE}/outcome-reviews/${reviewId}`);
      if (!rRes.ok) throw new Error(`Review load failed: HTTP ${rRes.status}`);
      const rData = await rRes.json();
      const b: ReviewBundle = rData;
      setBundle(b);

      // 2. The engine view for this contact (signals, transitions, runs)
      const vRes = await apiFetch(`${API_BASE}/engine/contact/${b.review.contact_id}`);
      if (vRes.ok) setView(await vRes.json());

      // 3. The full engine run output (persona, NBA, email, etc.)
      const runRes = await apiFetch(`${API_BASE}/engine/runs/${b.review.engine_run_id}`);
      if (runRes.ok) {
        const full = await runRes.json();
        setOutput(full.output);
      }

      // 4. Contact for the header display
      const cRes = await apiFetch(`${API_BASE}/engine/contact/${b.review.contact_id}`);
      if (cRes.ok) {
        const data = await cRes.json();
        // engine/contact returns investor state, not contact row directly.
        // Use the state's first_name/last_name proxy from /contacts if needed.
        // For now, rely on the engine view's investorState (has persona etc.)
        // and fetch the raw contact via a minimal endpoint.
      }
      // Fallback: fetch contact by id from the reviews list endpoint result —
      // but we came in by reviewId only. Use the engine/contact endpoint,
      // which joins the contact row into investorState is not ideal. Simplest:
      // fetch /contacts/:id.
      try {
        const cr = await apiFetch(`${API_BASE}/contacts?id=${b.review.contact_id}`);
        if (cr.ok) {
          const cd = await cr.json();
          const first = cd.contacts?.[0] ?? cd ?? null;
          if (first) setContact(first);
        }
      } catch { /* non-fatal */ }
    } catch (err: any) {
      setError(err?.message || "Failed to load outcome");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reviewId]);

  // Decision upsert — fire the /decisions endpoint; refresh bundle on success.
  const submitDecision = async (
    actionType: ActionType,
    actionKey: string,
    decision: ActionDecision,
    editedPayload?: any,
  ) => {
    if (!bundle?.review.id) return;
    const rowKey = `${actionType}:${actionKey}`;
    decidingKeyRef.current = rowKey;
    setDecidingKey(rowKey);
    try {
      const res = await apiFetch(`${API_BASE}/outcome-reviews/${bundle.review.id}/decisions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action_type: actionType, action_key: actionKey, decision, edited_payload: editedPayload ?? null }),
      });
      if (res.ok) {
        // Refresh just the review bundle so we see the new decision state.
        const rRes = await apiFetch(`${API_BASE}/outcome-reviews/${bundle.review.id}`);
        if (rRes.ok) setBundle(await rRes.json());
      }
    } catch { /* silent */ }
    finally {
      decidingKeyRef.current = null;
      setDecidingKey(null);
    }
  };

  // Admin reclaim — bounces a review to a chosen user (or null for unclaim).
  const [reclaimTargetId, setReclaimTargetId] = useState<string>("");
  const [reclaimUsers, setReclaimUsers] = useState<Array<{ id: string; name: string | null; email: string; role: string }>>([]);
  useEffect(() => {
    if (!isAdmin) return;
    (async () => {
      try {
        const res = await apiFetch(`${API_BASE}/users/closers`);
        if (res.ok) {
          const data = await res.json();
          setReclaimUsers(data.closers || []);
        }
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

  // --- DERIVED DATA ---
  const decisionByKey = useMemo(() => {
    const m = new Map<string, OutcomeActionDecisionRow>();
    if (bundle?.decisions) for (const d of bundle.decisions) m.set(`${d.action_type}:${d.action_key}`, d);
    return m;
  }, [bundle]);

  const persona = view?.investorState?.persona || output?.personaAssessment?.persona || "undetermined";
  const hotButton = view?.investorState?.hot_button || output?.hotButton?.primary;

  const nba = output?.nextBestAction;
  const emailDraft = output?.emailDraft;
  const postClose = output?.postCloseActions;
  const adviserLoop = output?.adviserLoopActions;
  const book2 = output?.book2Routing;
  const flags = output?.flags ?? [];
  const signalUpdates = output?.signalUpdates ?? [];

  // ==========================================================================
  // RENDER
  // ==========================================================================

  if (loading) {
    return (
      <div className="max-w-5xl mx-auto py-12 text-center text-muted-foreground">
        <Loader2 className="w-6 h-6 animate-spin mx-auto" />
      </div>
    );
  }

  if (error || !bundle || !reviewId) {
    return (
      <div className="max-w-5xl mx-auto space-y-4">
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
    <div className="max-w-5xl mx-auto space-y-5">
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <Link href="/outcomes" className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
            <ArrowLeft className="w-4 h-4" /> Back to outcomes
          </Link>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3">
            {contactName}
            <Badge variant="outline" className="text-xs">{STATUS_LABELS[r.status] ?? r.status}</Badge>
          </h1>
          <p className="text-sm text-muted-foreground">
            {contact?.company && <>{contact.company} · </>}
            Engine {output?.engineVersion ?? "?"} · {output?.callType ?? "?"} · updated {new Date(r.updated_at).toLocaleString()}
          </p>
        </div>
        {isAdmin && (
          <div className="flex items-center gap-2">
            <Select value={reclaimTargetId} onValueChange={setReclaimTargetId}>
              <SelectTrigger className="w-[200px] h-9">
                <SelectValue placeholder="Reassign to…" />
              </SelectTrigger>
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

      {/* HANDOFF BANNER (full detail, not truncated) */}
      {bundle.handedFrom && r.handed_at && (
        <Card className={cn(
          "border-l-4",
          r.status === "handed_to_closer"
            ? "border-l-purple-500 bg-purple-500/5 border-purple-500/30"
            : "border-l-amber-500 bg-amber-500/5 border-amber-500/30",
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
            {r.hand_note && (
              <p className="text-sm leading-relaxed whitespace-pre-wrap pl-5">{r.hand_note}</p>
            )}
          </CardContent>
        </Card>
      )}

      {/* BADGES ROW */}
      <div className="flex flex-wrap gap-2">
        <Badge variant="outline" className="gap-1">
          <span className="text-muted-foreground">Persona:</span>
          <span className="font-semibold">{PERSONA_LABELS[persona] || persona}</span>
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

      {/* SIGNAL CHANGES — full evidence, no truncation */}
      {signalUpdates.length > 0 && (
        <Card>
          <CardContent className="py-4 px-5">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Signal changes this call</p>
            <div className="space-y-3">
              {signalUpdates.map(u => (
                <div key={u.code} className="grid grid-cols-[auto_auto_auto_auto_1fr] gap-3 items-start text-sm">
                  <span className="font-mono text-xs w-10 shrink-0 pt-1">{u.code}</span>
                  <Badge className={cn("text-xs mt-0.5", stateClasses(u.previousState))} variant="outline">{u.previousState}</Badge>
                  <ArrowRight className="w-3 h-3 text-muted-foreground mt-1.5" />
                  <Badge className={cn("text-xs mt-0.5", stateClasses(u.newState))} variant="outline">{u.newState}</Badge>
                  {u.evidence && (
                    <p className="text-sm text-muted-foreground whitespace-pre-wrap break-words leading-relaxed">
                      "{u.evidence}"
                    </p>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* NEXT BEST ACTION + inline decision controls */}
      {nba && (
        <Card className="border-primary/40 bg-primary/[0.02]">
          <CardContent className="py-4 px-5 space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-primary">Next best action</p>
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
              actionType="nba"
              actionKey="primary"
              decision={decisionByKey.get("nba:primary")}
              busy={decidingKey === "nba:primary"}
              onSubmit={submitDecision}
            />
          </CardContent>
        </Card>
      )}

      {/* EMAIL DRAFT — EDITABLE */}
      {emailDraft && (
        <EmailEditor
          email={emailDraft}
          review={r}
          decision={decisionByKey.get("email:primary")}
          busy={decidingKey === "email:primary"}
          onSubmitDecision={submitDecision}
        />
      )}

      {/* BOOK 2 */}
      {book2?.triggered && (
        <Card className="border-indigo-500/30 bg-indigo-500/[0.02]">
          <CardContent className="py-4 px-5 space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-indigo-700">Book 2 routing</p>
            {book2.reason && <p className="text-sm">{book2.reason}</p>}
            {book2.actions && book2.actions.length > 0 && (
              <ul className="text-sm text-muted-foreground space-y-0.5 pl-5 list-disc">
                {book2.actions.map((a, i) => (<li key={i}>{a}</li>))}
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

      {/* POST-CLOSE CHECKLIST — with per-item decisions */}
      {postClose && postClose.length > 0 && (
        <Card className="border-green-500/30 bg-green-500/[0.02]">
          <CardContent className="py-4 px-5 space-y-3">
            <div className="flex items-center gap-2">
              <ListChecks className="w-4 h-4 text-green-700" />
              <p className="text-xs font-semibold uppercase tracking-wider text-green-700">Post-close checklist</p>
            </div>
            {postClose.map((a, i) => {
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

      {/* ADVISER LOOP */}
      {adviserLoop && adviserLoop.length > 0 && (
        <Card className="border-purple-500/30 bg-purple-500/[0.02]">
          <CardContent className="py-4 px-5 space-y-3">
            <div className="flex items-center gap-2">
              <Users className="w-4 h-4 text-purple-700" />
              <p className="text-xs font-semibold uppercase tracking-wider text-purple-700">Adviser loop</p>
            </div>
            {(["pre_call", "during_call", "post_call"] as const).map(phase => {
              const group = adviserLoop.find(g => g.phase === phase);
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

      {/* FLAGS */}
      {flags.length > 0 && (
        <Card className="border-amber-500/30 bg-amber-500/5">
          <CardContent className="py-3 px-5 space-y-1">
            <p className="text-xs font-medium text-amber-700 dark:text-amber-400 uppercase tracking-wide">
              Flags ({flags.length})
            </p>
            {flags.map((f, i) => (
              <div key={i} className="text-sm flex items-start gap-1.5">
                <AlertCircle className="w-3.5 h-3.5 mt-0.5 text-amber-500 shrink-0" />
                <span className="text-amber-700 dark:text-amber-400">
                  <span className="opacity-70">[{f.type}]</span> {f.message}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* FACT FIND — fully expanded */}
      {view?.investorState && (
        <Card>
          <CardContent className="py-4 px-5 space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Fact find</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
              <FactFindField label="Practical problem"       value={view.investorState.practical_problem} />
              <FactFindField label="Current pressure"        value={view.investorState.current_pressure} />
              <FactFindField label="Personal angle"          value={view.investorState.personal_angle} />
              <FactFindField label="Desired outcome"         value={view.investorState.desired_outcome} />
              <FactFindField label="Decision stakeholders"   value={view.investorState.decision_stakeholders} />
              <FactFindField label="Decision style"          value={view.investorState.decision_style} />
              <FactFindField label="Portfolio shape"         value={view.investorState.portfolio_shape} />
              <FactFindField label="Annual tax liability"    value={view.investorState.annual_tax_liability ? `£${view.investorState.annual_tax_liability}` : null} />
              <FactFindField label="Questions for Call 3"    value={view.investorState.questions_for_call3} fullWidth />
            </div>
            {view.investorState.exact_phrases && view.investorState.exact_phrases.length > 0 && (
              <div className="space-y-1">
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

      {/* DECISION HISTORY */}
      {bundle.decisions.length > 0 && (
        <Card>
          <CardContent className="py-4 px-5 space-y-2">
            <div className="flex items-center gap-2">
              <History className="w-4 h-4 text-muted-foreground" />
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Decision history</p>
            </div>
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
                    )}>
                      {d.decision}
                    </Badge>
                    <span className="text-muted-foreground">{d.action_type}:{d.action_key.slice(0, 50)}</span>
                  </div>
                ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ============================================================================
// Sub-components
// ============================================================================

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
  actionType: ActionType;
  actionKey: string;
  decision: OutcomeActionDecisionRow | undefined;
  busy: boolean;
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
      : decision.decision === "rejected" ? "Rejected"
      : "Deferred";
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
          {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Undo2 className="w-3 h-3" />}
          Undo
        </Button>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-1.5">
      <Button size="sm" variant="outline" disabled={busy}
              className="h-7 px-3 text-xs gap-1 border-green-500/40 text-green-700 hover:bg-green-500/10"
              onClick={() => onSubmit(actionType, actionKey, "approved")}>
        {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />} Approve
      </Button>
      <Button size="sm" variant="outline" disabled={busy}
              className="h-7 px-3 text-xs gap-1 border-amber-500/40 text-amber-700 hover:bg-amber-500/10"
              onClick={() => onSubmit(actionType, actionKey, "edited")}>
        <Edit3 className="w-3 h-3" /> Mark edited
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
// EMAIL EDITOR — Phase 4.8 session 2 centerpiece.
// Inline subject/body editing with token replacement for [DAY]/[TIME].
// "Save edits" persists the modified subject/body as the edited_payload on
// a decision row (decision="edited"). "Approve" marks approved without
// edits. "Reject" drops the email entirely for this review.
// ============================================================================
function EmailEditor({
  email, review, decision, busy, onSubmitDecision,
}: {
  email: NonNullable<EngineOutput["emailDraft"]>;
  review: ReviewRow;
  decision: OutcomeActionDecisionRow | undefined;
  busy: boolean;
  onSubmitDecision: (t: ActionType, k: string, d: ActionDecision, payload?: any) => void;
}) {
  // Initial values — if the review has a prior edited decision, start from
  // that payload so the editor retains operator changes. Otherwise start
  // from the engine's original.
  const initialSubject = (decision?.decision === "edited" && decision.edited_payload?.subject) || email.subject;
  const initialBody = (decision?.decision === "edited" && decision.edited_payload?.body) || email.body;

  const [subject, setSubject] = useState(initialSubject);
  const [body, setBody] = useState(initialBody);
  const [editMode, setEditMode] = useState(false);
  void review;

  // Detect unresolved tokens in subject + body. These are the placeholders
  // the agent is expected to fill before sending. Render a form of
  // per-token inputs; clicking "Apply tokens" does a simple global replace.
  const tokens = useMemo(() => {
    const all = `${subject}\n${body}`.match(/\[[A-Z_0-9]+\]/g) || [];
    return Array.from(new Set(all));
  }, [subject, body]);
  const [tokenValues, setTokenValues] = useState<Record<string, string>>({});

  const applyTokens = () => {
    let newSubject = subject;
    let newBody = body;
    for (const [t, v] of Object.entries(tokenValues)) {
      if (!v) continue;
      // Global replace — tokens are simple brackets, safe to regex-escape
      const escaped = t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const re = new RegExp(escaped, "g");
      newSubject = newSubject.replace(re, v);
      newBody = newBody.replace(re, v);
    }
    setSubject(newSubject);
    setBody(newBody);
    setTokenValues({});
  };

  const reset = () => {
    setSubject(email.subject);
    setBody(email.body);
    setTokenValues({});
  };

  const saveEdits = () => {
    onSubmitDecision("email", "primary", "edited", { subject, body });
    setEditMode(false);
  };

  const isDirty = subject !== initialSubject || body !== initialBody;

  return (
    <Card className="border-blue-500/30 bg-blue-500/[0.02]">
      <CardContent className="py-4 px-5 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Mail className="w-4 h-4 text-blue-600" />
            <p className="text-xs font-semibold uppercase tracking-wider text-blue-700">Email draft</p>
          </div>
          <div className="flex gap-1 items-center">
            <Badge variant="outline" className="text-[10px] font-mono">{email.templateId}</Badge>
            <Badge variant="outline" className="text-[10px]">{email.timing}</Badge>
            {!editMode && (
              <Button variant="ghost" size="sm" className="h-7 px-2 text-xs gap-1" onClick={() => setEditMode(true)}>
                <Edit3 className="w-3 h-3" /> Edit
              </Button>
            )}
          </div>
        </div>

        {/* Token replacer — shown whenever tokens are detected, editable or view */}
        {tokens.length > 0 && (
          <div className="rounded bg-amber-500/10 border border-amber-500/30 px-3 py-2 space-y-2">
            <p className="text-xs font-medium text-amber-700 flex items-center gap-1.5">
              <AlertTriangle className="w-3 h-3" />
              Replace placeholders before sending
            </p>
            <div className="grid grid-cols-[auto_1fr_auto] gap-2 items-center">
              {tokens.map(t => (
                <>
                  <span key={`${t}-label`} className="font-mono text-xs text-amber-900">{t}</span>
                  <Input
                    key={`${t}-input`}
                    value={tokenValues[t] ?? ""}
                    onChange={e => setTokenValues(v => ({ ...v, [t]: e.target.value }))}
                    placeholder={t === "[DAY]" ? "e.g. Tuesday 23 April" : t === "[TIME]" ? "e.g. 2pm" : "value"}
                    className="h-7 text-xs"
                  />
                  <span key={`${t}-pad`} />
                </>
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

        {/* Attachment */}
        {(email.attachmentDocName || email.attachmentDocId != null) && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <FileText className="w-4 h-4" />
            <span>📎 {email.attachmentDocName ?? `doc ${email.attachmentDocId}`}
              {email.attachmentDocId != null && (
                <span className="ml-1">(doc {email.attachmentDocId})</span>
              )}
            </span>
          </div>
        )}

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
            actionType="email"
            actionKey="primary"
            decision={decision}
            busy={busy}
            onSubmit={onSubmitDecision}
          />
        )}
      </CardContent>
    </Card>
  );
}
