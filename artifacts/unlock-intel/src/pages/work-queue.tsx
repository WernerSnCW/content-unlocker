import { useState, useEffect, useRef, useCallback } from "react";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Zap,
  Loader2,
  CheckCircle,
  XCircle,
  AlertCircle,
  ArrowRight,
  FileText,
} from "lucide-react";

const API_BASE =
  (import.meta.env.BASE_URL?.replace(/\/$/, "") || "") + "/api";

type QueueState =
  | "IDLE"
  | "PREPARING"
  | "PHASE_1_SUMMARY"
  | "PHASE_2_CARDS"
  | "SUMMARY";

interface Session {
  id: string;
  status: string;
  started_at: string;
  completed_at: string | null;
  total_tasks: number;
  analysed_tasks: number;
  auto_fixed_count: number;
  cards_total: number;
  cards_resolved: number;
  cards_skipped: number;
  cascaded_count: number;
  error_message: string | null;
}

interface Finding {
  id: string;
  session_id: string;
  task_id: string;
  document_id: string;
  document_name: string;
  document_tier: number;
  finding_type: string;
  issue_description: string;
  proposed_fix: string | null;
  original_text: string | null;
  status: string;
  skip_reason: string | null;
  sort_order: number;
  created_at: string;
  resolved_at: string | null;
}

interface SummaryData {
  session: Session;
  auto_fixed: number;
  cards_accepted: number;
  cards_skipped: number;
  cascaded: number;
  still_open: number;
}

export default function WorkQueue() {
  const [, navigate] = useLocation();
  const [queueState, setQueueState] = useState<QueueState>("IDLE");
  const [session, setSession] = useState<Session | null>(null);
  const [cards, setCards] = useState<Finding[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [summary, setSummary] = useState<SummaryData | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [autoFixLoading, setAutoFixLoading] = useState(false);
  const [autoFixResult, setAutoFixResult] = useState<{
    applied: number;
    failed: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cardError, setCardError] = useState<string | null>(null);
  const [showSkipReasons, setShowSkipReasons] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/work-queue/status`);
      const data = await res.json();
      return data;
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    const init = async () => {
      const data = await fetchStatus();
      if (data?.session) {
        setSession(data.session);
        if (
          data.session.status === "PENDING" ||
          data.session.status === "ANALYSING"
        ) {
          setQueueState("PREPARING");
          startPolling();
        } else if (data.session.status === "READY") {
          setQueueState("PHASE_1_SUMMARY");
        } else if (data.session.status === "COMPLETE") {
          await loadSummary();
          setQueueState("SUMMARY");
        }
      }
      setLoading(false);
    };
    init();
    return () => stopPolling();
  }, []);

  const startPolling = useCallback(() => {
    stopPolling();
    pollRef.current = setInterval(async () => {
      const data = await fetchStatus();
      if (!data?.session) return;
      setSession(data.session);
      if (data.session.status === "READY") {
        stopPolling();
        setQueueState("PHASE_1_SUMMARY");
      } else if (data.session.status === "COMPLETE") {
        stopPolling();
        await loadSummary();
        setQueueState("SUMMARY");
      } else if (data.session.status === "FAILED") {
        stopPolling();
        setError(data.session.error_message || "Analysis failed");
      }
    }, 2000);
  }, [fetchStatus, stopPolling]);

  const handleStart = async () => {
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/work-queue/start`, {
        method: "POST",
      });
      const data = await res.json();
      if (data.already_running) {
        setSession(data.session);
        setQueueState("PREPARING");
        startPolling();
        return;
      }
      setSession(data.session);
      if (data.session.status === "COMPLETE" && data.session.total_tasks === 0) {
        await loadSummary();
        setQueueState("SUMMARY");
      } else {
        setQueueState("PREPARING");
        startPolling();
      }
    } catch {
      setError("Failed to start analysis");
    }
  };

  const handleAutoFix = async () => {
    setAutoFixLoading(true);
    try {
      const res = await fetch(`${API_BASE}/work-queue/auto-fix`, {
        method: "POST",
      });
      const data = await res.json();
      setAutoFixResult({ applied: data.applied, failed: data.failed });
      setSession(data.session);
    } catch {
      setAutoFixResult({ applied: 0, failed: 0 });
    } finally {
      setAutoFixLoading(false);
    }
  };

  useEffect(() => {
    if (queueState === "PHASE_1_SUMMARY" && !autoFixResult && !autoFixLoading) {
      handleAutoFix();
    }
  }, [queueState]);

  const loadCards = async () => {
    try {
      const res = await fetch(`${API_BASE}/work-queue/cards`);
      const data = await res.json();
      if (!data.cards || data.cards.length === 0) {
        await loadSummary();
        setQueueState("SUMMARY");
        return;
      }
      setCards(data.cards);
      setCurrentIndex(0);
      setSession(data.session);
    } catch {
      setError("Failed to load cards");
    }
  };

  const loadSummary = async () => {
    try {
      const res = await fetch(`${API_BASE}/work-queue/summary`);
      const data = await res.json();
      setSummary(data.summary);
    } catch {
      /* silent */
    }
  };

  const handleAccept = async (findingId: string) => {
    setCardError(null);
    setActionLoading(true);
    try {
      const res = await fetch(
        `${API_BASE}/work-queue/cards/${findingId}/accept`,
        { method: "POST" }
      );
      if (!res.ok) {
        const err = await res.json();
        setCardError(err.error || "Accept failed");
        return;
      }
      const data = await res.json();
      setSession(data.session);
      advanceCard();
    } catch {
      setCardError("Failed to accept — try again");
    } finally {
      setActionLoading(false);
    }
  };

  const handleSkip = async (findingId: string, reason: string) => {
    setCardError(null);
    setActionLoading(true);
    try {
      const res = await fetch(
        `${API_BASE}/work-queue/cards/${findingId}/skip`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reason }),
        }
      );
      if (!res.ok) {
        const err = await res.json();
        setCardError(err.error || "Skip failed");
        return;
      }
      const data = await res.json();
      setSession(data.session);
      setShowSkipReasons(false);
      advanceCard();
    } catch {
      setCardError("Failed to skip — try again");
    } finally {
      setActionLoading(false);
    }
  };

  const advanceCard = () => {
    const nextIndex = currentIndex + 1;
    if (nextIndex >= cards.length) {
      loadSummary().then(() => setQueueState("SUMMARY"));
    } else {
      setCurrentIndex(nextIndex);
      setShowSkipReasons(false);
      setCardError(null);
    }
  };

  const handleRunAgain = async () => {
    setAutoFixResult(null);
    setSummary(null);
    setCards([]);
    setCurrentIndex(0);
    setError(null);
    await handleStart();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (queueState === "IDLE") {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Card className="w-full max-w-lg text-center">
          <CardHeader className="pb-4">
            <div className="mx-auto mb-4 w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center">
              <Zap className="w-8 h-8 text-primary" />
            </div>
            <CardTitle className="text-2xl">Work Queue</CardTitle>
            <p className="text-muted-foreground mt-2">
              Run a compliance audit across all open review tasks. The system
              will automatically fix objective violations and surface content
              decisions for your review.
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            <Button size="lg" className="w-full" onClick={handleStart}>
              <Zap className="w-4 h-4 mr-2" />
              Start Compliance Audit
            </Button>
            <p className="text-xs text-muted-foreground">
              This will analyse all open Review tasks against compliance
              constants and document content.
            </p>
            {error && (
              <div className="flex items-center gap-2 text-destructive text-sm">
                <AlertCircle className="w-4 h-4" />
                {error}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  if (queueState === "PREPARING") {
    const progress =
      session && session.total_tasks > 0
        ? (session.analysed_tasks / session.total_tasks) * 100
        : 0;

    if (error) {
      return (
        <div className="flex items-center justify-center min-h-[60vh]">
          <Card className="w-full max-w-lg text-center">
            <CardHeader className="pb-4">
              <div className="mx-auto mb-4 w-16 h-16 rounded-full bg-destructive/10 flex items-center justify-center">
                <AlertCircle className="w-8 h-8 text-destructive" />
              </div>
              <CardTitle className="text-2xl">Analysis Failed</CardTitle>
              <p className="text-muted-foreground mt-2">{error}</p>
            </CardHeader>
            <CardContent>
              <Button onClick={handleRunAgain}>Try Again</Button>
            </CardContent>
          </Card>
        </div>
      );
    }

    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Card className="w-full max-w-lg text-center">
          <CardHeader className="pb-4">
            <div className="mx-auto mb-4 w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center">
              <Loader2 className="w-8 h-8 text-primary animate-spin" />
            </div>
            <CardTitle className="text-2xl">Analysing documents…</CardTitle>
            <p className="text-muted-foreground mt-2">
              Claude is reviewing your documents against compliance rules. This
              takes about 30 seconds.
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="w-full bg-muted rounded-full h-3 overflow-hidden">
              <div
                className="bg-primary h-full rounded-full transition-all duration-500"
                style={{ width: `${progress}%` }}
              />
            </div>
            <p className="text-sm text-muted-foreground">
              Analysed {session?.analysed_tasks || 0} of{" "}
              {session?.total_tasks || 0} documents
            </p>
            <p className="text-xs text-muted-foreground/70">
              You can leave this page — the analysis continues in the
              background.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (queueState === "PHASE_1_SUMMARY") {
    if (autoFixLoading || !autoFixResult) {
      return (
        <div className="flex items-center justify-center min-h-[60vh]">
          <Card className="w-full max-w-lg text-center">
            <CardHeader>
              <div className="mx-auto mb-4 w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center">
                <Loader2 className="w-8 h-8 text-primary animate-spin" />
              </div>
              <CardTitle>Applying automatic fixes…</CardTitle>
            </CardHeader>
          </Card>
        </div>
      );
    }

    const hasAutoFixes = autoFixResult.applied > 0;
    const cardsTotal = session?.cards_total || 0;
    const pendingCards =
      cardsTotal -
      (session?.cards_resolved || 0) -
      (session?.cards_skipped || 0);

    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Card
          className={`w-full max-w-lg text-center ${hasAutoFixes ? "border-green-500/30" : ""}`}
        >
          <CardHeader className="pb-4">
            <div
              className={`mx-auto mb-4 w-16 h-16 rounded-full flex items-center justify-center ${hasAutoFixes ? "bg-green-500/10" : "bg-muted"}`}
            >
              <CheckCircle
                className={`w-8 h-8 ${hasAutoFixes ? "text-green-500" : "text-muted-foreground"}`}
              />
            </div>
            <CardTitle className="text-2xl">Phase 1 Complete</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-2">
              {hasAutoFixes ? (
                <>
                  <p className="text-lg font-semibold">
                    {autoFixResult.applied} compliance issue
                    {autoFixResult.applied !== 1 ? "s" : ""} fixed
                    automatically
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {session?.cascaded_count || 0} downstream document
                    {(session?.cascaded_count || 0) !== 1 ? "s" : ""} flagged
                    for review
                  </p>
                </>
              ) : (
                <p className="text-muted-foreground">
                  No automatic fixes needed — all compliance figures are
                  correct.
                </p>
              )}
            </div>

            {pendingCards > 0 ? (
              <Button
                size="lg"
                className="w-full"
                onClick={() => {
                  setQueueState("PHASE_2_CARDS");
                  loadCards();
                }}
              >
                Review {pendingCards} content decision
                {pendingCards !== 1 ? "s" : ""}
                <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            ) : (
              <Button
                size="lg"
                className="w-full"
                onClick={async () => {
                  await loadSummary();
                  setQueueState("SUMMARY");
                }}
              >
                All done — queue is clear
                <CheckCircle className="w-4 h-4 ml-2" />
              </Button>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  if (queueState === "PHASE_2_CARDS") {
    if (cards.length === 0) {
      return (
        <div className="flex items-center justify-center min-h-[60vh]">
          <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
        </div>
      );
    }

    const card = cards[currentIndex];
    if (!card) {
      loadSummary().then(() => setQueueState("SUMMARY"));
      return null;
    }

    const tierColors: Record<number, string> = {
      1: "bg-red-500/10 text-red-500 border-red-500/30",
      2: "bg-amber-500/10 text-amber-500 border-amber-500/30",
      3: "bg-blue-500/10 text-blue-500 border-blue-500/30",
    };

    return (
      <div className="max-w-3xl mx-auto space-y-4">
        <Card>
          <CardHeader className="pb-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Badge
                  variant="outline"
                  className={tierColors[card.document_tier] || tierColors[3]}
                >
                  Tier {card.document_tier}
                </Badge>
                <div className="flex items-center gap-2">
                  <FileText className="w-4 h-4 text-muted-foreground" />
                  <span className="font-semibold">{card.document_name}</span>
                </div>
              </div>
              <span className="text-sm text-muted-foreground">
                Card {currentIndex + 1} of {cards.length}
              </span>
            </div>
          </CardHeader>
          <CardContent className="space-y-6">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                Issue identified
              </p>
              <p className="text-sm leading-relaxed">
                {card.issue_description}
              </p>
            </div>

            {card.original_text && (
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                  Current text
                </p>
                <pre className="bg-muted rounded-md p-4 text-sm whitespace-pre-wrap font-mono overflow-x-auto">
                  {card.original_text}
                </pre>
              </div>
            )}

            {card.proposed_fix && (
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                  Suggested fix
                </p>
                <pre className="bg-green-500/5 border border-green-500/20 rounded-md p-4 text-sm whitespace-pre-wrap font-mono overflow-x-auto">
                  {card.proposed_fix}
                </pre>
              </div>
            )}

            {cardError && (
              <div className="flex items-center gap-2 text-destructive text-sm bg-destructive/10 rounded-md p-3">
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                {cardError}
              </div>
            )}

            <div className="flex items-center gap-3 pt-2">
              <Button
                className="bg-green-600 hover:bg-green-700 text-white"
                disabled={actionLoading}
                onClick={() => handleAccept(card.id)}
              >
                {actionLoading ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <CheckCircle className="w-4 h-4 mr-2" />
                )}
                Accept fix
              </Button>
              <Button
                variant="outline"
                disabled={actionLoading}
                onClick={() => setShowSkipReasons(!showSkipReasons)}
              >
                <XCircle className="w-4 h-4 mr-2" />
                Skip
              </Button>
            </div>

            {showSkipReasons && (
              <div className="flex items-center gap-2 pl-1">
                <span className="text-xs text-muted-foreground mr-1">
                  Reason:
                </span>
                {["Not relevant", "Needs more context", "Defer"].map(
                  (reason) => (
                    <Button
                      key={reason}
                      variant="ghost"
                      size="sm"
                      className="text-xs"
                      disabled={actionLoading}
                      onClick={() => handleSkip(card.id, reason)}
                    >
                      {reason}
                    </Button>
                  )
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  if (queueState === "SUMMARY") {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Card className="w-full max-w-lg text-center">
          <CardHeader className="pb-4">
            <div className="mx-auto mb-4 w-16 h-16 rounded-full bg-green-500/10 flex items-center justify-center">
              <CheckCircle className="w-8 h-8 text-green-500" />
            </div>
            <CardTitle className="text-2xl">Queue complete</CardTitle>
            <p className="text-muted-foreground mt-2">
              Here's what happened in this session.
            </p>
          </CardHeader>
          <CardContent className="space-y-6">
            {summary ? (
              <>
                <div className="grid grid-cols-2 gap-4">
                  <div className="bg-muted/50 rounded-lg p-4">
                    <p className="text-2xl font-bold">{summary.auto_fixed}</p>
                    <p className="text-xs text-muted-foreground">Auto-fixed</p>
                  </div>
                  <div className="bg-muted/50 rounded-lg p-4">
                    <p className="text-2xl font-bold">
                      {summary.cards_accepted}
                    </p>
                    <p className="text-xs text-muted-foreground">Accepted</p>
                  </div>
                  <div className="bg-muted/50 rounded-lg p-4">
                    <p className="text-2xl font-bold">
                      {summary.cards_skipped}
                    </p>
                    <p className="text-xs text-muted-foreground">Skipped</p>
                  </div>
                  <div className="bg-muted/50 rounded-lg p-4">
                    <p className="text-2xl font-bold">{summary.cascaded}</p>
                    <p className="text-xs text-muted-foreground">Cascaded</p>
                  </div>
                </div>

                {summary.still_open > 0 && (
                  <div className="bg-amber-500/10 border border-amber-500/30 rounded-md p-3 text-sm text-amber-600">
                    {summary.still_open} finding
                    {summary.still_open !== 1 ? "s were" : " was"} skipped and
                    remain{summary.still_open === 1 ? "s" : ""} open. They will
                    appear in the next queue run.
                  </div>
                )}
              </>
            ) : (
              <p className="text-muted-foreground">No session data.</p>
            )}

            <div className="flex items-center gap-3 justify-center">
              <Button onClick={handleRunAgain}>Run again</Button>
              <Button variant="ghost" onClick={() => navigate("/tasks")}>
                Back to tasks
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return null;
}
