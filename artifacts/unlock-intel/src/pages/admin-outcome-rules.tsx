// Phase 7.1a session 3 — Outcome rules admin page (read-only).
//
// Three panes:
//   1. Rules table — all seeded rules ordered by priority. Click a row
//      to expand the full clause JSON and outcome details.
//   2. Run picker — recent engine_runs with contact name, call type,
//      NBA summary. Click to replay rules against that run's context.
//   3. Trace view — step-by-step evaluator output. For each rule:
//      matched (green) or failed (muted) with the exact failing clause
//      rendered inline. The matched rule highlights in the main table
//      via cross-link.
//
// Edit/CRUD ships in Phase 7.1b. This page is visibility-only —
// helps admins answer "why did the engine pick THIS action?" without
// reading code.

import { Fragment, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  ArrowLeft,
  CheckCircle2,
  ChevronRight,
  Loader2,
  XCircle,
} from "lucide-react";
import { apiFetch } from "@/lib/apiClient";

interface OutcomeRule {
  id: string;
  priority: number;
  enabled: boolean;
  when_clauses: Array<{ lvalue: string; op: string; rvalue: unknown }>;
  action_type: string;
  owner: string;
  timing: string;
  detail: string;
  uses_content: boolean;
  created_at: string;
  updated_at: string;
}

interface RunSummary {
  id: string;
  contactId: string;
  contactName: string;
  conversationId: string | null;
  callType: string;
  engineVersion: string;
  createdAt: string;
  nbaActionType: string | null;
  nbaDetail: string | null;
}

interface TraceStep {
  ruleId: string;
  matched: boolean;
  failedClause?: {
    lvalue: string;
    op: string;
    rvalue: unknown;
    actual: unknown;
  };
}

interface TraceResponse {
  runId: string;
  contactId: string;
  callType: string;
  runCreatedAt: string;
  replay: {
    action: any | null;
    trace: { matchedRuleId: string | null; steps: TraceStep[] } | null;
    evaluatorError: string | null;
  };
  stored: { nextBestAction: any | null };
  caveat: string;
}

// ----- fetchers -----

function fetchRules(): Promise<{ rules: OutcomeRule[] }> {
  return apiFetch("/api/admin/engine-outcome-rules").then((r) => {
    if (!r.ok) throw new Error(`Rules fetch failed (${r.status})`);
    return r.json();
  });
}

function fetchRecentRuns(): Promise<{ runs: RunSummary[] }> {
  return apiFetch("/api/admin/engine-runs/recent?limit=30").then((r) => {
    if (!r.ok) throw new Error(`Runs fetch failed (${r.status})`);
    return r.json();
  });
}

function fetchTrace(runId: string): Promise<TraceResponse> {
  return apiFetch("/api/admin/engine-outcome-rules/trace", {
    method: "POST",
    body: JSON.stringify({ runId }),
  }).then((r) => {
    if (!r.ok) throw new Error(`Trace fetch failed (${r.status})`);
    return r.json();
  });
}

// ----- helpers -----

function conditionSummary(clauses: OutcomeRule["when_clauses"]): string {
  return clauses
    .map((c) => `${c.lvalue} ${c.op} ${JSON.stringify(c.rvalue)}`)
    .join(" AND ");
}

function formatValue(v: unknown): string {
  if (v === null) return "null";
  if (v === undefined) return "undefined";
  if (typeof v === "string") return `"${v}"`;
  return String(v);
}

// ----- sub-components -----

function RulesTable({
  rules,
  highlightedRuleId,
  expandedRuleId,
  onExpand,
}: {
  rules: OutcomeRule[];
  highlightedRuleId: string | null;
  expandedRuleId: string | null;
  onExpand: (id: string | null) => void;
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-16">Pri</TableHead>
          <TableHead>Rule</TableHead>
          <TableHead>Condition</TableHead>
          <TableHead>Action</TableHead>
          <TableHead>Owner</TableHead>
          <TableHead>Timing</TableHead>
          <TableHead className="w-20">Enabled</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rules.map((r) => {
          const isExpanded = expandedRuleId === r.id;
          const isHighlighted = highlightedRuleId === r.id;
          return (
            <Fragment key={r.id}>
              <TableRow
                className={`cursor-pointer ${
                  isHighlighted
                    ? "bg-primary/10"
                    : isExpanded
                    ? "bg-muted"
                    : ""
                }`}
                onClick={() => onExpand(isExpanded ? null : r.id)}
              >
                <TableCell className="font-mono text-xs">
                  {r.priority}
                </TableCell>
                <TableCell className="font-mono text-xs">
                  <div className="flex items-center gap-1">
                    <ChevronRight
                      className={`w-3 h-3 transition-transform ${
                        isExpanded ? "rotate-90" : ""
                      }`}
                    />
                    {r.id}
                  </div>
                </TableCell>
                <TableCell className="text-xs text-muted-foreground max-w-md truncate">
                  {conditionSummary(r.when_clauses)}
                </TableCell>
                <TableCell className="font-mono text-xs">
                  {r.action_type}
                </TableCell>
                <TableCell className="text-xs">{r.owner}</TableCell>
                <TableCell className="text-xs">{r.timing}</TableCell>
                <TableCell>
                  {r.enabled ? (
                    <Badge
                      variant="outline"
                      className="bg-emerald-500/10 text-emerald-600 border-emerald-200"
                    >
                      yes
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="text-muted-foreground">
                      no
                    </Badge>
                  )}
                </TableCell>
              </TableRow>
              {isExpanded && (
                <TableRow className="bg-muted/30">
                  <TableCell colSpan={7} className="p-4">
                    <div className="grid grid-cols-2 gap-4 text-xs">
                      <div>
                        <div className="font-semibold mb-1 text-muted-foreground uppercase tracking-wider">
                          Clauses (all AND-ed)
                        </div>
                        <ul className="space-y-1">
                          {r.when_clauses.map((c, i) => (
                            <li key={i} className="font-mono">
                              <span className="text-muted-foreground">
                                {c.lvalue}
                              </span>{" "}
                              <span className="text-primary">{c.op}</span>{" "}
                              <span>{formatValue(c.rvalue)}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                      <div>
                        <div className="font-semibold mb-1 text-muted-foreground uppercase tracking-wider">
                          Outcome
                        </div>
                        <div className="space-y-0.5">
                          <div>
                            <span className="text-muted-foreground">
                              Action:
                            </span>{" "}
                            <span className="font-mono">{r.action_type}</span>
                          </div>
                          <div>
                            <span className="text-muted-foreground">
                              Detail:
                            </span>{" "}
                            "{r.detail}"
                          </div>
                          <div>
                            <span className="text-muted-foreground">
                              Uses content:
                            </span>{" "}
                            {r.uses_content ? "yes" : "no"}
                          </div>
                          <div>
                            <span className="text-muted-foreground">
                              Updated:
                            </span>{" "}
                            {new Date(r.updated_at).toLocaleString()}
                          </div>
                        </div>
                      </div>
                    </div>
                  </TableCell>
                </TableRow>
              )}
            </Fragment>
          );
        })}
      </TableBody>
    </Table>
  );
}

function TracePanel({
  trace,
  onSelectRule,
}: {
  trace: TraceResponse;
  onSelectRule: (ruleId: string) => void;
}) {
  if (trace.replay.evaluatorError) {
    return (
      <div className="text-sm text-destructive p-3 rounded bg-destructive/10">
        Evaluator error: {trace.replay.evaluatorError}
      </div>
    );
  }
  if (!trace.replay.trace) return null;

  const { matchedRuleId, steps } = trace.replay.trace;
  const stored = trace.stored.nextBestAction;
  const replay = trace.replay.action;
  const storedMatchesReplay =
    replay &&
    stored &&
    replay.actionType === stored.actionType &&
    replay.owner === stored.owner &&
    replay.timing === stored.timing &&
    replay.detail === stored.detail;

  return (
    <div className="space-y-4">
      {/* Caveat */}
      <div className="text-xs text-muted-foreground italic border-l-2 border-muted pl-2">
        {trace.caveat}
      </div>

      {/* Replay vs stored */}
      <div className="grid grid-cols-2 gap-3">
        <div className="border rounded p-3 text-xs">
          <div className="font-semibold text-muted-foreground uppercase tracking-wider mb-1">
            Stored at run time
          </div>
          {stored ? (
            <div className="space-y-0.5 font-mono">
              <div>
                {stored.actionType} · {stored.owner} · {stored.timing}
              </div>
              <div className="text-muted-foreground">"{stored.detail}"</div>
              {stored.contentToSend?.docId != null && (
                <div className="text-muted-foreground">
                  → doc {stored.contentToSend.docId} (
                  {stored.contentToSend.docName})
                </div>
              )}
            </div>
          ) : (
            <div className="text-muted-foreground">—</div>
          )}
        </div>
        <div
          className={`border rounded p-3 text-xs ${
            storedMatchesReplay
              ? "border-emerald-300 bg-emerald-500/5"
              : "border-amber-300 bg-amber-500/5"
          }`}
        >
          <div className="font-semibold text-muted-foreground uppercase tracking-wider mb-1 flex items-center gap-1">
            Rule replay
            {storedMatchesReplay ? (
              <CheckCircle2 className="w-3 h-3 text-emerald-600" />
            ) : (
              <XCircle className="w-3 h-3 text-amber-600" />
            )}
          </div>
          {replay ? (
            <div className="space-y-0.5 font-mono">
              <div>
                {replay.actionType} · {replay.owner} · {replay.timing}
              </div>
              <div className="text-muted-foreground">"{replay.detail}"</div>
              {replay.contentToSend?.docId != null && (
                <div className="text-muted-foreground">
                  → doc {replay.contentToSend.docId} (
                  {replay.contentToSend.docName})
                </div>
              )}
            </div>
          ) : (
            <div className="text-muted-foreground">No match</div>
          )}
        </div>
      </div>

      {/* Step-by-step */}
      <div>
        <div className="text-sm font-semibold mb-2">Evaluation steps</div>
        <div className="space-y-1 text-xs">
          {steps.map((s) => {
            const matched = s.matched;
            return (
              <button
                key={s.ruleId}
                onClick={() => onSelectRule(s.ruleId)}
                className={`w-full text-left flex items-start gap-2 p-2 rounded hover:bg-muted/50 transition-colors ${
                  matched && s.ruleId === matchedRuleId
                    ? "bg-emerald-500/10"
                    : ""
                }`}
              >
                <div className="mt-0.5">
                  {matched ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                  ) : (
                    <XCircle className="w-4 h-4 text-muted-foreground/50 shrink-0" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-mono font-medium">{s.ruleId}</div>
                  {!matched && s.failedClause && (
                    <div className="text-muted-foreground mt-0.5">
                      failed:{" "}
                      <span className="font-mono">
                        {s.failedClause.lvalue} {s.failedClause.op}{" "}
                        {formatValue(s.failedClause.rvalue)}
                      </span>{" "}
                      → actual was{" "}
                      <span className="font-mono">
                        {formatValue(s.failedClause.actual)}
                      </span>
                    </div>
                  )}
                  {matched && s.ruleId === matchedRuleId && (
                    <div className="text-emerald-700 dark:text-emerald-500 mt-0.5 text-xs">
                      matched — stopped here
                    </div>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ----- main page -----

export default function AdminOutcomeRulesPage() {
  const [expandedRuleId, setExpandedRuleId] = useState<string | null>(null);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);

  const { data: rulesData, isLoading: rulesLoading, error: rulesError } =
    useQuery({ queryKey: ["outcome-rules"], queryFn: fetchRules });

  const { data: runsData, isLoading: runsLoading } = useQuery({
    queryKey: ["engine-runs-recent"],
    queryFn: fetchRecentRuns,
  });

  const { data: traceData, isLoading: traceLoading } = useQuery({
    queryKey: ["outcome-rules-trace", selectedRunId],
    queryFn: () => fetchTrace(selectedRunId!),
    enabled: !!selectedRunId,
  });

  const rules = rulesData?.rules ?? [];
  const runs = runsData?.runs ?? [];
  const highlightedRuleId = traceData?.replay.trace?.matchedRuleId ?? null;

  const selectedRun = useMemo(
    () => runs.find((r) => r.id === selectedRunId) ?? null,
    [runs, selectedRunId],
  );

  return (
    <div className="space-y-4 max-w-[1400px] mx-auto">
      <div className="flex items-center gap-3">
        <Link
          href="/admin/engine-config"
          className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1"
        >
          <ArrowLeft className="w-4 h-4" />
          Engine config
        </Link>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle>Outcome rules</CardTitle>
          <p className="text-sm text-muted-foreground mt-1">
            Read-only view of the NBA rule engine. Click a rule to see its
            full clause JSON. Pick an engine run below to replay the rules
            against that run's context — you'll see which rule matched and
            why the others didn't. Edit/CRUD ships in Phase 7.1b.
          </p>
        </CardHeader>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Rules</CardTitle>
        </CardHeader>
        <CardContent>
          {rulesLoading && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading rules…
            </div>
          )}
          {rulesError && (
            <div className="text-sm text-destructive py-4">
              {(rulesError as Error).message}
            </div>
          )}
          {rules.length > 0 && (
            <RulesTable
              rules={rules}
              highlightedRuleId={highlightedRuleId}
              expandedRuleId={expandedRuleId}
              onExpand={setExpandedRuleId}
            />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-start justify-between gap-4">
            <div>
              <CardTitle className="text-base">Trace view</CardTitle>
              <p className="text-xs text-muted-foreground mt-0.5">
                Replays the rules against a stored engine run.
              </p>
            </div>
            <div className="w-96 shrink-0">
              <Select
                value={selectedRunId ?? ""}
                onValueChange={(v) => setSelectedRunId(v)}
              >
                <SelectTrigger>
                  <SelectValue
                    placeholder={
                      runsLoading ? "Loading runs…" : "Pick an engine run"
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  {runs.map((r) => (
                    <SelectItem key={r.id} value={r.id}>
                      <div className="flex items-center gap-2 text-xs">
                        <Badge variant="outline" className="font-mono">
                          {r.callType}
                        </Badge>
                        <span className="truncate">{r.contactName}</span>
                        <span className="text-muted-foreground">
                          · {r.nbaActionType ?? "—"} ·{" "}
                          {new Date(r.createdAt).toLocaleString()}
                        </span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {!selectedRunId && (
            <div className="text-sm text-muted-foreground py-8 text-center">
              Pick a run from the dropdown to see the trace.
            </div>
          )}
          {traceLoading && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
              <Loader2 className="w-4 h-4 animate-spin" /> Running trace…
            </div>
          )}
          {traceData && (
            <TracePanel
              trace={traceData}
              onSelectRule={(id) => setExpandedRuleId(id)}
            />
          )}
          {selectedRun && traceData && (
            <div className="text-xs text-muted-foreground mt-3 pt-3 border-t">
              Run {selectedRun.id} · {selectedRun.callType} ·{" "}
              {selectedRun.contactName} ·{" "}
              {new Date(selectedRun.createdAt).toLocaleString()}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
