import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  FileSearch,
  Loader2,
  CheckCircle,
  AlertCircle,
  XCircle,
  ChevronDown,
  ChevronRight,
  RefreshCw,
  ExternalLink,
} from "lucide-react";
import { useLocation } from "wouter";

const API_BASE =
  (import.meta.env.BASE_URL?.replace(/\/$/, "") || "") + "/api";

type DimensionStatus = "PASS" | "WARN" | "FAIL";

interface HealthScore {
  id: string;
  session_id: string;
  document_id: string;
  document_name: string;
  document_tier: number;
  document_file_code: string;
  identity_status: DimensionStatus;
  identity_issues: any[];
  targeting_status: DimensionStatus;
  targeting_issues: any[];
  belief_status: DimensionStatus;
  belief_issues: any[];
  compliance_status: DimensionStatus;
  compliance_issues: any[];
  propagation_status: DimensionStatus;
  propagation_issues: any[];
  content_status: DimensionStatus;
  content_issues: any[];
  delivery_status: DimensionStatus;
  delivery_issues: any[];
  overall_status: DimensionStatus;
}

interface HealthSession {
  id: string;
  status: string;
  started_at: string;
  completed_at: string | null;
  documents_checked: number;
  documents_healthy: number;
  documents_warning: number;
  documents_failing: number;
}

type PageState = "IDLE" | "RUNNING" | "RESULTS";

function StatusIcon({ status }: { status: DimensionStatus }) {
  if (status === "PASS") return <CheckCircle className="w-4 h-4 text-green-500" />;
  if (status === "WARN") return <AlertCircle className="w-4 h-4 text-amber-500" />;
  return <XCircle className="w-4 h-4 text-red-500" />;
}

function TierBadge({ tier }: { tier: number }) {
  const colors: Record<number, string> = {
    1: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
    2: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
    3: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  };
  return (
    <span className={`px-2 py-0.5 rounded text-xs font-medium ${colors[tier] || "bg-gray-100 text-gray-800"}`}>
      T{tier}
    </span>
  );
}

const DIMENSIONS = [
  { key: "identity", label: "Identity" },
  { key: "targeting", label: "Targeting" },
  { key: "belief", label: "Belief" },
  { key: "compliance", label: "Compliance" },
  { key: "propagation", label: "Propagation" },
  { key: "content", label: "Content" },
  { key: "delivery", label: "Delivery" },
] as const;

export default function DocumentHealth() {
  const [pageState, setPageState] = useState<PageState>("IDLE");
  const [session, setSession] = useState<HealthSession | null>(null);
  const [scores, setScores] = useState<HealthScore[]>([]);
  const [systemFindings, setSystemFindings] = useState<{
    beliefs_with_no_doc: Array<{ id: string; name: string; cluster: string }>;
    stage_coverage_gaps: Array<{ persona: string; stage: string }>;
    never_sent_docs: Array<{ name: string; id: string }>;
  } | null>(null);
  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "FAIL" | "WARN" | "PASS">("all");
  const [tierFilter, setTierFilter] = useState<"all" | 1 | 2 | 3>("all");
  const [, navigate] = useLocation();

  const fetchLatest = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/document-health/latest`);
      const data = await res.json();
      if (data.session) {
        setSession(data.session);
        setScores(data.scores || []);
        if (data.system_findings) setSystemFindings(data.system_findings);
        if (data.session.status === "COMPLETE") {
          setPageState("RESULTS");
        } else if (data.session.status === "RUNNING") {
          setPageState("RUNNING");
        }
      }
    } catch { /* silent */ }
  }, []);

  useEffect(() => {
    fetchLatest();
  }, [fetchLatest]);

  useEffect(() => {
    if (pageState !== "RUNNING") return;
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`${API_BASE}/document-health/latest`);
        const data = await res.json();
        if (data.session) {
          setSession(data.session);
          setScores(data.scores || []);
          if (data.session.status === "COMPLETE" || data.session.status === "FAILED") {
            setPageState(data.session.status === "COMPLETE" ? "RESULTS" : "IDLE");
            clearInterval(interval);
          }
        }
      } catch { /* silent */ }
    }, 2000);
    return () => clearInterval(interval);
  }, [pageState]);

  const startRun = async () => {
    try {
      const res = await fetch(`${API_BASE}/document-health/run`, { method: "POST" });
      const data = await res.json();
      if (data.session) {
        setSession(data.session);
        setPageState("RUNNING");
      }
    } catch { /* silent */ }
  };

  const createReviewTask = async (documentId: string, documentName: string) => {
    try {
      await fetch(`${API_BASE}/tasks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: `Review: ${documentName}`,
          type: "Review",
          linked_document_id: documentId,
        }),
      });
    } catch { /* silent */ }
  };

  const filteredScores = scores.filter(s => {
    if (filter !== "all" && s.overall_status !== filter) return false;
    if (tierFilter !== "all" && s.document_tier !== tierFilter) return false;
    return true;
  });

  const localFindings = getSystemFindings(scores);

  if (pageState === "IDLE") {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Card className="w-full max-w-lg">
          <CardContent className="pt-8 pb-8 text-center space-y-4">
            <div className="mx-auto w-16 h-16 rounded-full bg-muted flex items-center justify-center">
              <FileSearch className="w-8 h-8 text-muted-foreground" />
            </div>
            <h2 className="text-2xl font-bold">Document Health Check</h2>
            <p className="text-muted-foreground text-sm max-w-md mx-auto">
              Analyse every document in your library across 7 dimensions:
              identity, targeting, belief alignment, compliance,
              propagation, content, and delivery.
            </p>
            <Button size="lg" className="w-full" onClick={startRun}>
              <FileSearch className="w-4 h-4 mr-2" />
              Run Health Check
            </Button>
            {session && session.status === "COMPLETE" && (
              <div className="space-y-2 pt-2">
                <p className="text-xs text-muted-foreground">
                  Last checked: {new Date(session.completed_at!).toLocaleString()}.{" "}
                  {session.documents_checked} documents checked.
                </p>
                <Button variant="outline" size="sm" onClick={() => { setPageState("RESULTS"); }}>
                  View last report
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  if (pageState === "RUNNING") {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Card className="w-full max-w-lg">
          <CardContent className="pt-8 pb-8 text-center space-y-4">
            <Loader2 className="w-12 h-12 mx-auto animate-spin text-primary" />
            <h2 className="text-2xl font-bold">Analysing document library...</h2>
            <p className="text-muted-foreground text-sm">
              Checking all CURRENT documents across 7 dimensions.
            </p>
            {session && (
              <p className="text-sm font-medium">
                {session.documents_checked} documents checked
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Document Health Check</h1>
        <div className="flex items-center gap-3">
          {session?.completed_at && (
            <span className="text-xs text-muted-foreground">
              Last run: {new Date(session.completed_at).toLocaleString()}
            </span>
          )}
          <Button variant="outline" size="sm" onClick={startRun}>
            <RefreshCw className="w-4 h-4 mr-1" />
            Run Again
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-4 pb-4 text-center">
            <div className="text-2xl font-bold">{session?.documents_checked ?? 0}</div>
            <div className="text-xs text-muted-foreground">Total Checked</div>
          </CardContent>
        </Card>
        <Card className="border-green-200 dark:border-green-800">
          <CardContent className="pt-4 pb-4 text-center">
            <div className="text-2xl font-bold text-green-600">{session?.documents_healthy ?? 0}</div>
            <div className="text-xs text-muted-foreground">Healthy</div>
          </CardContent>
        </Card>
        <Card className="border-amber-200 dark:border-amber-800">
          <CardContent className="pt-4 pb-4 text-center">
            <div className="text-2xl font-bold text-amber-600">{session?.documents_warning ?? 0}</div>
            <div className="text-xs text-muted-foreground">Warnings</div>
          </CardContent>
        </Card>
        <Card className="border-red-200 dark:border-red-800">
          <CardContent className="pt-4 pb-4 text-center">
            <div className="text-2xl font-bold text-red-600">{session?.documents_failing ?? 0}</div>
            <div className="text-xs text-muted-foreground">Failing</div>
          </CardContent>
        </Card>
      </div>

      <div className="flex items-center gap-2">
        <span className="text-sm text-muted-foreground mr-1">Show:</span>
        {(["all", "FAIL", "WARN", "PASS"] as const).map(f => (
          <Button
            key={f}
            variant={filter === f ? "default" : "outline"}
            size="sm"
            onClick={() => setFilter(f)}
          >
            {f === "all" ? "All" : f === "FAIL" ? "Failing only" : f === "WARN" ? "Warnings" : "Healthy"}
          </Button>
        ))}
        <span className="text-sm text-muted-foreground ml-4 mr-1">Tier:</span>
        {(["all", 1, 2, 3] as const).map(t => (
          <Button
            key={String(t)}
            variant={tierFilter === t ? "default" : "outline"}
            size="sm"
            onClick={() => setTierFilter(t)}
          >
            {t === "all" ? "All" : `T${t}`}
          </Button>
        ))}
      </div>

      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b">
                <th className="text-left p-3 font-medium w-8"></th>
                <th className="text-left p-3 font-medium">Document</th>
                <th className="text-center p-3 font-medium w-16">Tier</th>
                {DIMENSIONS.map(d => (
                  <th key={d.key} className="text-center p-3 font-medium w-20">{d.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredScores.map(score => {
                const isExpanded = expandedRow === score.id;
                const failingDimensions = DIMENSIONS.filter(d => {
                  const status = score[`${d.key}_status` as keyof HealthScore] as DimensionStatus;
                  return status !== "PASS";
                });
                return (
                  <Fragment key={score.id}>
                    <tr
                      className="border-b hover:bg-muted/50 cursor-pointer"
                      onClick={() => setExpandedRow(isExpanded ? null : score.id)}
                    >
                      <td className="p-3">
                        {failingDimensions.length > 0 ? (
                          isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />
                        ) : <span className="w-4 h-4 block" />}
                      </td>
                      <td className="p-3 font-medium truncate max-w-[200px]">{score.document_name}</td>
                      <td className="p-3 text-center"><TierBadge tier={score.document_tier} /></td>
                      {DIMENSIONS.map(d => (
                        <td key={d.key} className="p-3 text-center">
                          <StatusIcon status={score[`${d.key}_status` as keyof HealthScore] as DimensionStatus} />
                        </td>
                      ))}
                    </tr>
                    {isExpanded && failingDimensions.length > 0 && (
                      <tr className="bg-muted/30">
                        <td colSpan={10} className="p-4 pl-12">
                          <div className="space-y-3">
                            {failingDimensions.map(d => {
                              const status = score[`${d.key}_status` as keyof HealthScore] as DimensionStatus;
                              const issues = score[`${d.key}_issues` as keyof HealthScore] as any[];
                              return (
                                <div key={d.key} className="space-y-1">
                                  <div className="flex items-center gap-2 font-medium text-sm">
                                    <StatusIcon status={status} />
                                    {d.label}
                                  </div>
                                  <ul className="ml-6 space-y-1">
                                    {(issues || []).map((issue: any, idx: number) => (
                                      <li key={idx} className="text-xs text-muted-foreground flex items-start gap-1">
                                        <span className="mt-1">•</span>
                                        <span>{issue.message}</span>
                                      </li>
                                    ))}
                                  </ul>
                                  {d.key === "compliance" && status === "FAIL" && (
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      className="ml-6 mt-1"
                                      onClick={(e) => { e.stopPropagation(); createReviewTask(score.document_id, score.document_name); }}
                                    >
                                      Create Review Task
                                    </Button>
                                  )}
                                  {(d.key === "targeting" || d.key === "belief") && (
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      className="ml-6 mt-1"
                                      onClick={(e) => { e.stopPropagation(); navigate(`/registry/${score.document_id}`); }}
                                    >
                                      <ExternalLink className="w-3 h-3 mr-1" />
                                      Edit in Registry
                                    </Button>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
              {filteredScores.length === 0 && (
                <tr>
                  <td colSpan={10} className="p-8 text-center text-muted-foreground">
                    No documents match the current filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Library-wide Findings</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {(systemFindings?.beliefs_with_no_doc?.length ?? 0) > 0 && (
            <div>
              <h4 className="font-medium text-sm mb-1">Beliefs with no document mapping</h4>
              <ul className="text-xs text-muted-foreground space-y-0.5">
                {systemFindings!.beliefs_with_no_doc.map(b => (
                  <li key={b.id}>• {b.name} ({b.cluster})</li>
                ))}
              </ul>
            </div>
          )}
          {(systemFindings?.stage_coverage_gaps?.length ?? 0) > 0 && (
            <div>
              <h4 className="font-medium text-sm mb-1">Stage coverage gaps</h4>
              <ul className="text-xs text-muted-foreground space-y-0.5">
                {systemFindings!.stage_coverage_gaps.map((g, i) => (
                  <li key={i}>• {g.persona} x {g.stage}</li>
                ))}
              </ul>
            </div>
          )}
          {localFindings.propagationOrphans.length > 0 && (
            <div>
              <h4 className="font-medium text-sm mb-1">Propagation orphans (Tier 2/3 with no upstream)</h4>
              <ul className="text-xs text-muted-foreground space-y-0.5">
                {localFindings.propagationOrphans.map(d => (
                  <li key={d}>• {d}</li>
                ))}
              </ul>
            </div>
          )}
          <div>
            <h4 className="font-medium text-sm mb-1">Never-sent documents</h4>
            <p className="text-xs text-muted-foreground mb-1">
              {systemFindings?.never_sent_docs?.length ?? localFindings.neverSentCount} documents have never been sent to a lead
            </p>
            {(systemFindings?.never_sent_docs?.length ?? 0) > 0 && (
              <ul className="text-xs text-muted-foreground space-y-0.5 max-h-40 overflow-y-auto">
                {systemFindings!.never_sent_docs.map(d => (
                  <li key={d.id}>• {d.name}</li>
                ))}
              </ul>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function getSystemFindings(scores: HealthScore[]) {
  const propagationOrphans = scores
    .filter(s => {
      const issues = s.propagation_issues as any[];
      return issues && issues.some((i: any) => i.message?.includes("no upstream"));
    })
    .map(s => s.document_name);

  const neverSentCount = scores.filter(s => s.delivery_status === "WARN").length;

  const beliefsWithNoDoc: string[] = [];

  return { beliefsWithNoDoc, propagationOrphans, neverSentCount };
}

import { Fragment } from "react";
