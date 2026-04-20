// Phase 4.8 — Dedicated Outcomes page.
//
// Operator inbox for outcome_reviews. Complements the compact drawer
// (which stays the triage surface on Call Command): this page is the
// full workspace, where closers especially spend time working through
// handed-off outcomes.
//
// Session 1 scope: Mine / All tabs, status filter, list table, click
// a row to open the existing OutcomeDrawer. Session 2 adds the
// expanded detail view (inline edits, full fact-find with provenance,
// admin controls). See project_phase_4_8_outcomes_page.md for the
// full scope.

import { useEffect, useMemo, useRef, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2, Inbox, UserPlus, CornerUpLeft, CheckCircle2, Clock, AlertTriangle } from "lucide-react";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { apiFetch } from "@/lib/apiClient";
import OutcomeDrawer from "@/components/OutcomeDrawer";
import { cn } from "@/lib/utils";

const API_BASE = (import.meta.env.BASE_URL?.replace(/\/$/, "") || "") + "/api";

// Mirror the server-side status constants. Keep in sync with
// ACTIVE_STATUSES in routes/outcome-reviews/index.ts.
type ReviewStatus =
  | "awaiting_review" | "under_review"
  | "handed_to_closer" | "handed_to_agent"
  | "actioned" | "stale_escaped";

interface ReviewRow {
  id: string;
  status: ReviewStatus;
  engine_run_id: string;
  contact_id: string;
  current_owner_user_id: string | null;
  handed_from_user_id: string | null;
  hand_note: string | null;
  handed_at: string | null;
  claimed_at: string | null;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
  contact: {
    id: string;
    first_name: string;
    last_name: string;
    phone: string | null;
    company: string | null;
    last_call_outcome: string | null;
  };
  run: { id: string; call_type: string; engine_version: string; status: string };
  outcomeTag: string | null;
  owner: { id: string; name: string | null; email: string } | null;
  decisionCount: number;
}

type Scope = "mine" | "all";
type StatusFilter = "active" | "all" | ReviewStatus;

const STATUS_LABELS: Record<ReviewStatus, string> = {
  awaiting_review: "Awaiting review",
  under_review: "Under review",
  handed_to_closer: "Handed to closer",
  handed_to_agent: "Bounced back",
  actioned: "Actioned",
  stale_escaped: "Stale",
};

const STATUS_STYLES: Record<ReviewStatus, string> = {
  awaiting_review: "bg-blue-500/15 text-blue-700 border-blue-500/30",
  under_review: "bg-amber-500/15 text-amber-700 border-amber-500/30",
  handed_to_closer: "bg-purple-500/15 text-purple-700 border-purple-500/30",
  handed_to_agent: "bg-amber-500/15 text-amber-700 border-amber-500/30",
  actioned: "bg-green-500/15 text-green-700 border-green-500/30",
  stale_escaped: "bg-red-500/15 text-red-700 border-red-500/30",
};

const OUTCOME_TAG_STYLES: Record<string, string> = {
  "EIS-QUALIFIED": "bg-green-500/15 text-green-700 border-green-500/40",
  "LONG-HORIZON":  "bg-amber-500/15 text-amber-700 border-amber-500/40",
  "INTERMEDIARY":  "bg-blue-500/15 text-blue-700 border-blue-500/40",
  "CLOUDWORKZ":    "bg-purple-500/15 text-purple-700 border-purple-500/40",
  "CLOSED":        "bg-slate-500/15 text-slate-700 border-slate-500/40",
};

function ageLabel(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(ms / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 48) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export default function OutcomesPage() {
  const { data: currentUser } = useCurrentUser();
  // role in the hook type-narrows to "agent" | "admin" because "closer"
  // wasn't in the original ladder. Cast through string for the comparison
  // — runtime role values come from the backend which has all three.
  const role = String(currentUser?.user?.role ?? "agent");
  const canSeeAll = role === "closer" || role === "admin";

  const [scope, setScope] = useState<Scope>("mine");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("active");
  const [rows, setRows] = useState<ReviewRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Drawer state — reuses the OutcomeDrawer component from Call Command.
  // We just need contactId + name; the drawer fetches everything else.
  const [selectedReview, setSelectedReview] = useState<ReviewRow | null>(null);

  // SSE refresh — when a new call.tagged lands, refresh the list if the
  // user is viewing this page. Same stream Call Command listens to.
  const refreshTriggerRef = useRef(0);
  useEffect(() => {
    const url = `${API_BASE}/events/queue`;
    const es = new EventSource(url);
    const bump = () => { refreshTriggerRef.current += 1; loadList(); };
    es.addEventListener("call.tagged", bump);
    es.addEventListener("untagged-sweep", bump);
    es.onerror = () => { /* auto-reconnects */ };
    return () => { es.close(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, statusFilter]);

  const loadList = async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set("scope", scope);
      params.set("status", statusFilter);
      const res = await apiFetch(`${API_BASE}/outcome-reviews?${params.toString()}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setRows(data.reviews || []);
      setTotal(data.total || 0);
    } catch (err: any) {
      setError(err?.message || "Failed to load");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, statusFilter]);

  // Also refresh when the drawer closes — the user may have handed the
  // review off or actioned an item, and the list should reflect that.
  const onDrawerClose = () => {
    setSelectedReview(null);
    loadList();
  };

  // Count-badge ticker alongside the tabs. Shows active-inbox sizes.
  const [counts, setCounts] = useState<{ mine: number; all: number | null }>({ mine: 0, all: null });
  useEffect(() => {
    (async () => {
      try {
        const res = await apiFetch(`${API_BASE}/outcome-reviews/count`);
        if (res.ok) {
          const data = await res.json();
          setCounts({ mine: data.mine ?? 0, all: data.all });
        }
      } catch { /* ignore */ }
    })();
  }, [rows]); // refresh counts whenever the list does

  const statusOptions: { value: StatusFilter; label: string }[] = useMemo(() => ([
    { value: "active", label: "Active" },
    { value: "all", label: "All statuses" },
    { value: "awaiting_review", label: "Awaiting review" },
    { value: "under_review", label: "Under review" },
    { value: "handed_to_closer", label: "Handed to closer" },
    { value: "handed_to_agent", label: "Bounced back" },
    { value: "actioned", label: "Actioned" },
    { value: "stale_escaped", label: "Stale" },
  ]), []);

  return (
    <div className="space-y-5 max-w-7xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3">
            <Inbox className="w-7 h-7 text-muted-foreground" />
            Outcomes
          </h1>
          <p className="text-muted-foreground mt-1">
            Review engine-analysed calls, approve follow-ups, hand off to a closer.
          </p>
        </div>
      </div>

      <Card>
        <CardContent className="py-4 space-y-4">
          {/* Scope tabs + status filter + count */}
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <Tabs value={scope} onValueChange={(v) => setScope(v as Scope)}>
              <TabsList>
                <TabsTrigger value="mine" className="gap-1.5">
                  Mine
                  {counts.mine > 0 && (
                    <Badge variant="outline" className="ml-1 bg-primary/15 border-primary/30 text-primary text-[10px] px-1.5 py-0">
                      {counts.mine}
                    </Badge>
                  )}
                </TabsTrigger>
                {canSeeAll && (
                  <TabsTrigger value="all" className="gap-1.5">
                    All
                    {counts.all != null && counts.all > 0 && (
                      <Badge variant="outline" className="ml-1 bg-muted text-muted-foreground text-[10px] px-1.5 py-0">
                        {counts.all}
                      </Badge>
                    )}
                  </TabsTrigger>
                )}
              </TabsList>
            </Tabs>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Status</span>
              <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as StatusFilter)}>
                <SelectTrigger className="w-[180px] h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {statusOptions.map(o => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <span className="text-xs text-muted-foreground">
                {total} {total === 1 ? "outcome" : "outcomes"}
              </span>
            </div>
          </div>

          {/* Error banner */}
          {error && (
            <div className="rounded border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive flex items-center gap-2">
              <AlertTriangle className="w-4 h-4" /> {error}
            </div>
          )}

          {/* List table */}
          {loading && rows.length === 0 ? (
            <div className="py-10 text-center text-muted-foreground">
              <Loader2 className="w-5 h-5 animate-spin mx-auto mb-2" />
              Loading…
            </div>
          ) : rows.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground">
              <Inbox className="w-10 h-10 mx-auto mb-2 opacity-40" />
              <p className="font-medium">No outcomes {statusFilter === "active" ? "needing your attention" : "match the filter"}.</p>
              <p className="text-sm mt-0.5">
                {scope === "mine"
                  ? "Outcomes that arrive on your inbox will appear here."
                  : "Change the status filter or check Mine."}
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Contact</TableHead>
                  <TableHead>Outcome</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Owner</TableHead>
                  <TableHead>Call</TableHead>
                  <TableHead>Age</TableHead>
                  <TableHead className="text-right">Items</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => {
                  const fullName = `${r.contact.first_name ?? ""} ${r.contact.last_name ?? ""}`.trim() || "Contact";
                  const fromHandoff = r.handed_from_user_id != null;
                  return (
                    <TableRow
                      key={r.id}
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() => setSelectedReview(r)}
                    >
                      <TableCell>
                        <div className="font-medium">{fullName}</div>
                        {r.contact.company && (
                          <div className="text-xs text-muted-foreground">{r.contact.company}</div>
                        )}
                      </TableCell>
                      <TableCell>
                        {r.outcomeTag ? (
                          <Badge variant="outline" className={cn("text-xs", OUTCOME_TAG_STYLES[r.outcomeTag] ?? "")}>
                            {r.outcomeTag}
                          </Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground/60">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1.5">
                          <Badge variant="outline" className={cn("text-xs", STATUS_STYLES[r.status])}>
                            {STATUS_LABELS[r.status]}
                          </Badge>
                          {fromHandoff && r.status === "handed_to_closer" && (
                            <UserPlus className="w-3.5 h-3.5 text-purple-600" />
                          )}
                          {fromHandoff && r.status === "handed_to_agent" && (
                            <CornerUpLeft className="w-3.5 h-3.5 text-amber-600" />
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-sm">
                        {r.owner ? (r.owner.name ?? r.owner.email) : (
                          <span className="text-xs text-muted-foreground/60 italic">Unclaimed</span>
                        )}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {r.run.call_type}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                        <Clock className="w-3 h-3 inline mr-0.5 opacity-60" />
                        {ageLabel(r.updated_at)}
                      </TableCell>
                      <TableCell className="text-right">
                        {r.decisionCount > 0 ? (
                          <Badge variant="outline" className="text-xs gap-0.5">
                            <CheckCircle2 className="w-3 h-3" /> {r.decisionCount}
                          </Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground/60">—</span>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Reuse the drawer as the detail view for session 1. Session 2
          replaces this with a dedicated expanded page. */}
      <OutcomeDrawer
        open={selectedReview !== null}
        contactId={selectedReview?.contact_id ?? null}
        contactName={selectedReview
          ? `${selectedReview.contact.first_name ?? ""} ${selectedReview.contact.last_name ?? ""}`.trim() || "Contact"
          : null}
        conversationId={null}
        outcomeTag={selectedReview?.outcomeTag ?? undefined}
        onClose={onDrawerClose}
      />
    </div>
  );
}
