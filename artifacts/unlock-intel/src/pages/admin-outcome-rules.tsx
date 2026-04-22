// Phase 7.1a session 3 — Outcome rules admin page.
// Phase 7.1b session 2 — Editable CRUD.
//
// Three panes:
//   1. Rules table — all rules ordered by priority. Click a row to
//      expand the full clause JSON + action list. Edit/Delete buttons
//      on hover. "+ New rule" at top.
//   2. Run picker — recent engine_runs with contact name, call type,
//      NBA summary. Click to replay rules against that run's context.
//   3. Trace view — step-by-step evaluator output. For each rule:
//      matched (green) or failed (muted) with the exact failing clause
//      rendered inline. The matched rule highlights in the main table
//      via cross-link.

import { Fragment, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  ArrowLeft,
  CheckCircle2,
  ChevronRight,
  Loader2,
  Pencil,
  Plus,
  Trash2,
  XCircle,
} from "lucide-react";
import { apiFetch } from "@/lib/apiClient";

interface RuleAction {
  action_type: string;
  owner: string;
  timing: string;
  detail: string;
  uses_content: boolean;
  next_call_type?: "cold_call" | "demo" | "opportunity" | "none" | null;
}

interface OutcomeRule {
  id: string;
  priority: number;
  enabled: boolean;
  when_clauses: Array<{ lvalue: string; op: string; rvalue: unknown }>;
  actions: RuleAction[] | null;
  // Legacy single-action fields — nullable in 7.1b. Read only by the
  // backend loader when actions is null (transitional migration).
  action_type: string | null;
  owner: string | null;
  timing: string | null;
  detail: string | null;
  uses_content: boolean | null;
  created_at: string;
  updated_at: string;
}

// Normalise a rule to its active actions list. If the row has the new
// `actions` array, use it. Otherwise synthesize a single-element list
// from the legacy columns so downstream rendering doesn't have to
// branch.
function actionsFor(r: OutcomeRule): RuleAction[] {
  if (Array.isArray(r.actions) && r.actions.length > 0) return r.actions;
  return [{
    action_type: r.action_type ?? "no_action",
    owner: r.owner ?? "system",
    timing: r.timing ?? "scheduled",
    detail: r.detail ?? "",
    uses_content: r.uses_content ?? false,
  }];
}

const LVALUE_SUGGESTIONS = [
  "callType",
  "content",
  "signal.S1.state",
  "signal.S2.state",
  "signal.S3.state",
  "signal.S4.state",
  "signal.S5.state",
  "signal.S6.state",
  "signal.C1.state",
  "signal.C2.state",
  "signal.C3.state",
  "signal.C4.state",
  "signal.G1.state",
  "signal.L1.state",
  "signal.P2.state",
  "signal.QT.state",
  "signal.QL.state",
  "gate.pack1",
  "gate.c4Compliance",
  "gate.activeRoute",
  "investor.demoScore",
  "investor.persona",
  "investor.hotButton",
];
// Loose equality (== / !=) removed from picker — it only differs from
// strict when types get accidentally mismatched, which is what we want
// to notice, not silently rescue. The backend evaluator still accepts
// them in case any historical rule row has them.
const OP_OPTIONS = ["===", "!==", ">", ">=", "<", "<="] as const;
const OP_LABELS: Record<string, string> = {
  "===": "equals",
  "!==": "not equal",
  "==": "equals (loose)",
  "!=": "not equal (loose)",
  ">": "greater than",
  ">=": "greater than or equal",
  "<": "less than",
  "<=": "less than or equal",
};
function labelOp(op: string): string { return OP_LABELS[op] ?? op; }

const SIGNAL_CODES = ["QT","QL","C1","C2","C3","C4","G1","G2","G3","L1","L2","P2","P3","S1","S2","S3","S4","S5","S6"];
const SIGNAL_STATES = ["green","amber","grey","red","n_a","confirmed","not_confirmed","unknown"];
type RvalueKind = { kind: "enum"; options: string[] } | { kind: "number" } | { kind: "text" } | { kind: "null-only" };
function rvalueOptionsFor(lvalue: string): RvalueKind {
  if (lvalue === "callType") return { kind: "enum", options: ["cold_call","demo","opportunity"] };
  if (lvalue === "content") return { kind: "null-only" };
  if (lvalue === "investor.demoScore") return { kind: "number" };
  if (lvalue === "investor.persona") return { kind: "enum", options: ["preserver","growth_seeker","legacy_builder","undetermined"] };
  if (lvalue === "investor.hotButton") return { kind: "enum", options: ["family","freedom","legacy","relief","significance"] };
  if (lvalue === "gate.c4Compliance") return { kind: "enum", options: ["open","blocked"] };
  if (lvalue === "gate.pack1") return { kind: "enum", options: ["eligible","blocked"] };
  if (lvalue === "gate.activeRoute") return { kind: "enum", options: ["book_1","send_100_revisit","nurture","nurture_no_situational","pending"] };
  if (lvalue.startsWith("signal.") && lvalue.endsWith(".state")) return { kind: "enum", options: SIGNAL_STATES };
  return { kind: "text" };
}
const STATIC_LVALUE_LABELS: Record<string, string> = {
  "callType": "Call type",
  "content": "Routed content",
  "gate.c4Compliance": "Risk Comfort gate — blocks investment content when C4 isn't green",
  "gate.pack1": "Pack 1 Eligibility — S2 green + C4 green + demoScore >= 70",
  "gate.activeRoute": "Content Track Route — book_1 / nurture / etc. driven by S2",
  "investor.demoScore": "Demo score (0-100)",
  "investor.persona": "Detected persona",
  "investor.hotButton": "Detected hot button",
};

function humanLvalue(lvalue: string, signalNameMap?: Map<string, string>): string {
  // Static labels cover call type, gates, investor, content — values
  // that don't change often so they're inlined rather than fetched.
  // Signal codes have names fetched from /api/engine/config/signals.
  const staticLabel = STATIC_LVALUE_LABELS[lvalue];
  if (staticLabel) return lvalue + ' (' + staticLabel + ')';
  if (!signalNameMap) return lvalue;
  const m = lvalue.match(/^signal\.([A-Z0-9]+)\.state$/);
  if (!m) return lvalue;
  const name = signalNameMap.get(m[1]!);
  return name ? lvalue + ' (' + name + ')' : lvalue;
}

const LVALUE_GROUPS: Array<{ group: string; items: string[] }> = [
  { group: "Call type", items: ["callType"] },
  { group: "Signals (state)", items: SIGNAL_CODES.map((c) => `signal.${c}.state`) },
  { group: "Gates", items: ["gate.c4Compliance","gate.pack1","gate.activeRoute"] },
  { group: "Investor", items: ["investor.demoScore","investor.persona","investor.hotButton"] },
  { group: "Content", items: ["content"] },
];

const ACTION_TYPE_SUGGESTIONS = [
  "send_content",
  "schedule_call",
  "schedule_adviser_call",
  "reserve_stock",
  "close_deal",
  "escalate_to_tom",
  "move_to_nurture",
  "set_next_call_type",
];
const OWNER_OPTIONS = ["agent", "tom", "system"] as const;
const TIMING_OPTIONS = ["immediate", "24_48_hours", "scheduled"] as const;
const NEXT_CALL_TYPE_OPTIONS = ["cold_call", "demo", "opportunity", "none"] as const;

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

interface SignalInfo { code: string; name: string; category: string }
function fetchSignalCatalog(): Promise<{ signals: SignalInfo[] }> {
  return apiFetch("/api/engine/config/signals").then((r) => {
    if (!r.ok) throw new Error("Signals fetch failed");
    return r.json();
  });
}

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

function clauseText(c: OutcomeRule["when_clauses"][number], signalNameMap?: Map<string, string>): string {
  // Special-case the content lvalue: rules only ever check routed-or-not,
  // so rendering "content equals null" is noise. Render as "routed"
  // or "not routed".
  if (c.lvalue === "content" && c.rvalue === null) {
    return c.op === "!==" ? "routed content (any document)" : "routed content (not routed)";
  }
  return `${humanLvalue(c.lvalue, signalNameMap)} ${labelOp(c.op)} ${JSON.stringify(c.rvalue)}`;
}

function conditionSummary(clauses: OutcomeRule["when_clauses"], signalNameMap?: Map<string, string>): string {
  return clauses.map((c) => clauseText(c, signalNameMap)).join(" AND ");
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
  onEdit,
  onDelete,
  signalNameMap,
}: {
  rules: OutcomeRule[];
  highlightedRuleId: string | null;
  expandedRuleId: string | null;
  onExpand: (id: string | null) => void;
  onEdit: (rule: OutcomeRule) => void;
  onDelete: (rule: OutcomeRule) => void;
  signalNameMap: Map<string, string>;
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-16">Pri</TableHead>
          <TableHead>Rule</TableHead>
          <TableHead>Condition</TableHead>
          <TableHead>Primary action</TableHead>
          <TableHead className="w-20">Actions</TableHead>
          <TableHead className="w-20">Enabled</TableHead>
          <TableHead className="w-24">Edit</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rules.map((r) => {
          const isExpanded = expandedRuleId === r.id;
          const isHighlighted = highlightedRuleId === r.id;
          const acts = actionsFor(r);
          const primary = acts[0]!;
          return (
            <Fragment key={r.id}>
              <TableRow
                className={`group cursor-pointer ${
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
                  {conditionSummary(r.when_clauses, signalNameMap)}
                </TableCell>
                <TableCell className="font-mono text-xs">
                  {primary.action_type} · {primary.owner} · {primary.timing}
                </TableCell>
                <TableCell className="text-xs text-center">
                  <Badge variant="outline">{acts.length}</Badge>
                </TableCell>
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
                <TableCell onClick={(e) => e.stopPropagation()}>
                  <div className="flex items-center gap-1 opacity-40 group-hover:opacity-100 transition-opacity">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 w-7 p-0"
                      onClick={() => onEdit(r)}
                      title="Edit rule"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                      onClick={() => onDelete(r)}
                      title="Delete rule"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
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
                              {clauseText(c, signalNameMap)}
                            </li>
                          ))}
                        </ul>
                      </div>
                      <div>
                        <div className="font-semibold mb-1 text-muted-foreground uppercase tracking-wider">
                          Actions ({acts.length})
                        </div>
                        <ol className="space-y-2 list-decimal pl-4">
                          {acts.map((a, i) => (
                            <li key={i} className="space-y-0.5">
                              <div className="font-mono">
                                {a.action_type}
                                {a.next_call_type ? ` → ${a.next_call_type}` : ""}
                              </div>
                              <div className="text-muted-foreground">
                                {a.owner} · {a.timing}
                                {a.uses_content ? " · uses content" : ""}
                              </div>
                              {a.detail && (
                                <div className="text-muted-foreground">
                                  "{a.detail}"
                                </div>
                              )}
                            </li>
                          ))}
                        </ol>
                        <div className="text-muted-foreground mt-2">
                          Updated: {new Date(r.updated_at).toLocaleString()}
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

// ---- Rule editor dialog ----

interface RuleDraft {
  id: string;
  priority: number;
  enabled: boolean;
  when_clauses: Array<{ lvalue: string; op: string; rvalue: string | number | null }>;
  actions: RuleAction[];
}

function emptyDraft(): RuleDraft {
  return {
    id: "",
    priority: 100,
    enabled: true,
    when_clauses: [{ lvalue: "callType", op: "===", rvalue: "cold_call" }],
    actions: [{ action_type: "send_content", owner: "agent", timing: "24_48_hours", detail: "", uses_content: false }],
  };
}

function draftFromRule(r: OutcomeRule): RuleDraft {
  return {
    id: r.id,
    priority: r.priority,
    enabled: r.enabled,
    when_clauses: r.when_clauses.map((c) => ({
      lvalue: c.lvalue,
      op: c.op,
      rvalue: (c.rvalue === null || typeof c.rvalue === "string" || typeof c.rvalue === "number")
        ? c.rvalue
        : String(c.rvalue),
    })),
    actions: actionsFor(r).map((a) => ({ ...a })),
  };
}

function RuleEditor({
  open,
  mode,
  draft,
  onDraftChange,
  onSave,
  onCancel,
  error,
  saving,
  signalNameMap,
}: {
  open: boolean;
  mode: "create" | "edit";
  draft: RuleDraft;
  onDraftChange: (d: RuleDraft) => void;
  onSave: () => void;
  onCancel: () => void;
  error: string | null;
  saving: boolean;
  signalNameMap: Map<string, string>;
}) {
  const setClause = (i: number, patch: Partial<RuleDraft["when_clauses"][number]>) => {
    onDraftChange({
      ...draft,
      when_clauses: draft.when_clauses.map((c, j) => (i === j ? { ...c, ...patch } : c)),
    });
  };
  const addClause = () =>
    onDraftChange({
      ...draft,
      when_clauses: [...draft.when_clauses, { lvalue: "callType", op: "===", rvalue: "" }],
    });
  const removeClause = (i: number) =>
    onDraftChange({
      ...draft,
      when_clauses: draft.when_clauses.filter((_, j) => j !== i),
    });

  const setAction = (i: number, patch: Partial<RuleAction>) => {
    onDraftChange({
      ...draft,
      actions: draft.actions.map((a, j) => (i === j ? { ...a, ...patch } : a)),
    });
  };
  const addAction = () =>
    onDraftChange({
      ...draft,
      actions: [...draft.actions, { action_type: "set_next_call_type", owner: "system", timing: "immediate", detail: "", uses_content: false, next_call_type: "demo" }],
    });
  const removeAction = (i: number) =>
    onDraftChange({
      ...draft,
      actions: draft.actions.filter((_, j) => j !== i),
    });

  // Parse rvalue: if it looks like a number, store as number; keep null literal; otherwise string.
  const parseRvalue = (raw: string): string | number | null => {
    if (raw === "null") return null;
    if (raw === "") return "";
    const n = Number(raw);
    if (!isNaN(n) && String(n) === raw) return n;
    return raw;
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{mode === "create" ? "New rule" : `Edit rule · ${draft.id}`}</DialogTitle>
          <DialogDescription>
            {mode === "create"
              ? "Rules are evaluated by priority ascending. First match wins."
              : "Changes take effect on the next engine run (cache invalidates on save)."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          {/* Identity + meta */}
          <div className="grid grid-cols-[1fr_120px_auto] gap-3 items-end">
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">ID (slug)</label>
              <Input
                value={draft.id}
                onChange={(e) => onDraftChange({ ...draft, id: e.target.value })}
                disabled={mode === "edit"}
                placeholder="e.g. demo_pack2_eligible"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Priority</label>
              <Input
                type="number"
                value={draft.priority}
                onChange={(e) => onDraftChange({ ...draft, priority: Number(e.target.value) })}
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground block">Enabled</label>
              <div className="h-9 flex items-center">
                <Switch
                  checked={draft.enabled}
                  onCheckedChange={(v) => onDraftChange({ ...draft, enabled: v })}
                />
              </div>
            </div>
          </div>

          {/* Clauses */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <label className="text-sm font-medium">When (all AND-ed)</label>
                <span className="text-xs text-muted-foreground" title="For OR, split into two rules at different priorities. Keeps the trace unambiguous — each failed clause has one obvious cause.">
                  (why no OR?)
                </span>
              </div>
              <Button size="sm" variant="outline" onClick={addClause}>
                <Plus className="w-3 h-3 mr-1" /> Clause
              </Button>
            </div>
            <div className="space-y-2">
              {draft.when_clauses.map((c, i) => (
                <div key={i} className="space-y-1">
                <div className="grid grid-cols-[1fr_90px_1fr_32px] gap-2 items-center">
                  <Select value={c.lvalue} onValueChange={(v) => setClause(i, { lvalue: v, rvalue: null })}>
                    <SelectTrigger className="font-mono text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent className="max-h-[50vh]">
                      {LVALUE_GROUPS.map((grp) => (
                        <SelectGroup key={grp.group}>
                          <SelectLabel className="text-xs text-muted-foreground uppercase tracking-wider">{grp.group}</SelectLabel>
                          {grp.items.map((l) => (
                            <SelectItem key={l} value={l}>
                              <span className="font-mono">{l}</span>
                              {(() => {
                                const staticLabel = STATIC_LVALUE_LABELS[l];
                                if (staticLabel) return <span className="ml-2 text-muted-foreground text-xs">· {staticLabel}</span>;
                                const m = l.match(/^signal\.([A-Z0-9]+)\.state$/);
                                if (!m) return null;
                                const name = signalNameMap.get(m[1]!);
                                return name ? <span className="ml-2 text-muted-foreground text-xs">· {name}</span> : null;
                              })()}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      ))}
                    </SelectContent>
                  </Select>
                  {c.lvalue === "content" ? (
                    // Content is always null or an object; collapse op + rvalue
                    // into one friendly "routed / not routed" picker. Spans
                    // the op + rvalue grid cells via col-span-2.
                    <div className="col-span-2">
                      <Select
                        value={c.op === "!==" ? "routed" : "not_routed"}
                        onValueChange={(v) => {
                          if (v === "routed") setClause(i, { op: "!==", rvalue: null });
                          else setClause(i, { op: "===", rvalue: null });
                        }}
                      >
                        <SelectTrigger className="text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="routed">routed (any document)</SelectItem>
                          <SelectItem value="not_routed">not routed</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  ) : (
                    <>
                      <Select value={c.op} onValueChange={(v) => setClause(i, { op: v })}>
                        <SelectTrigger className="text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {OP_OPTIONS.map((op) => (
                            <SelectItem key={op} value={op}>{labelOp(op)}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <ClauseRvalue
                        lvalue={c.lvalue}
                        rvalue={c.rvalue}
                        onChange={(v) => setClause(i, { rvalue: v })}
                      />
                    </>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
                    onClick={() => removeClause(i)}
                    disabled={draft.when_clauses.length === 1}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
                {c.lvalue === "content" && (
                  <p className="text-xs text-muted-foreground pl-1">
                    {c.op === "==="
                      ? "'not routed' — the routing engine couldn't pick a document for this investor. Typically used for fallback / nurture rules."
                      : "'routed (any document)' — routing picked a document. Use this on rules that send content."}
                  </p>
                )}
                </div>
              ))}
            </div>
          </div>

          {/* Actions */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium">
                Actions ({draft.actions.length}) — first is primary NBA
              </label>
              <Button size="sm" variant="outline" onClick={addAction}>
                <Plus className="w-3 h-3 mr-1" /> Action
              </Button>
            </div>
            <div className="space-y-3">
              {draft.actions.map((a, i) => (
                <div
                  key={i}
                  className={`border rounded p-3 space-y-2 ${
                    i === 0 ? "border-primary/40 bg-primary/5" : ""
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-muted-foreground">
                      {i === 0 ? "PRIMARY" : `SECONDARY #${i}`}
                    </span>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                      onClick={() => removeAction(i)}
                      disabled={draft.actions.length === 1}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <div className="space-y-1">
                      <label className="text-xs text-muted-foreground">Action type</label>
                      <Input
                        list="action-type-suggestions"
                        value={a.action_type}
                        onChange={(e) => setAction(i, { action_type: e.target.value })}
                        className="font-mono text-xs"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs text-muted-foreground">Owner</label>
                      <Input
                        list="owner-suggestions"
                        value={a.owner}
                        onChange={(e) => setAction(i, { owner: e.target.value })}
                        className="font-mono text-xs"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs text-muted-foreground">Timing</label>
                      <Input
                        list="timing-suggestions"
                        value={a.timing}
                        onChange={(e) => setAction(i, { timing: e.target.value })}
                        className="font-mono text-xs"
                      />
                    </div>
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground">
                      Detail (supports {"{docName}"} token)
                    </label>
                    <Input
                      value={a.detail}
                      onChange={(e) => setAction(i, { detail: e.target.value })}
                      placeholder="Operator-facing reason"
                    />
                  </div>
                  <div className="flex items-center gap-4">
                    <label className="flex items-center gap-2 text-xs">
                      <Switch
                        checked={a.uses_content}
                        onCheckedChange={(v) => setAction(i, { uses_content: v })}
                      />
                      Attach routed content
                    </label>
                    {a.action_type === "set_next_call_type" && (
                      <div className="flex items-center gap-2 text-xs">
                        <span className="text-muted-foreground">Next call type:</span>
                        <Select
                          value={a.next_call_type ?? "demo"}
                          onValueChange={(v) => setAction(i, { next_call_type: v as any })}
                        >
                          <SelectTrigger className="h-7 w-32 text-xs"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {NEXT_CALL_TYPE_OPTIONS.map((nct) => (
                              <SelectItem key={nct} value={nct}>{nct}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Datalists for autocomplete */}
          <datalist id="action-type-suggestions">
            {ACTION_TYPE_SUGGESTIONS.map((a) => <option key={a} value={a} />)}
          </datalist>
          <datalist id="owner-suggestions">
            {OWNER_OPTIONS.map((o) => <option key={o} value={o} />)}
          </datalist>
          <datalist id="timing-suggestions">
            {TIMING_OPTIONS.map((t) => <option key={t} value={t} />)}
          </datalist>

          {error && (
            <div className="text-sm text-destructive bg-destructive/10 rounded p-3 whitespace-pre-wrap">
              {error}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={onSave} disabled={saving}>
            {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
            {mode === "create" ? "Create rule" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TracePanel({
  trace,
  onSelectRule,
  signalNameMap,
}: {
  trace: TraceResponse;
  onSelectRule: (ruleId: string) => void;
  signalNameMap: Map<string, string>;
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
                        {clauseText({ lvalue: s.failedClause.lvalue, op: s.failedClause.op, rvalue: s.failedClause.rvalue as any }, signalNameMap)}
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

function ClauseRvalue({ lvalue, rvalue, onChange }: { lvalue: string; rvalue: string | number | null; onChange: (v: string | number | null) => void }) {
  const opts = rvalueOptionsFor(lvalue);
  if (opts.kind === "null-only") {
    return <div className="h-9 px-3 flex items-center text-xs text-muted-foreground border rounded bg-muted/30">null (only valid comparison)</div>;
  }
  if (opts.kind === "number") {
    return <Input type="number" value={rvalue === null ? "" : String(rvalue)} onChange={(e) => { const v = e.target.value; onChange(v === "" ? null : Number(v)); }} placeholder="e.g. 70" className="font-mono text-xs" />;
  }
  if (opts.kind === "enum") {
    const current = rvalue === null ? "" : String(rvalue);
    return (
      <Select value={current} onValueChange={(v) => onChange(v)}>
        <SelectTrigger className="font-mono text-xs"><SelectValue placeholder="Pick a value" /></SelectTrigger>
        <SelectContent>
          {opts.options.map((o) => <SelectItem key={o} value={o} className="font-mono">{o}</SelectItem>)}
        </SelectContent>
      </Select>
    );
  }
  return (
    <Input value={rvalue === null ? "null" : String(rvalue)} onChange={(e) => { const raw = e.target.value; if (raw === "null") onChange(null); else if (raw === "") onChange(""); else { const n = Number(raw); onChange(!isNaN(n) && String(n) === raw ? n : raw); } }} placeholder={String.fromCharCode(34) + "green" + String.fromCharCode(34) + " or 70 or null"} className="font-mono text-xs" />
  );
}

export default function AdminOutcomeRulesPage() {
  const queryClient = useQueryClient();
  const [expandedRuleId, setExpandedRuleId] = useState<string | null>(null);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);

  // Editor dialog state
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorMode, setEditorMode] = useState<"create" | "edit">("create");
  const [editorDraft, setEditorDraft] = useState<RuleDraft>(emptyDraft());
  const [editorError, setEditorError] = useState<string | null>(null);

  const { data: signalsData } = useQuery({
    queryKey: ["engine-config-signals"],
    queryFn: fetchSignalCatalog,
    staleTime: 5 * 60 * 1000,  // signals rarely change — cache 5 min
  });
  const signalNameMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const sig of signalsData?.signals ?? []) m.set(sig.code, sig.name);
    return m;
  }, [signalsData]);

  const { data: rulesData, isLoading: rulesLoading, error: rulesError } =
    useQuery({ queryKey: ["outcome-rules"], queryFn: fetchRules });

  // --- mutations ---
  const invalidateRules = () => {
    queryClient.invalidateQueries({ queryKey: ["outcome-rules"] });
    // Trace view also re-reads rules on the server side; invalidate so a
    // newly-added/removed rule shows up without a hard refresh.
    queryClient.invalidateQueries({ queryKey: ["outcome-rules-trace"] });
  };

  const createMutation = useMutation({
    mutationFn: async (draft: RuleDraft) => {
      const res = await apiFetch("/api/admin/engine-outcome-rules", {
        method: "POST",
        body: JSON.stringify(draft),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((body.messages || [body.error || "create failed"]).join("\n"));
      return body.rule as OutcomeRule;
    },
    onSuccess: () => {
      invalidateRules();
      setEditorOpen(false);
    },
    onError: (err: any) => setEditorError(err?.message || "create failed"),
  });

  const updateMutation = useMutation({
    mutationFn: async (draft: RuleDraft) => {
      const res = await apiFetch(`/api/admin/engine-outcome-rules/${encodeURIComponent(draft.id)}`, {
        method: "PUT",
        body: JSON.stringify(draft),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((body.messages || [body.error || "update failed"]).join("\n"));
      return body.rule as OutcomeRule;
    },
    onSuccess: () => {
      invalidateRules();
      setEditorOpen(false);
    },
    onError: (err: any) => setEditorError(err?.message || "update failed"),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiFetch(`/api/admin/engine-outcome-rules/${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "delete failed");
      }
      return id;
    },
    onSuccess: invalidateRules,
  });

  const openCreate = () => {
    setEditorMode("create");
    setEditorDraft(emptyDraft());
    setEditorError(null);
    setEditorOpen(true);
  };
  const openEdit = (rule: OutcomeRule) => {
    setEditorMode("edit");
    setEditorDraft(draftFromRule(rule));
    setEditorError(null);
    setEditorOpen(true);
  };
  const handleSave = () => {
    setEditorError(null);
    if (editorMode === "create") createMutation.mutate(editorDraft);
    else updateMutation.mutate(editorDraft);
  };
  const handleDelete = (rule: OutcomeRule) => {
    if (!window.confirm(`Delete rule "${rule.id}"? This is permanent.\n\nPrefer the "Enabled" toggle if you want a reversible change.`)) return;
    deleteMutation.mutate(rule.id);
  };
  const saving = createMutation.isPending || updateMutation.isPending;


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
            NBA rule engine — evaluated by priority ascending, first match wins. Click
            a rule to see full clauses + action list. Edit/delete via the
            row buttons, or add a new rule at the top right.
          </p>
        </CardHeader>
      </Card>

      <Card>
        <CardHeader className="pb-2 flex flex-row items-center justify-between">
          <CardTitle className="text-base">Rules</CardTitle>
          <Button size="sm" onClick={openCreate}>
            <Plus className="w-4 h-4 mr-1" /> New rule
          </Button>
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
              onEdit={openEdit}
              onDelete={handleDelete}
              signalNameMap={signalNameMap}
            />
          )}
        </CardContent>
      </Card>

      <RuleEditor
        open={editorOpen}
        mode={editorMode}
        draft={editorDraft}
        onDraftChange={setEditorDraft}
        onSave={handleSave}
        onCancel={() => setEditorOpen(false)}
        error={editorError}
        saving={saving}
        signalNameMap={signalNameMap}
      />

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
              signalNameMap={signalNameMap}
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
