import { useState, useEffect, useCallback, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { Command, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem } from "@/components/ui/command";
import { Switch } from "@/components/ui/switch";
import { Link } from "wouter";
import {
  Phone, PhoneCall, PhoneOff, PhoneMissed, CalendarClock, UserPlus,
  ArrowRight, Clock, Upload, CheckCircle, XCircle, Calendar,
  ListPlus, TrendingUp, Headphones, ExternalLink, Settings,
  Building2, Mail, MailWarning,
  Loader2, RefreshCw,
  Zap, Send,
  ChevronsUpDown, Check, X
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAircallPhone } from "@/hooks/use-aircall-phone";
import OutcomeDrawer from "@/components/OutcomeDrawer";
import { useCurrentUser, isAdmin } from "@/hooks/useCurrentUser";
import { apiFetch, apiPost } from "@/lib/apiClient";

const API_BASE = (import.meta.env.BASE_URL?.replace(/\/$/, "") || "") + "/api";

/**
 * Feature flag: post-call intelligence surfaces (outcome drawer, outcomes
 * tray, ready/awaiting badges). Hidden by default while the engine features
 * are still being developed. Flip on by setting
 *   VITE_ENABLE_OUTCOME_DRAWER=true
 * in Replit Secrets and redeploying (Vite bakes env vars at build time —
 * a rebuild is required after changing the value).
 *
 * The engine + pending-outcome polling logic keeps running even when this
 * is off, so nothing else changes on flip — only the UI becomes visible.
 */
const SHOW_OUTCOME_DRAWER = import.meta.env.VITE_ENABLE_OUTCOME_DRAWER === "true";

interface CallContact {
  id: string; first_name: string; last_name: string; email: string | null;
  phone: string | null; company: string | null; call_attempts: number;
  last_call_outcome: string | null; priority: string;
}

// Map canonical outcome → human-readable label + Tailwind classes.
const OUTCOME_LABEL: Record<string, string> = {
  "interested": "Interested",
  "no-interest": "Not interested",
  "no-answer": "No answer",
  "callback-requested": "Callback",
  "meeting-booked": "Meeting booked",
  "hung-up": "Hung up",
  "do-not-call": "DNC",
  "does-not-exist": "Wrong number",
};
function outcomeBadgeClasses(outcome: string | null): string {
  switch (outcome) {
    case "interested":
    case "meeting-booked":
      return "bg-green-500/15 text-green-600 border-green-500/30";
    case "callback-requested":
      return "bg-blue-500/15 text-blue-600 border-blue-500/30";
    case "no-answer":
    case "hung-up":
      return "bg-amber-500/15 text-amber-600 border-amber-500/30";
    case "no-interest":
      return "bg-muted text-muted-foreground border-border";
    case "do-not-call":
    case "does-not-exist":
      return "bg-red-500/15 text-red-600 border-red-500/30";
    default:
      return "bg-muted text-muted-foreground border-border";
  }
}
function outcomeLabel(outcome: string | null): string {
  if (!outcome) return "";
  return OUTCOME_LABEL[outcome] || outcome;
}

interface CallListDef {
  id: string; name: string; daily_quota: number; active: boolean;
  assigned_agent_id: string | null;
  filter_criteria?: { source_lists?: string[] } | null;
  closing_only?: boolean;
}

// Shape returned by GET /call-lists/new-preview — used by both the Create
// and Top Up dialogs to forecast how a quota/count will fill.
type ListPreview = {
  conversions_due: number;
  callbacks_due: number;
  interested_followups: number;
  retry_eligible: number;
  pool_available: number;
  closer_role: "agent" | "closer" | "admin";
  closing_only: boolean;
};

interface Agent {
  id: string; name: string; email: string | null; active: boolean;
}

export default function CallCommand() {
  const [poolAvailable, setPoolAvailable] = useState(0);
  const [callList, setCallList] = useState<CallContact[]>([]);
  const [todayOutcomes, setTodayOutcomes] = useState<{ total: number; uniqueContacts: number; outcomes: Record<string, number> }>({ total: 0, uniqueContacts: 0, outcomes: {} });
  const [callListDefs, setCallListDefs] = useState<CallListDef[]>([]);
  const [activeCallListDef, setActiveCallListDef] = useState<CallListDef | null>(null);
  const [loading, setLoading] = useState(true);
  const [currentCallIndex, setCurrentCallIndex] = useState(0); // queue position — only advances on call end
  const [viewingIndex, setViewingIndex] = useState<number | null>(null); // temporary preview — null = show currentCallIndex
  const [staleCount, setStaleCount] = useState(0);
  const [clearing, setClearing] = useState(false);
  const [aircallConfigured, setAircallConfigured] = useState(false);
  const [dialing, setDialing] = useState(false);

  // Outcome tray state — persistent list of completed calls awaiting action.
  // Each entry goes through: awaiting_tag → ready (analysis complete) → viewed.
  // Operator can queue up multiple calls while earlier ones are still processing.
  type PendingStatus = "awaiting_tag" | "ready" | "viewed";
  interface PendingOutcome {
    contactId: string;
    contactName: string;
    status: PendingStatus;
    startedAt: number;
  }
  const [pendingOutcomes, setPendingOutcomes] = useState<PendingOutcome[]>([]);
  const [trayExpanded, setTrayExpanded] = useState(false);
  // contactId currently shown in the detail drawer (null = no drawer open)
  const [detailContactId, setDetailContactId] = useState<string | null>(null);

  const updatePending = useCallback((contactId: string, patch: Partial<PendingOutcome>) => {
    setPendingOutcomes(prev => prev.map(p => p.contactId === contactId ? { ...p, ...patch } : p));
  }, []);

  const upsertPending = useCallback((outcome: PendingOutcome) => {
    setPendingOutcomes(prev => {
      const idx = prev.findIndex(p => p.contactId === outcome.contactId);
      // If contact already has an entry, refresh it (new call for same contact)
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = outcome;
        return next;
      }
      // Most-recent-first
      return [outcome, ...prev];
    });
  }, []);

  const dismissPending = useCallback((contactId: string) => {
    setPendingOutcomes(prev => prev.filter(p => p.contactId !== contactId));
  }, []);

  // Ref used by the persist-tray effects below — declared here so it's
  // stable across renders. The effects themselves are placed after
  // `activeAgentId` is defined (avoids a TDZ reference).
  const trayHydratedRef = useRef(false);

  // Derived counts used by the tray header
  const readyCount = pendingOutcomes.filter(p => p.status === "ready").length;
  const awaitingCount = pendingOutcomes.filter(p => p.status === "awaiting_tag").length;
  const trayBadgeCount = pendingOutcomes.filter(p => p.status !== "viewed").length;

  // Ref to capture the contact at dial-time so we still know who was called
  // when the async call.ended event fires later.
  const callingContactRef = useRef<{ id: string; name: string } | null>(null);

  const handleCallEnded = useCallback(() => {
    setDialing(false);
    setViewingIndex(null);
    setCurrentCallIndex(i => i + 1);
    if (callingContactRef.current) {
      upsertPending({
        contactId: callingContactRef.current.id,
        contactName: callingContactRef.current.name,
        status: "awaiting_tag",
        startedAt: Date.now(),
      });
      // Auto-open the tray (collapsed state) so operator sees new items land.
      // We never auto-open the detail drawer — that's still click-to-open.
      setTrayExpanded(true);
    }
    loadAll();
  }, [upsertPending]);

  // Subscribe to the live queue-events stream. Flips any matching pending
  // outcome to "ready" when the engine has finished analysing it.
  useEffect(() => {
    const url = `${API_BASE}/events/queue`;
    const es = new EventSource(url);
    const onChange = () => { loadAll(); };
    const onTagged = (ev: MessageEvent) => {
      loadAll();
      try {
        const payload = JSON.parse(ev.data);
        if (!payload?.contactId) return;
        setPendingOutcomes(prev => {
          const existing = prev.find(p => p.contactId === payload.contactId);
          if (existing) {
            // Normal dial flow — flip awaiting_tag → ready
            return prev.map(p =>
              p.contactId === payload.contactId && p.status === "awaiting_tag"
                ? { ...p, status: "ready" as const }
                : p
            );
          }
          // Out-of-band tagging (Power Dialer session, Simulator, back-office
          // re-tag) — insert a new ready entry so the operator can still open
          // the drawer for it. contactName comes from the SSE payload; falls
          // back to a placeholder if absent.
          return [
            ...prev,
            {
              contactId: payload.contactId,
              contactName: payload.contactName || "Contact",
              status: "ready" as const,
              startedAt: Date.now(),
            },
          ];
        });
        // Auto-open the tray (collapsed pill) so operator notices the new
        // out-of-band entry. Same UX as when handleCallEnded fires.
        setTrayExpanded(true);
      } catch { /* ignore */ }
    };
    es.addEventListener("call.ended", onChange);
    es.addEventListener("call.tagged", onTagged);
    es.addEventListener("untagged-sweep", onChange);
    es.onerror = () => { /* EventSource auto-reconnects */ };
    return () => { es.close(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Polling fallback for each awaiting_tag outcome. SSE can be buffered by
  // proxies; this ensures we pick up the ready state within 5s even if no
  // event arrives. Polls all awaiting items in a single pass.
  useEffect(() => {
    const awaiting = pendingOutcomes.filter(p => p.status === "awaiting_tag");
    if (awaiting.length === 0) return;
    let cancelled = false;
    const check = async () => {
      if (cancelled) return;
      await Promise.all(awaiting.map(async (p) => {
        if (Date.now() - p.startedAt > 10 * 60 * 1000) return; // give up after 10 min
        try {
          const res = await apiFetch(`${API_BASE}/engine/contact/${p.contactId}`);
          if (!res.ok) return;
          const data = await res.json();
          const newest = data?.runs?.[0];
          if (newest?.created_at && new Date(newest.created_at).getTime() > p.startedAt) {
            updatePending(p.contactId, { status: "ready" });
          }
        } catch { /* ignore */ }
      }));
    };
    check();
    const interval = setInterval(check, 5000);
    return () => { cancelled = true; clearInterval(interval); };
    // Re-run when the set of awaiting items changes
  }, [pendingOutcomes.map(p => `${p.contactId}:${p.status}`).join(","), updatePending]);

  const { isLoggedIn, callStatus, error: aircallError, aircallUser, dial } = useAircallPhone({
    containerId: "aircall-phone-container",
    enabled: aircallConfigured,
    onCallEnded: handleCallEnded,
  });

  // Aircall-vs-app identity mismatch detection. The app can't control the
  // Aircall widget's login (it's browser-session-scoped to phone.aircall.io),
  // so if the human signs in as someone different, outcomes get attributed
  // wrong. Surface it loudly rather than silently misfiring.
  const aircallMismatch =
    isLoggedIn &&
    aircallUser?.id != null &&
    currentUser?.agent?.aircall_user_id != null &&
    aircallUser.id !== currentUser.agent.aircall_user_id;

  // Auto-reset dialing if Aircall never transitions to on_call/ringing
  const dialTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (dialing && callStatus === "idle") {
      dialTimeoutRef.current = setTimeout(() => setDialing(false), 15000);
    } else if (callStatus !== "idle") {
      // Call connected — clear the timeout
      if (dialTimeoutRef.current) clearTimeout(dialTimeoutRef.current);
      dialTimeoutRef.current = null;
    }
    return () => { if (dialTimeoutRef.current) clearTimeout(dialTimeoutRef.current); };
  }, [dialing, callStatus]);

  const handleDial = (phone: string, contact?: CallContact | null) => {
    dial(phone);
    setDialing(true);
    if (contact) {
      callingContactRef.current = {
        id: contact.id,
        name: `${contact.first_name} ${contact.last_name}`.trim(),
      };
    }
  };

  // Power Dialer — push the current call list to the agent's Aircall PD queue.
  // Only relevant when currentUser.agent.dialer_mode === "power_dialer".
  const [pdPushing, setPdPushing] = useState(false);
  const [pdLastResult, setPdLastResult] = useState<null | {
    pushed: number;
    cleared: number;
    phonesValid: number;
    at: Date;
    errorMessage?: string;
    // When Aircall's REST rejects a batch the server responds 200 with
    // pushed=0 and errors.push populated — we surface that here so the
    // operator actually sees what Aircall said.
    aircallErrors?: Array<{ status: number; body: string }>;
  }>(null);

  const handlePushToPowerDialer = async () => {
    if (!activeCallListDef) return;
    setPdPushing(true);
    setPdLastResult(null);
    try {
      const res = await apiPost(
        `${API_BASE}/call-lists/${activeCallListDef.id}/send-to-power-dialer`,
        {},
        { redirectOn401: false },
      );
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setPdLastResult({
          pushed: 0,
          cleared: 0,
          phonesValid: 0,
          at: new Date(),
          errorMessage: body.message || body.error || `HTTP ${res.status}`,
        });
        return;
      }
      const pushErrors: Array<{ status: number; body: string }> =
        Array.isArray(body?.errors?.push)
          ? body.errors.push.map((e: any) => ({ status: e.status, body: e.body }))
          : [];
      setPdLastResult({
        pushed: body.pushed || 0,
        cleared: body.cleared || 0,
        phonesValid: body.phones_valid || 0,
        at: new Date(),
        aircallErrors: pushErrors.length > 0 ? pushErrors : undefined,
      });
    } catch (err: any) {
      setPdLastResult({
        pushed: 0,
        cleared: 0,
        phonesValid: 0,
        at: new Date(),
        errorMessage: err?.message || "Request failed",
      });
    } finally {
      setPdPushing(false);
    }
  };
  // Agent identity comes from the authenticated session — no more picker,
  // no more localStorage. The logged-in user IS the active agent.
  const { data: currentUser } = useCurrentUser();
  const activeAgentId = currentUser?.agent.id || "";
  const agentName = currentUser?.agent.name?.split(" ")[0] || "there";

  // Persist the outcomes tray across page refresh. Keyed per agent so a
  // shared machine doesn't leak one user's tray into another's. Phase 4.7
  // narrows retention to TODAY only — older outcomes live on the
  // dedicated Outcomes page (Phase 4.8) where they can be managed without
  // cluttering the pill. engine_runs remains the system of record.
  useEffect(() => {
    trayHydratedRef.current = false;
    if (!activeAgentId) return;
    try {
      const raw = localStorage.getItem(`pendingOutcomes:${activeAgentId}`);
      if (raw) {
        const loaded = JSON.parse(raw);
        // Today-only cutoff — operator's local midnight
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);
        const cutoff = todayStart.getTime();
        setPendingOutcomes(Array.isArray(loaded)
          ? loaded.filter((p: any) => p && typeof p.startedAt === "number" && p.startedAt >= cutoff)
          : []);
      } else {
        setPendingOutcomes([]);
      }
    } catch {
      setPendingOutcomes([]);
    }
    trayHydratedRef.current = true;
  }, [activeAgentId]);
  useEffect(() => {
    if (!activeAgentId || !trayHydratedRef.current) return;
    try {
      localStorage.setItem(`pendingOutcomes:${activeAgentId}`, JSON.stringify(pendingOutcomes));
    } catch { /* quota / disabled — non-fatal */ }
  }, [pendingOutcomes, activeAgentId]);

  // The full agents list is still used by the "Create Call List" dialog so
  // a list can be assigned to any agent (admin-style setup).
  const [agents, setAgents] = useState<Agent[]>([]);

  // Create call list dialog
  const [createOpen, setCreateOpen] = useState(false);

  // Top Up dialog — adds N more contacts to the CURRENT active call list.
  // Separate from Create Call List (which makes a new list).
  const [topUpOpen, setTopUpOpen] = useState(false);
  const [topUpCount, setTopUpCount] = useState<string>("10");
  const [topUpSubmitting, setTopUpSubmitting] = useState(false);
  const [topUpError, setTopUpError] = useState<string | null>(null);

  const handleTopUp = async () => {
    if (!activeCallListDef) return;
    const count = Math.max(1, Math.min(500, parseInt(topUpCount) || 0));
    if (count <= 0) { setTopUpError("Enter a number of contacts to add (1 or more)"); return; }
    setTopUpSubmitting(true);
    setTopUpError(null);
    try {
      const res = await apiPost(
        `${API_BASE}/call-lists/${activeCallListDef.id}/fill-queue`,
        { count },
        { redirectOn401: false },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setTopUpError(body.message || body.error || `Request failed (${res.status})`);
        return;
      }
      setTopUpOpen(false);
      await loadAll();
    } catch (err: any) {
      setTopUpError(err?.message || "Top up failed");
    } finally {
      setTopUpSubmitting(false);
    }
  };
  const defaultListName = () => {
    const d = new Date();
    return `${agentName} - ${d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}`;
  };
  const [newName, setNewName] = useState("");
  const [newQuota, setNewQuota] = useState("100");
  const [newAgent, setNewAgent] = useState("");
  const [newSourceLists, setNewSourceLists] = useState<string[]>([]);
  const [newClosingOnly, setNewClosingOnly] = useState(false);
  const [sourcesPopoverOpen, setSourcesPopoverOpen] = useState(false);

  // Live preview of what the new list will contain (fetched when fields change)
  const [newPreview, setNewPreview] = useState<ListPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  // Live preview for the Top Up dialog — same shape, fetched against the
  // currently active list's config (read-only on top-up).
  const [topUpPreview, setTopUpPreview] = useState<ListPreview | null>(null);
  const [topUpPreviewLoading, setTopUpPreviewLoading] = useState(false);

  // Fetch live preview whenever the Create dialog is open + fields change.
  // Debounced so we don't hammer the endpoint while typing.
  useEffect(() => {
    if (!createOpen || !newAgent) {
      setNewPreview(null);
      return;
    }
    const t = setTimeout(async () => {
      setPreviewLoading(true);
      try {
        const params = new URLSearchParams();
        params.set("agent_id", newAgent);
        if (newClosingOnly) params.set("closing_only", "true");
        for (const s of newSourceLists) params.append("source_lists", s);
        const res = await apiFetch(`${API_BASE}/call-lists/new-preview?${params.toString()}`);
        if (res.ok) setNewPreview(await res.json());
      } catch { /* ignore */ } finally {
        setPreviewLoading(false);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [createOpen, newAgent, newClosingOnly, newSourceLists]);

  // Top Up preview — fetch when the dialog opens using the active list's own
  // config (agent, source lists, closing_only). Read-only: the user can't
  // change these from the Top Up dialog, so no debounce needed beyond open.
  useEffect(() => {
    if (!topUpOpen || !activeCallListDef?.assigned_agent_id) {
      setTopUpPreview(null);
      return;
    }
    (async () => {
      setTopUpPreviewLoading(true);
      try {
        const params = new URLSearchParams();
        params.set("agent_id", activeCallListDef.assigned_agent_id!);
        if (activeCallListDef.closing_only) params.set("closing_only", "true");
        const srcs = activeCallListDef.filter_criteria?.source_lists;
        if (Array.isArray(srcs)) for (const s of srcs) params.append("source_lists", s);
        const res = await apiFetch(`${API_BASE}/call-lists/new-preview?${params.toString()}`);
        if (res.ok) setTopUpPreview(await res.json());
      } catch { /* ignore */ } finally {
        setTopUpPreviewLoading(false);
      }
    })();
  }, [topUpOpen, activeCallListDef?.id]);

  const [creating, setCreating] = useState(false);
  const [carryOver, setCarryOver] = useState(false);
  const [sources, setSources] = useState<string[]>([]);
  const today = new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "morning" : hour < 17 ? "afternoon" : "evening";

  // Initial load runs once the session is known (so requests carry the
  // auth cookie and the server can scope to this agent).
  useEffect(() => {
    if (!activeAgentId) return;
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeAgentId]);

  // When callListDefs change, resolve this agent's active list and reload
  // its contacts. (Runs after loadAll populates callListDefs.)
  useEffect(() => {
    if (!activeAgentId) return;
    const next = callListDefs.find(c => c.active && c.assigned_agent_id === activeAgentId) || null;
    if (next?.id === activeCallListDef?.id) return; // no change
    setActiveCallListDef(next);
    setCurrentCallIndex(0);
    setViewingIndex(null);
    (async () => {
      if (next) {
        try {
          const listRes = await apiFetch(`${API_BASE}/call-lists/${next.id}/call-list`);
          const listData = await listRes.json();
          setCallList(listData.contacts || []);
        } catch { /* ignore */ }
      } else {
        setCallList([]);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeAgentId, callListDefs]);

  const loadAll = async () => {
    setLoading(true);
    try {
      // Server derives agent scope from the session cookie. Frontend no
      // longer sends agent_id — requireAuth attaches req.auth on the server.
      const [callListDefsRes, poolRes, agentsRes, sourcesRes, staleRes, outcomesRes, aircallRes] = await Promise.all([
        apiFetch(`${API_BASE}/call-lists`),
        apiFetch(`${API_BASE}/contacts/stats`),
        apiFetch(`${API_BASE}/settings/agents`),
        apiFetch(`${API_BASE}/contacts/sources`),
        apiFetch(`${API_BASE}/call-lists/stale-count`),
        apiFetch(`${API_BASE}/call-lists/today-outcomes`),
        apiFetch(`${API_BASE}/settings/integrations/aircall`),
      ]);

      const callListDefsData = await callListDefsRes.json();
      const poolData = await poolRes.json();
      const agentsData = await agentsRes.json();
      const sourcesData = await sourcesRes.json();
      const staleData = await staleRes.json();
      const outcomesData = await outcomesRes.json();
      const aircallData = await aircallRes.json();
      setAircallConfigured(!!aircallData.integration?.exists && !!aircallData.integration?.enabled);
      setStaleCount(staleData.stale_count || 0);
      setTodayOutcomes(outcomesData);

      const allCallListDefs = callListDefsData.call_lists || [];
      setCallListDefs(allCallListDefs);

      const agentsList = (agentsData.agents || []).filter((a: Agent) => a.active);
      setAgents(agentsList);

      const active = activeAgentId
        ? allCallListDefs.find((c: CallListDef) => c.active && c.assigned_agent_id === activeAgentId)
        : null;
      setActiveCallListDef(active || null);

      setSources(sourcesData.sources || []);
      setPoolAvailable(poolData.by_status?.pool || 0);

      if (!active) {
        setCallList([]);
        setCurrentCallIndex(0);
      }

      if (active) {
        const listRes = await apiFetch(`${API_BASE}/call-lists/${active.id}/call-list`);
        const listData = await listRes.json();
        const newList: CallContact[] = listData.contacts || [];
        // Re-align cursor by contact ID so the display doesn't jump when the
        // server-side ordering shifts (e.g. an immediate_recall pushes the
        // just-called contact to the bottom of the queue).
        setCallList(prevList => {
          // Identify the contact we were "on" before the refresh
          const prevCurrentId = prevList[currentCallIndexRef.current]?.id;
          if (prevCurrentId) {
            const newIdx = newList.findIndex(c => c.id === prevCurrentId);
            if (newIdx >= 0 && newIdx !== currentCallIndexRef.current) {
              setCurrentCallIndex(newIdx);
            }
          }
          return newList;
        });
      }
    } catch {} finally { setLoading(false); }
  };

  // Keep a ref of the current cursor so loadAll (a closure created at render
  // time) can read the latest value without being re-created on every change.
  const currentCallIndexRef = useRef(0);
  useEffect(() => { currentCallIndexRef.current = currentCallIndex; }, [currentCallIndex]);

  const handleClearStale = async () => {
    setClearing(true);
    try {
      // Agent scope derived from session on the server — no body needed.
      await apiPost(`${API_BASE}/call-lists/reconcile`, {});
      await loadAll();
    } catch {} finally { setClearing(false); }
  };

  const handleCreateCallList = async () => {
    if (!newName.trim()) return;
    setCreating(true);
    try {
      // Create the list first so we can reassign stale contacts to it by name
      const res = await apiPost(`${API_BASE}/call-lists`, {
        name: newName.trim(),
        daily_quota: parseInt(newQuota) || 100,
        assigned_agent_id: newAgent || null,
        closing_only: newClosingOnly,
        filter_criteria: { source_lists: newSourceLists.length > 0 ? newSourceLists : undefined, exclude_outcomes: ["no-interest"] },
      });
      const data = await res.json();
      const newCallList = data.campaign;

      // If carrying over, move stale memberships onto the new list
      let carriedOver = 0;
      if (carryOver && staleCount > 0 && newCallList?.id) {
        const carryRes = await apiPost(`${API_BASE}/call-lists/carry-over`, {
          target_call_list_id: newCallList.id,
        });
        const carryData = await carryRes.json();
        carriedOver = carryData.carried_over || 0;
      }

      // Fill remaining quota with fresh contacts
      if (newCallList?.id) {
        const quota = parseInt(newQuota) || 100;
        const freshNeeded = Math.max(0, quota - carriedOver);
        if (freshNeeded > 0) {
          await apiPost(`${API_BASE}/call-lists/${newCallList.id}/fill-queue`, {
            count: freshNeeded,
          });
        }
      }

      setCreateOpen(false); setNewName(""); setNewQuota("100"); setNewAgent(""); setNewSourceLists([]); setNewClosingOnly(false);
      setCarryOver(false);
      setCurrentCallIndex(0);
      setViewingIndex(null);
      await loadAll();
    } catch {} finally { setCreating(false); }
  };

  const queuedCalls = callList.length;
  const activeIndex = viewingIndex ?? currentCallIndex;
  const currentContact = callList[activeIndex] || null;
  const callsCompleted = currentCallIndex;
  // Up Next paging — 10 per page
  const UP_NEXT_PAGE_SIZE = 10;
  const totalUpNext = Math.max(0, callList.length - currentCallIndex - 1);
  const upNextPageCount = Math.max(1, Math.ceil(totalUpNext / UP_NEXT_PAGE_SIZE));
  const [upNextPage, setUpNextPage] = useState(0);
  // Clamp page if queue shrinks below current page's offset
  useEffect(() => {
    if (upNextPage >= upNextPageCount) setUpNextPage(Math.max(0, upNextPageCount - 1));
  }, [upNextPage, upNextPageCount]);
  // Reset to page 0 whenever the current cursor moves forward (new call context)
  const lastCursorRef = useRef(currentCallIndex);
  useEffect(() => {
    if (currentCallIndex > lastCursorRef.current) setUpNextPage(0);
    lastCursorRef.current = currentCallIndex;
  }, [currentCallIndex]);

  const upNextStart = currentCallIndex + 1 + upNextPage * UP_NEXT_PAGE_SIZE;
  const upNextEnd = upNextStart + UP_NEXT_PAGE_SIZE;
  const upNext = callList.slice(upNextStart, upNextEnd);

  // Queue composition derived from actual call list
  const queueConversions = callList.filter(c => c.priority === "conversion").length;
  const queueCallbacks = callList.filter(c => c.priority === "callback").length;
  const queueFollowUps = callList.filter(c => c.priority === "follow-up").length;
  const queueRetries = callList.filter(c => c.priority === "retry").length;
  const queueFresh = callList.filter(c => c.priority === "fresh").length;

  /**
   * Shared eligibility forecast renderer — used by both Create Call List
   * and Top Up dialogs. Walks the server's fillQueue priority order
   * (Conversions → Callbacks → Interested → Retries → Fresh) and caps each
   * tier by remaining slots, so the tiles show what will actually dispatch
   * given the quota/count the user picked.
   *
   * See artifacts/api-server/src/lib/dispatchService.ts for the source of
   * truth on priority order.
   */
  function renderForecast(preview: ListPreview, quota: number) {
    const isCloser = preview.closer_role === "closer" || preview.closer_role === "admin";
    const tiers: Array<{ key: string; label: string; eligible: number; color: string }> = [];
    if (isCloser) {
      tiers.push({ key: "conversions", label: "Conversions", eligible: preview.conversions_due, color: "text-purple-600" });
    }
    if (!preview.closing_only) {
      tiers.push({ key: "callbacks",  label: "Callbacks",  eligible: preview.callbacks_due,         color: "text-orange-600" });
      tiers.push({ key: "interested", label: "Interested", eligible: preview.interested_followups, color: "text-blue-600" });
      tiers.push({ key: "retries",    label: "Retries",    eligible: preview.retry_eligible,       color: "text-slate-600" });
      tiers.push({ key: "fresh",      label: "Fresh",      eligible: preview.pool_available,       color: "text-green-600" });
    }
    let remaining = quota;
    const rows = tiers.map(t => {
      const dispatched = Math.min(t.eligible, Math.max(0, remaining));
      remaining -= dispatched;
      return { ...t, dispatched };
    });
    const totalDispatched = quota - Math.max(0, remaining);
    const shortfall = Math.max(0, quota - totalDispatched);
    const cols = rows.length || 1;
    return (
      <>
        <div
          className="grid gap-2 text-center"
          style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
        >
          {rows.map(r => (
            <div key={r.key}>
              <p className="text-lg font-bold leading-tight">
                <span className={r.dispatched > 0 ? r.color : "text-muted-foreground/40"}>
                  {r.dispatched}
                </span>
                <span className="text-muted-foreground/60 font-normal text-xs">
                  {" / "}{r.eligible}
                </span>
              </p>
              <p className="text-[10px] text-muted-foreground mt-0.5">{r.label}</p>
            </div>
          ))}
        </div>
        <p className="text-[11px] text-center mt-2.5">
          <span className={shortfall > 0 ? "text-amber-600 font-medium" : "text-muted-foreground"}>
            {totalDispatched} of {quota} quota
          </span>
          <span className="text-muted-foreground">
            {shortfall > 0
              ? ` — ${shortfall} short of quota`
              : " will be dispatched in priority order"}
          </span>
        </p>
      </>
    );
  }

  return (
    <div className="space-y-5 max-w-7xl mx-auto">
      {/* POST-CALL OUTCOME DETAIL DRAWER (opens for a specific contact)
          Hidden unless VITE_ENABLE_OUTCOME_DRAWER=true — engine features still
          under development, not yet shown to operators. */}
      {SHOW_OUTCOME_DRAWER && (
        <OutcomeDrawer
          open={detailContactId !== null}
          contactId={detailContactId}
          contactName={pendingOutcomes.find(p => p.contactId === detailContactId)?.contactName ?? null}
          conversationId={null}
          onClose={() => {
            // Mark this outcome as viewed but keep it in the tray until dismissed
            if (detailContactId) updatePending(detailContactId, { status: "viewed" });
            setDetailContactId(null);
          }}
          onSkip={() => {
            if (detailContactId) updatePending(detailContactId, { status: "viewed" });
            setDetailContactId(null);
          }}
        />
      )}

      {/* OUTCOMES TRAY — always-visible thin tab on right edge; expands to full list.
          Same feature flag as the drawer. */}
      {SHOW_OUTCOME_DRAWER && (
      <div className="fixed top-1/4 right-0 z-40 flex items-start">
        {/* Collapsed tab — always visible, branded green */}
        {!trayExpanded && (
          <button
            onClick={() => setTrayExpanded(true)}
            className="group relative bg-primary text-primary-foreground border border-r-0 border-primary shadow-lg rounded-l-lg px-2 py-3 flex flex-col items-center gap-2 hover:bg-primary/90 transition-colors"
            title={`${pendingOutcomes.length} outcome${pendingOutcomes.length !== 1 ? "s" : ""} in tray`}
          >
            <Headphones className="w-4 h-4" />
            <span className="text-[10px] uppercase tracking-wide [writing-mode:vertical-rl] rotate-180 font-semibold">
              Outcomes
            </span>
            {trayBadgeCount > 0 && (
              <span className={`absolute -top-1 -left-1 min-w-[20px] h-5 px-1 rounded-full text-[10px] font-bold flex items-center justify-center ring-2 ring-background ${
                readyCount > 0 ? "bg-background text-primary animate-pulse" : "bg-background text-primary"
              }`}>
                {trayBadgeCount}
              </span>
            )}
          </button>
        )}

        {/* Expanded tray — side panel listing all pending outcomes */}
        {trayExpanded && (
          <div className="w-80 bg-card border border-r-0 border-border shadow-xl rounded-l-lg overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b">
              <div>
                <div className="font-semibold text-sm flex items-center gap-2">
                  <Headphones className="w-4 h-4" /> Call Outcomes
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  {readyCount} ready · {awaitingCount} processing
                </div>
              </div>
              <button
                onClick={() => setTrayExpanded(false)}
                className="text-xs text-muted-foreground hover:text-foreground px-2 py-1 rounded hover:bg-muted"
                title="Minimise"
              >
                ›
              </button>
            </div>
            {pendingOutcomes.length === 0 ? (
              <div className="px-4 py-6 text-center text-xs text-muted-foreground">
                No outcomes yet. After a call ends, the engine output will appear here.
              </div>
            ) : (
              <div className="max-h-[calc(100vh-220px)] overflow-y-auto">
                {pendingOutcomes.map(p => {
                  const mins = Math.round((Date.now() - p.startedAt) / 60000);
                  const stale = p.status === "awaiting_tag" && mins >= 10;
                  return (
                    <div key={p.contactId}
                      className={`group px-4 py-3 border-b last:border-b-0 cursor-pointer transition-colors ${
                        p.status === "ready" ? "hover:bg-primary/5" : "hover:bg-muted/50"
                      }`}
                      onClick={() => setDetailContactId(p.contactId)}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="font-medium text-sm truncate">{p.contactName}</div>
                          <div className="text-xs mt-0.5 flex items-center gap-1.5">
                            {p.status === "awaiting_tag" && (
                              <>
                                <Loader2 className="w-3 h-3 animate-spin text-muted-foreground" />
                                <span className={stale ? "text-amber-600" : "text-muted-foreground"}>
                                  {stale ? `Still awaiting tag (${mins}m)` : "Awaiting tag…"}
                                </span>
                              </>
                            )}
                            {p.status === "ready" && (
                              <>
                                <span className="relative flex h-2 w-2">
                                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75" />
                                  <span className="relative inline-flex rounded-full h-2 w-2 bg-primary" />
                                </span>
                                <span className="text-primary font-medium">Analysis ready</span>
                              </>
                            )}
                            {p.status === "viewed" && (
                              <>
                                <CheckCircle className="w-3 h-3 text-muted-foreground" />
                                <span className="text-muted-foreground">Viewed</span>
                              </>
                            )}
                          </div>
                        </div>
                        <button
                          onClick={(e) => { e.stopPropagation(); dismissPending(p.contactId); }}
                          className="text-muted-foreground/60 hover:text-destructive hover:bg-destructive/10 p-1 rounded text-base leading-none shrink-0"
                          title="Dismiss this outcome"
                          aria-label="Dismiss this outcome"
                        >
                          ×
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            {pendingOutcomes.length > 0 && (
              <div className="px-4 py-2 border-t">
                <button
                  onClick={() => setPendingOutcomes([])}
                  className="w-full text-xs text-muted-foreground hover:text-foreground py-1"
                >
                  Clear all
                </button>
              </div>
            )}
          </div>
        )}
      </div>
      )}

      {/* HEADER */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight">Good {greeting}, {agentName}</h1>
            {currentUser?.agent.dialer_mode === "power_dialer" ? (
              <Badge variant="outline" className="bg-blue-500/10 text-blue-700 border-blue-500/30 gap-1">
                <Zap className="w-3 h-3" /> Power Dialer
              </Badge>
            ) : (
              <Badge variant="outline" className="gap-1">
                <Phone className="w-3 h-3" /> Manual
              </Badge>
            )}
          </div>
          <p className="text-sm text-muted-foreground">{today}</p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/contacts/upload">
            <Button variant="outline" size="sm" className="gap-1.5"><Upload className="w-3.5 h-3.5" /> Upload Contacts</Button>
          </Link>
          {isAdmin(currentUser) && (
            <Link href="/settings">
              <Button variant="ghost" size="sm">Settings</Button>
            </Link>
          )}
        </div>
      </div>

      {/* AIRCALL IDENTITY MISMATCH — warn if the Aircall widget is logged in
          as a different human than the app session. The webhook will
          attribute calls to whoever actually made them on Aircall's side,
          which may not be the operator the app thinks is dialling. */}
      {aircallMismatch && (
        <Card className="border-amber-500/60 bg-amber-500/5">
          <CardContent className="py-3 px-4 flex items-start gap-3">
            <MailWarning className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-amber-700 dark:text-amber-400">
                Aircall is signed in as a different user
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                You're signed into this app as <strong>{currentUser?.agent.name}</strong>
                {currentUser?.agent.aircall_user_id != null
                  ? ` (Aircall user id ${currentUser.agent.aircall_user_id})`
                  : ""}
                , but the Aircall widget below is signed in as{" "}
                <strong>{aircallUser?.email || aircallUser?.name || `user id ${aircallUser?.id}`}</strong>.
                Calls you make will be attributed to the Aircall user, not the app user.
                Log out of Aircall inside the widget and sign in again as yourself.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* STALE QUEUE PROMPT */}
      {staleCount > 0 && (
        <Card className="border-orange-500/50">
          <CardContent className="py-3 px-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Clock className="w-5 h-5 text-orange-500 shrink-0" />
              <div>
                <p className="text-sm font-medium">{staleCount} contact{staleCount !== 1 ? "s" : ""} from a previous session</p>
                <p className="text-xs text-muted-foreground">Include them in today's list or clear them back to the pool.</p>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Button variant="outline" size="sm" className="gap-1.5" onClick={handleClearStale} disabled={clearing}>
                {clearing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                Start Fresh
              </Button>
              <Button size="sm" className="gap-1.5" onClick={() => { setCarryOver(true); setNewName(defaultListName()); setNewAgent(activeAgentId); setCreateOpen(true); }} disabled={clearing}>
                Keep &amp; Continue
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* QUEUE COMPOSITION */}
      {queuedCalls > 0 && (
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Queue</p>
          <div className={`grid gap-3 ${
            (currentUser?.user?.role === "closer" || currentUser?.user?.role === "admin" || queueConversions > 0)
              ? "grid-cols-5" : "grid-cols-4"
          }`}>
            {(currentUser?.user?.role === "closer" || currentUser?.user?.role === "admin" || queueConversions > 0) && (
              <Card className={queueConversions > 0 ? "border-purple-500/50" : ""}>
                <CardContent className="pt-4 pb-3 px-4">
                  <div className="flex items-center gap-3">
                    <Zap className="w-5 h-5 text-purple-600 shrink-0" />
                    <div><p className="text-2xl font-bold leading-none">{queueConversions}</p><p className="text-xs text-muted-foreground mt-0.5">Conversions</p></div>
                  </div>
                </CardContent>
              </Card>
            )}
            <Card className={queueCallbacks > 0 ? "border-orange-500/50" : ""}>
              <CardContent className="pt-4 pb-3 px-4">
                <div className="flex items-center gap-3">
                  <CalendarClock className="w-5 h-5 text-orange-500 shrink-0" />
                  <div><p className="text-2xl font-bold leading-none">{queueCallbacks}</p><p className="text-xs text-muted-foreground mt-0.5">Callbacks</p></div>
                </div>
              </CardContent>
            </Card>
            <Card className={queueFollowUps > 0 ? "border-blue-500/50" : ""}>
              <CardContent className="pt-4 pb-3 px-4">
                <div className="flex items-center gap-3">
                  <TrendingUp className="w-5 h-5 text-blue-500 shrink-0" />
                  <div><p className="text-2xl font-bold leading-none">{queueFollowUps}</p><p className="text-xs text-muted-foreground mt-0.5">Follow-ups</p></div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4 pb-3 px-4">
                <div className="flex items-center gap-3">
                  <PhoneMissed className="w-5 h-5 text-slate-400 shrink-0" />
                  <div><p className="text-2xl font-bold leading-none">{queueRetries}</p><p className="text-xs text-muted-foreground mt-0.5">Retries</p></div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4 pb-3 px-4">
                <div className="flex items-center gap-3">
                  <UserPlus className="w-5 h-5 text-green-500 shrink-0" />
                  <div><p className="text-2xl font-bold leading-none">{queueFresh}</p><p className="text-xs text-muted-foreground mt-0.5">Fresh</p></div>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      {/* TODAY'S OUTCOMES */}
      {todayOutcomes.total > 0 && (
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Today's Results</p>
          <div className="grid grid-cols-6 gap-3">
            <Card title={`${todayOutcomes.total} total calls to ${todayOutcomes.uniqueContacts} unique contact${todayOutcomes.uniqueContacts !== 1 ? "s" : ""}`}>
              <CardContent className="pt-4 pb-3 px-4">
                <div className="flex items-center gap-3">
                  <Phone className="w-5 h-5 text-primary shrink-0" />
                  <div className="flex items-baseline gap-2">
                    <div>
                      <p className="text-2xl font-bold leading-none">{todayOutcomes.total}</p>
                      <p className="text-[10px] text-muted-foreground mt-0.5 uppercase tracking-wide">Calls</p>
                    </div>
                    <span className="text-muted-foreground/40 text-lg">/</span>
                    <div>
                      <p className="text-2xl font-bold leading-none">{todayOutcomes.uniqueContacts}</p>
                      <p className="text-[10px] text-muted-foreground mt-0.5 uppercase tracking-wide">Unique</p>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card className={(todayOutcomes.outcomes["interested"] || 0) > 0 ? "border-green-500/50" : ""}>
              <CardContent className="pt-4 pb-3 px-4">
                <div className="flex items-center gap-3">
                  <CheckCircle className="w-5 h-5 text-green-500 shrink-0" />
                  <div><p className="text-2xl font-bold leading-none">{todayOutcomes.outcomes["interested"] || 0}</p><p className="text-xs text-muted-foreground mt-0.5">Interested</p></div>
                </div>
              </CardContent>
            </Card>
            <Card className={(todayOutcomes.outcomes["meeting-booked"] || 0) > 0 ? "border-green-500/50" : ""}>
              <CardContent className="pt-4 pb-3 px-4">
                <div className="flex items-center gap-3">
                  <Calendar className="w-5 h-5 text-green-500 shrink-0" />
                  <div><p className="text-2xl font-bold leading-none">{todayOutcomes.outcomes["meeting-booked"] || 0}</p><p className="text-xs text-muted-foreground mt-0.5">Meetings</p></div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4 pb-3 px-4">
                <div className="flex items-center gap-3">
                  <PhoneOff className="w-5 h-5 text-slate-400 shrink-0" />
                  <div><p className="text-2xl font-bold leading-none">{todayOutcomes.outcomes["no-answer"] || 0}</p><p className="text-xs text-muted-foreground mt-0.5">No Answer</p></div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4 pb-3 px-4">
                <div className="flex items-center gap-3">
                  <XCircle className="w-5 h-5 text-red-400 shrink-0" />
                  <div><p className="text-2xl font-bold leading-none">{todayOutcomes.outcomes["no-interest"] || 0}</p><p className="text-xs text-muted-foreground mt-0.5">No Interest</p></div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4 pb-3 px-4">
                <div className="flex items-center gap-3">
                  <CalendarClock className="w-5 h-5 text-orange-500 shrink-0" />
                  <div><p className="text-2xl font-bold leading-none">{todayOutcomes.outcomes["callback-requested"] || 0}</p><p className="text-xs text-muted-foreground mt-0.5">Callback</p></div>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      {/* CREATE LIST / PROGRESS BAR */}
      {staleCount > 0 ? null : queuedCalls === 0 ? (
        <Card className="border-primary/30 bg-primary/[0.02]">
          <CardContent className="py-5">
            {poolAvailable === 0 ? (
              <div className="flex items-center justify-between gap-6">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center shrink-0">
                    <Upload className="w-5 h-5 text-muted-foreground" />
                  </div>
                  <div>
                    <p className="font-semibold">Upload contacts to get started</p>
                    <p className="text-sm text-muted-foreground">Your contact pool is empty. Upload a CSV to begin building call lists.</p>
                  </div>
                </div>
                <Link href="/contacts/upload"><Button className="gap-1.5 shrink-0"><Upload className="w-4 h-4" /> Upload Contacts</Button></Link>
              </div>
            ) : (
              <div className="flex items-center justify-between gap-6">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                    <ListPlus className="w-5 h-5 text-primary" />
                  </div>
                  <div>
                    <p className="font-semibold">Ready to call</p>
                    <p className="text-sm text-muted-foreground">{poolAvailable} contacts available. Create a call list to get started.</p>
                  </div>
                </div>
                <Button className="gap-1.5 shrink-0" onClick={() => { setNewName(defaultListName()); setNewAgent(activeAgentId); setCreateOpen(true); }}>
                  <ListPlus className="w-4 h-4" /> Create Call List
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="py-4">
            <div className="flex items-center justify-between gap-6">
              <div className="flex items-center gap-6 flex-1">
                <div>
                  <p className="text-sm font-medium">{queuedCalls - currentCallIndex} calls remaining</p>
                  <p className="text-xs text-muted-foreground">of {queuedCalls} dispatched</p>
                </div>
                <div className="flex-1 max-w-md">
                  <div className="w-full bg-muted rounded-full h-2">
                    <div className="bg-primary rounded-full h-2 transition-all" style={{ width: `${queuedCalls > 0 ? (currentCallIndex / queuedCalls) * 100 : 0}%` }} />
                  </div>
                </div>
                <div className="flex gap-4 text-center">
                  <div><p className="text-lg font-bold text-green-600">{callsCompleted}</p><p className="text-[10px] text-muted-foreground">Completed</p></div>
                </div>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5 shrink-0"
                onClick={() => {
                  // Default the count to something sensible: remaining quota,
                  // capped at 25 so it's a reasonable batch not a full refill.
                  const remaining = activeCallListDef
                    ? Math.max(1, Math.min(25, (activeCallListDef.daily_quota || 50) - queuedCalls))
                    : 10;
                  setTopUpCount(String(remaining));
                  setTopUpError(null);
                  setTopUpOpen(true);
                }}
                disabled={!activeCallListDef}
                title={activeCallListDef ? "Add more contacts to this list" : "No active list"}
              >
                <ListPlus className="w-3.5 h-3.5" /> Top Up
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* NEXT CALL + AIRCALL */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div>
          <Card className="h-full overflow-hidden">
            {currentContact ? (
              <>
                {/* SECTION 1: Contact Header */}
                <div className="p-5 pb-4">
                  <div className="flex items-start gap-4">
                    <div className="w-14 h-14 rounded-full bg-primary/15 flex items-center justify-center shrink-0 text-primary font-bold text-lg">
                      {currentContact.first_name[0]}{currentContact.last_name[0]}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <h3 className="text-xl font-bold truncate">{currentContact.first_name} {currentContact.last_name}</h3>
                        <Badge
                          variant="outline"
                          className={`text-xs shrink-0 ${
                            currentContact.priority === "conversion"
                              ? "bg-purple-500/10 text-purple-700 border-purple-500/30"
                              : ""
                          }`}
                        >
                          {currentContact.priority === "conversion" ? "Conversion" :
                           currentContact.priority === "callback" ? "Callback" :
                           currentContact.priority === "follow-up" ? "Follow-up" :
                           currentContact.priority === "retry" ? "Retry" :
                           currentContact.priority === "recall" ? "Recall" : "Fresh"}
                        </Badge>
                      </div>
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-1.5 text-sm text-muted-foreground">
                        {currentContact.company && (
                          <span className="flex items-center gap-1"><Building2 className="w-3.5 h-3.5" /> {currentContact.company}</span>
                        )}
                        <span className="flex items-center gap-1 font-mono text-xs">
                          <Phone className="w-3.5 h-3.5" /> {currentContact.phone || "No phone"}
                        </span>
                        {currentContact.email ? (
                          <span className="flex items-center gap-1"><Mail className="w-3.5 h-3.5" /> {currentContact.email}</span>
                        ) : (
                          <span className="flex items-center gap-1 text-yellow-600"><MailWarning className="w-3.5 h-3.5" /> No email</span>
                        )}
                      </div>
                      {currentContact.call_attempts > 0 && (
                        <div className="flex items-center gap-2 mt-2 text-xs text-muted-foreground">
                          <Badge variant="secondary" className="text-xs font-normal">
                            {currentContact.call_attempts} attempt{currentContact.call_attempts !== 1 ? "s" : ""}
                          </Badge>
                          {currentContact.last_call_outcome && (
                            <Badge variant="outline" className={`text-xs font-normal ${outcomeBadgeClasses(currentContact.last_call_outcome)}`}>
                              Last: {outcomeLabel(currentContact.last_call_outcome)}
                            </Badge>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* SECTION 2: Call Action Bar */}
                <div className="px-5 pb-4">
                  {currentUser?.agent.dialer_mode === "power_dialer" ? (
                    /* POWER DIALER MODE — push queue instead of single dial */
                    <div className="space-y-2">
                      <Button
                        className="w-full h-12 bg-blue-600 hover:bg-blue-700 text-white text-base font-semibold shadow-lg shadow-blue-500/20"
                        onClick={handlePushToPowerDialer}
                        disabled={pdPushing || callList.length === 0}
                      >
                        {pdPushing ? <Loader2 className="w-5 h-5 mr-2 animate-spin" /> : <Send className="w-5 h-5 mr-2" />}
                        Send queue to Power Dialer ({callList.length})
                      </Button>
                      <p className="text-[11px] text-muted-foreground text-center">
                        After pushing, click <strong>Start session</strong> in the Aircall widget on this page — no need to leave Call Command.
                      </p>
                      {pdLastResult && (() => {
                        // Three display states:
                        //  1. Transport/server error (errorMessage set) — red
                        //  2. Aircall rejected the batch (pushed=0 & phonesValid>0) — red, surface
                        //     the Aircall response so the operator knows what to fix
                        //     (403 = plan/permissions, 422 = bad phone format, etc.)
                        //  3. Success — green
                        const isTransportErr = !!pdLastResult.errorMessage;
                        const aircallRejected =
                          !isTransportErr &&
                          pdLastResult.pushed === 0 &&
                          pdLastResult.phonesValid > 0;
                        const bad = isTransportErr || aircallRejected;
                        return (
                          <div className={`text-xs rounded border px-3 py-2 ${bad
                            ? "border-destructive/60 bg-destructive/5 text-destructive"
                            : "border-green-500/40 bg-green-500/5 text-green-700 dark:text-green-400"
                          }`}>
                            {isTransportErr ? (
                              <>Push failed: {pdLastResult.errorMessage}</>
                            ) : aircallRejected ? (
                              <div className="space-y-1">
                                <div>
                                  Aircall rejected the push ({pdLastResult.phonesValid} number{pdLastResult.phonesValid !== 1 ? "s" : ""} sent, 0 accepted).
                                </div>
                                {pdLastResult.aircallErrors && pdLastResult.aircallErrors.length > 0 && (
                                  <div className="font-mono text-[10px] opacity-80 break-all">
                                    {pdLastResult.aircallErrors.slice(0, 2).map((e, i) => (
                                      <div key={i}>HTTP {e.status}: {e.body || "(no body)"}</div>
                                    ))}
                                  </div>
                                )}
                                <div className="opacity-80">
                                  Common causes: Aircall plan doesn't include Power Dialer (403), phone number format rejected (422), or the Aircall user isn't in a team with PD enabled.
                                </div>
                              </div>
                            ) : (
                              <>Pushed {pdLastResult.pushed} number{pdLastResult.pushed !== 1 ? "s" : ""} to Aircall
                                {pdLastResult.cleared > 0 ? ` (cleared ${pdLastResult.cleared} previous)` : ""}
                                {" · "}{pdLastResult.at.toLocaleTimeString()}</>
                            )}
                          </div>
                        );
                      })()}
                    </div>
                  ) : callStatus === "on_call" ? (
                    <div className="w-full h-12 rounded-lg bg-primary/15 border border-primary/30 flex items-center justify-center gap-2 text-primary font-semibold">
                      <span className="relative flex h-2.5 w-2.5">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75" />
                        <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-primary" />
                      </span>
                      Call In Progress
                    </div>
                  ) : callStatus === "ringing" ? (
                    <div className="w-full h-12 rounded-lg bg-blue-500/15 border border-blue-500/30 flex items-center justify-center gap-2 text-blue-500 font-semibold">
                      <span className="relative flex h-2.5 w-2.5">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-500 opacity-75" />
                        <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-blue-500" />
                      </span>
                      Incoming Call
                    </div>
                  ) : dialing ? (
                    <div
                      onClick={() => setDialing(false)}
                      className="w-full h-12 rounded-lg bg-amber-500/15 border border-amber-500/30 flex items-center justify-center gap-2 text-amber-500 font-semibold cursor-pointer hover:bg-amber-500/25 transition-colors"
                    >
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Dialling… <span className="text-xs opacity-60 ml-1">(click to cancel)</span>
                    </div>
                  ) : !aircallConfigured ? (
                    <Link href="/settings" className="block">
                      <Button variant="outline" className="w-full h-12" disabled>
                        <Settings className="w-4 h-4 mr-2" /> Configure Aircall to call
                      </Button>
                    </Link>
                  ) : !isLoggedIn ? (
                    <Button variant="outline" className="w-full h-12" disabled>
                      <PhoneOff className="w-4 h-4 mr-2" /> Log into Aircall first
                    </Button>
                  ) : !currentContact.phone ? (
                    <Button variant="outline" className="w-full h-12" disabled>
                      <PhoneOff className="w-4 h-4 mr-2" /> No Phone Number
                    </Button>
                  ) : (
                    <Button
                      className="w-full h-12 bg-primary hover:bg-primary/90 text-primary-foreground text-base font-semibold shadow-lg shadow-primary/20"
                      onClick={() => handleDial(currentContact.phone!, currentContact)}
                    >
                      <PhoneCall className="w-5 h-5 mr-2" />
                      Load Call
                    </Button>
                  )}
                  {aircallError && (
                    <p className="text-xs text-destructive mt-1.5">{aircallError}</p>
                  )}
                </div>

                {/* SECTION 3: Call Prep */}
                <div className="px-5 pb-4">
                  <div className="rounded-lg border border-border/50 bg-muted/30 p-4 text-sm">
                    <p className="font-medium text-foreground mb-1 flex items-center gap-1.5">
                      <Headphones className="w-4 h-4" /> Call Prep
                    </p>
                    <p className="text-muted-foreground">Belief map and conversation history will appear here once intelligence is available for this contact.</p>
                  </div>
                </div>

                {/* SECTION 4: Navigation */}
                <div className="px-5 pb-4 flex items-center justify-between">
                  <div className="flex gap-2">
                    {viewingIndex !== null && viewingIndex !== currentCallIndex ? (
                      <Button variant="outline" size="sm" onClick={() => { setViewingIndex(null); setDialing(false); }}>
                        ← Back to Queue
                      </Button>
                    ) : (
                      <Button variant="outline" size="sm" disabled={activeIndex <= 0}
                        onClick={() => { setViewingIndex(activeIndex - 1); setDialing(false); }}>Previous</Button>
                    )}
                    <Button size="sm" disabled={activeIndex >= queuedCalls - 1}
                      onClick={() => { setViewingIndex(activeIndex + 1); setDialing(false); }}>
                      Next Contact <ArrowRight className="w-4 h-4 ml-1" />
                    </Button>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {viewingIndex !== null && viewingIndex !== currentCallIndex
                      ? <span className="text-amber-500">Previewing {activeIndex + 1} of {queuedCalls}</span>
                      : <span>{activeIndex + 1} of {queuedCalls}</span>
                    }
                  </span>
                </div>
              </>
            ) : (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-3">
                  <Phone className="w-8 h-8 text-muted-foreground/40" />
                </div>
                <p className="font-medium">No contact loaded</p>
                <p className="text-sm text-muted-foreground mt-1">
                  {queuedCalls > 0 ? "Navigate through your call list." : "Create a call list to get started."}
                </p>
              </div>
            )}
          </Card>
        </div>

        {/* AIRCALL WIDGET */}
        <div>
          <Card className="overflow-hidden h-full flex flex-col">
            <div className="bg-[#00B388] px-4 py-2.5 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <PhoneCall className="w-4 h-4 text-white" />
                <span className="text-white font-semibold text-sm">Aircall</span>
              </div>
              <Badge className="bg-white/20 text-white border-0 text-[10px]">
                {!aircallConfigured ? "Not Configured" :
                 !isLoggedIn ? "Logged Out" :
                 callStatus === "on_call" ? "On Call" :
                 callStatus === "ringing" ? "Ringing" : "Available"}
              </Badge>
            </div>

            {!aircallConfigured ? (
              <div className="flex-1 flex flex-col items-center justify-center p-6">
                <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-3">
                  <Settings className="w-8 h-8 text-muted-foreground/40" />
                </div>
                <p className="font-medium">Aircall not configured</p>
                <p className="text-sm text-muted-foreground mt-1 mb-3">Set up your Aircall credentials to enable calling.</p>
                <Link href="/settings"><Button variant="outline" size="sm" className="gap-1.5"><Settings className="w-3.5 h-3.5" /> Go to Settings</Button></Link>
              </div>
            ) : (
              <div className="flex-1 flex flex-col">
                <div id="aircall-phone-container" className="flex-1 min-h-[560px]" />
              </div>
            )}

            <div className="border-t px-3 py-1.5">
              <a href="https://app.aircall.io" target="_blank" rel="noopener noreferrer"
                className="flex items-center justify-center gap-1 text-[10px] text-muted-foreground hover:text-foreground">
                Aircall Dashboard <ExternalLink className="w-2.5 h-2.5" />
              </a>
            </div>
          </Card>
        </div>
      </div>

      {/* UP NEXT */}
      <div>
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2 text-base">
                <Headphones className="w-4 h-4" /> Up Next ({Math.max(0, queuedCalls - currentCallIndex - 1)})
              </CardTitle>
              <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs text-muted-foreground" onClick={loadAll} disabled={loading}>
                <RefreshCw className={`w-3 h-3 ${loading ? "animate-spin" : ""}`} /> Refresh
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {upNext.length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8">#</TableHead>
                    <TableHead>Contact</TableHead>
                    <TableHead>Company</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Last outcome</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {upNext.map((c, i) => {
                    const targetIdx = upNextStart + i;
                    return (
                      <TableRow key={c.id} className="cursor-pointer hover:bg-muted/50"
                        onClick={() => {
                          // Swap the clicked contact into the current slot
                          setCallList(prev => {
                            if (!prev[targetIdx] || !prev[currentCallIndex]) return prev;
                            const next = [...prev];
                            [next[currentCallIndex], next[targetIdx]] = [next[targetIdx], next[currentCallIndex]];
                            return next;
                          });
                          setViewingIndex(null);
                          setDialing(false);
                        }}>
                        <TableCell className="text-muted-foreground text-xs">{targetIdx + 1}</TableCell>
                        <TableCell className="font-medium text-sm">{c.first_name} {c.last_name}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">{c.company || "—"}</TableCell>
                        <TableCell>
                          <Badge
                            variant="outline"
                            className={`text-xs ${
                              c.priority === "conversion"
                                ? "bg-purple-500/10 text-purple-700 border-purple-500/30"
                                : ""
                            }`}
                          >
                            {c.priority === "conversion" ? "Conversion" :
                             c.priority === "callback" ? "Callback" :
                             c.priority === "follow-up" ? "Follow-up" :
                             c.priority === "retry" ? "Retry" :
                             c.priority === "recall" ? "Recall" : "Fresh"}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          {c.last_call_outcome ? (
                            <Badge variant="outline" className={`text-xs ${outcomeBadgeClasses(c.last_call_outcome)}`}>
                              {outcomeLabel(c.last_call_outcome)}
                            </Badge>
                          ) : (
                            <span className="text-xs text-muted-foreground/50">—</span>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            ) : (
              <div className="text-center py-6">
                <Headphones className="w-6 h-6 text-muted-foreground/30 mx-auto mb-2" />
                <p className="text-sm text-muted-foreground">{queuedCalls > 0 ? "No more contacts after this one." : "Queue is empty."}</p>
              </div>
            )}

            {/* Pager — only render when there's more than one page */}
            {totalUpNext > UP_NEXT_PAGE_SIZE && (
              <div className="flex items-center justify-between mt-3 text-xs text-muted-foreground">
                <span>
                  Showing {upNextStart - currentCallIndex} – {Math.min(upNextEnd - currentCallIndex - 1, totalUpNext)} of {totalUpNext}
                </span>
                <div className="flex items-center gap-1">
                  <Button variant="outline" size="sm" className="h-7"
                    disabled={upNextPage === 0}
                    onClick={() => setUpNextPage(p => Math.max(0, p - 1))}>
                    Previous
                  </Button>
                  <span className="px-2">Page {upNextPage + 1} of {upNextPageCount}</span>
                  <Button variant="outline" size="sm" className="h-7"
                    disabled={upNextPage >= upNextPageCount - 1}
                    onClick={() => setUpNextPage(p => Math.min(upNextPageCount - 1, p + 1))}>
                    Next
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Create Call List Dialog */}
      <Dialog open={createOpen} onOpenChange={(open) => { setCreateOpen(open); if (!open) setCarryOver(false); }}>
        <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Create call list</DialogTitle>
            <DialogDescription>
              Build a dispatch queue for an agent, drawn from the contact pool.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-5 py-1">
            {/* Carry-over notice — surfaced when the dialog was opened via the
                "Carry over yesterday" action on the page header. Informational
                only; the stale contacts are moved into the new list by the
                /carry-over call inside handleCreateCallList. */}
            {carryOver && staleCount > 0 && (
              <div className="rounded-md border border-orange-500/50 bg-orange-500/5 px-3 py-2.5 text-sm">
                <span className="font-medium">{staleCount} contact{staleCount !== 1 ? "s" : ""}</span>
                <span className="text-muted-foreground"> from yesterday will be carried over. Remaining quota is filled with fresh contacts.</span>
              </div>
            )}

            {/* ===== BASICS ===== */}
            <section className="space-y-3">
              <div className="flex items-center gap-3">
                <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Basics</span>
                <div className="flex-1 h-px bg-border" />
              </div>

              <div className="space-y-1.5">
                <label className="text-sm font-medium">List name <span className="text-destructive">*</span></label>
                <Input value={newName} onChange={e => setNewName(e.target.value)} placeholder="e.g. Marie — 16 Apr 2026" />
                <p className="text-[11px] text-muted-foreground">How this list shows up on the dashboard. Use any label that helps you recognise it.</p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Assigned agent</label>
                  <Select value={newAgent} onValueChange={setNewAgent}>
                    <SelectTrigger><SelectValue placeholder="Select agent…" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">Unassigned</SelectItem>
                      {agents.filter(a => a.active).map(a => (
                        <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-[11px] text-muted-foreground">Whose Call Command this list feeds. Required to preview eligibility.</p>
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Daily quota</label>
                  <Input type="number" min={1} value={newQuota} onChange={e => setNewQuota(e.target.value)} />
                  <p className="text-[11px] text-muted-foreground">Target dispatches per day. Tops up as calls complete.</p>
                </div>
              </div>
            </section>

            {/* ===== FILTERS ===== */}
            <section className="space-y-3">
              <div className="flex items-center gap-3">
                <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Filters</span>
                <div className="flex-1 h-px bg-border" />
              </div>

              <div className="space-y-1.5">
                <label className="text-sm font-medium">Source lists</label>
                {sources.length === 0 ? (
                  <div className="text-sm text-muted-foreground rounded-md border border-dashed border-border px-3 py-2.5 text-center">
                    No contact lists uploaded yet — upload a list to filter by source.
                  </div>
                ) : (
                  <>
                    <Popover open={sourcesPopoverOpen} onOpenChange={setSourcesPopoverOpen}>
                      <PopoverTrigger asChild>
                        <Button
                          type="button"
                          variant="outline"
                          role="combobox"
                          aria-expanded={sourcesPopoverOpen}
                          className="w-full justify-between font-normal"
                        >
                          <span className={newSourceLists.length === 0 ? "text-muted-foreground" : ""}>
                            {newSourceLists.length === 0
                              ? "All lists"
                              : newSourceLists.length === 1
                                ? newSourceLists[0]
                                : `${newSourceLists.length} of ${sources.length} lists selected`}
                          </span>
                          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                        <Command>
                          <CommandInput placeholder="Search lists…" />
                          <CommandList>
                            <CommandEmpty>No list matches.</CommandEmpty>
                            <CommandGroup className="max-h-64 overflow-auto">
                              {sources.map(s => {
                                const checked = newSourceLists.includes(s);
                                return (
                                  <CommandItem
                                    key={s}
                                    value={s}
                                    onSelect={() => setNewSourceLists(prev =>
                                      prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s]
                                    )}
                                  >
                                    <Check className={cn("mr-2 h-4 w-4", checked ? "opacity-100" : "opacity-0")} />
                                    {s}
                                  </CommandItem>
                                );
                              })}
                            </CommandGroup>
                          </CommandList>
                        </Command>
                      </PopoverContent>
                    </Popover>

                    {newSourceLists.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 pt-1">
                        {newSourceLists.map(s => (
                          <Badge key={s} variant="secondary" className="gap-1 pr-1 font-normal">
                            <span>{s}</span>
                            <button
                              type="button"
                              aria-label={`Remove ${s}`}
                              className="ml-0.5 rounded-sm hover:bg-muted-foreground/20 p-0.5"
                              onClick={() => setNewSourceLists(prev => prev.filter(x => x !== s))}
                            >
                              <X className="w-3 h-3" />
                            </button>
                          </Badge>
                        ))}
                        {newSourceLists.length > 1 && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-6 px-2 text-xs"
                            onClick={() => setNewSourceLists([])}
                          >
                            Clear all
                          </Button>
                        )}
                      </div>
                    )}
                  </>
                )}
                <p className="text-[11px] text-muted-foreground">
                  Draw only from the lists you pick. Leave blank to pull from every uploaded list.
                </p>
              </div>
            </section>

            {/* ===== OPTIONS — only rendered when a role-gated option applies ===== */}
            {newPreview && (newPreview.closer_role === "closer" || newPreview.closer_role === "admin") && (
              <section className="space-y-3">
                <div className="flex items-center gap-3">
                  <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Options</span>
                  <div className="flex-1 h-px bg-border" />
                </div>

                <div className="flex items-start gap-3 p-3 bg-purple-500/5 border border-purple-500/30 rounded-md">
                  <Switch
                    id="closingOnly"
                    checked={newClosingOnly}
                    onCheckedChange={setNewClosingOnly}
                    className="mt-0.5"
                  />
                  <div className="flex-1">
                    <label htmlFor="closingOnly" className="text-sm font-medium cursor-pointer">
                      Closing calls only
                    </label>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      Skip cold outreach. List contains only contacts tagged for closer handoff (tier 0 conversions).
                    </p>
                  </div>
                </div>
              </section>
            )}

            {/* ===== YOU'LL GET — live eligibility preview ===== */}
            <section className="space-y-3">
              <div className="flex items-center gap-3">
                <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">You'll get</span>
                <div className="flex-1 h-px bg-border" />
              </div>

              {!newAgent || newAgent === "__none__" ? (
                <div className="text-xs text-muted-foreground rounded-md border border-dashed border-border px-3 py-2.5 text-center">
                  Pick an agent above to preview what this list will contain.
                </div>
              ) : (
                <Card className="border-border">
                  <CardContent className="py-3 px-4">
                    {previewLoading && (
                      <div className="flex items-center gap-2 text-xs text-muted-foreground mb-2">
                        <Loader2 className="w-3 h-3 animate-spin" /> Calculating eligibility…
                      </div>
                    )}
                    {newPreview
                      ? renderForecast(newPreview, parseInt(newQuota) || 100)
                      : !previewLoading && (
                          <p className="text-xs text-muted-foreground">Preview unavailable for this agent.</p>
                        )}
                  </CardContent>
                </Card>
              )}

              {/* Pool availability — kept as a secondary signal alongside the
                  eligibility breakdown. Colour follows quota headroom. */}
              <div className={cn(
                "rounded-md border px-4 py-2.5 flex items-center justify-between",
                poolAvailable >= (parseInt(newQuota) || 100)
                  ? "border-green-500/50"
                  : poolAvailable > 0
                    ? "border-yellow-500/50"
                    : "border-destructive/50"
              )}>
                <div>
                  <p className="text-sm">
                    <span className="font-bold">{poolAvailable.toLocaleString()}</span>
                    <span className="text-muted-foreground"> contacts available in pool</span>
                  </p>
                  {poolAvailable < (parseInt(newQuota) || 100) && poolAvailable > 0 && (
                    <p className="text-[11px] text-muted-foreground mt-0.5">Below daily quota of {parseInt(newQuota) || 100}</p>
                  )}
                  {poolAvailable === 0 && (
                    <p className="text-[11px] text-destructive mt-0.5">No contacts available — upload a list first</p>
                  )}
                </div>
                {poolAvailable < (parseInt(newQuota) || 100) && (
                  <Link href="/contacts/upload">
                    <Button variant="outline" size="sm" className="gap-1.5 shrink-0">
                      <Upload className="w-3.5 h-3.5" /> Top Up
                    </Button>
                  </Link>
                )}
              </div>
            </section>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            {(() => {
              // Sum eligibility across tiers that apply for the selected
              // agent + filter config. Zero across everything means creating
              // the list would just produce an empty row — disable with a
              // clear label + tooltip.
              const p = newPreview;
              const totalEligible = p
                ? (p.closing_only
                    ? p.conversions_due
                    : p.conversions_due + p.callbacks_due + p.interested_followups + p.retry_eligible + p.pool_available)
                : null;
              const agentPicked = !!newAgent && newAgent !== "__none__";
              const zeroEligible = agentPicked && totalEligible === 0 && !previewLoading;
              return (
                <Button
                  onClick={handleCreateCallList}
                  disabled={creating || !newName.trim() || zeroEligible}
                  title={zeroEligible ? "No eligible contacts to dispatch with these filters" : undefined}
                >
                  {creating && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                  {zeroEligible ? "No contacts to dispatch" : "Create call list"}
                </Button>
              );
            })()}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* TOP UP DIALOG — adds N more contacts to the currently-active list.
          Uses the existing list's fill-queue endpoint; does NOT create a
          new list. */}
      <Dialog open={topUpOpen} onOpenChange={setTopUpOpen}>
        <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Top up call list</DialogTitle>
            <DialogDescription>
              Add more contacts to the currently active list.
            </DialogDescription>
          </DialogHeader>

          {(() => {
            const topUpAgentName = activeCallListDef?.assigned_agent_id
              ? (agents.find(a => a.id === activeCallListDef.assigned_agent_id)?.name ?? "Unknown")
              : "Unassigned";
            const topUpSources = activeCallListDef?.filter_criteria?.source_lists;
            const topUpClosingOnly = !!activeCallListDef?.closing_only;
            const requestedCount = parseInt(topUpCount) || 0;
            const isCloserList = topUpPreview && (topUpPreview.closer_role === "closer" || topUpPreview.closer_role === "admin");
            const showOptions = isCloserList && topUpClosingOnly;
            const totalEligible = topUpPreview
              ? (topUpPreview.closing_only
                  ? topUpPreview.conversions_due
                  : topUpPreview.conversions_due + topUpPreview.callbacks_due + topUpPreview.interested_followups + topUpPreview.retry_eligible + topUpPreview.pool_available)
              : null;
            const zeroEligible = totalEligible === 0 && !topUpPreviewLoading;

            return (
              <div className="space-y-5 py-1">
                {/* ===== BASICS (read-only except "how many to add") ===== */}
                <section className="space-y-3">
                  <div className="flex items-center gap-3">
                    <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Basics</span>
                    <div className="flex-1 h-px bg-border" />
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-sm font-medium">List name</label>
                    <Input value={activeCallListDef?.name ?? ""} disabled readOnly />
                    <p className="text-[11px] text-muted-foreground">The list you're topping up. Can't be renamed from here.</p>
                  </div>

                  <div className="grid grid-cols-3 gap-3">
                    <div className="space-y-1.5">
                      <label className="text-sm font-medium">Assigned agent</label>
                      <Input value={topUpAgentName} disabled readOnly />
                      <p className="text-[11px] text-muted-foreground">Whose queue this list feeds.</p>
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-sm font-medium">Daily quota</label>
                      <Input value={String(activeCallListDef?.daily_quota ?? "—")} disabled readOnly />
                      <p className="text-[11px] text-muted-foreground">
                        Currently {queuedCalls} / {activeCallListDef?.daily_quota ?? "—"}
                        {activeCallListDef?.daily_quota && queuedCalls >= activeCallListDef.daily_quota && (
                          <span className="text-amber-600"> (at quota)</span>
                        )}
                      </p>
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-sm font-medium">How many to add <span className="text-destructive">*</span></label>
                      <Input
                        type="number"
                        min={1}
                        max={500}
                        value={topUpCount}
                        onChange={e => setTopUpCount(e.target.value)}
                        autoFocus
                      />
                      <p className="text-[11px] text-muted-foreground">Extra contacts to pull now.</p>
                    </div>
                  </div>
                </section>

                {/* ===== FILTERS (read-only) ===== */}
                <section className="space-y-3">
                  <div className="flex items-center gap-3">
                    <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Filters</span>
                    <div className="flex-1 h-px bg-border" />
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-sm font-medium">Source lists</label>
                    {Array.isArray(topUpSources) && topUpSources.length > 0 ? (
                      <div className="flex flex-wrap gap-1.5 rounded-md border border-border bg-muted/30 px-3 py-2">
                        {topUpSources.map(s => (
                          <Badge key={s} variant="secondary" className="font-normal">{s}</Badge>
                        ))}
                      </div>
                    ) : (
                      <div className="rounded-md border border-border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
                        All lists
                      </div>
                    )}
                    <p className="text-[11px] text-muted-foreground">
                      Inherited from the list. Can't be changed during top up.
                    </p>
                  </div>
                </section>

                {/* ===== OPTIONS — only when closer + closing_only is on ===== */}
                {showOptions && (
                  <section className="space-y-3">
                    <div className="flex items-center gap-3">
                      <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Options</span>
                      <div className="flex-1 h-px bg-border" />
                    </div>

                    <div className="flex items-start gap-3 p-3 bg-purple-500/5 border border-purple-500/30 rounded-md">
                      <Switch id="topUpClosingOnly" checked disabled className="mt-0.5" />
                      <div className="flex-1">
                        <label htmlFor="topUpClosingOnly" className="text-sm font-medium">
                          Closing calls only
                        </label>
                        <p className="text-[11px] text-muted-foreground mt-0.5">
                          List only tops up with contacts tagged for closer handoff (tier 0 conversions).
                        </p>
                      </div>
                    </div>
                  </section>
                )}

                {/* ===== YOU'LL GET — dispatch forecast for the requested count ===== */}
                <section className="space-y-3">
                  <div className="flex items-center gap-3">
                    <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">You'll get</span>
                    <div className="flex-1 h-px bg-border" />
                  </div>

                  {!activeCallListDef?.assigned_agent_id ? (
                    <div className="text-xs text-muted-foreground rounded-md border border-dashed border-border px-3 py-2.5 text-center">
                      This list has no assigned agent — can't preview top-up eligibility.
                    </div>
                  ) : (
                    <Card className="border-border">
                      <CardContent className="py-3 px-4">
                        {topUpPreviewLoading && (
                          <div className="flex items-center gap-2 text-xs text-muted-foreground mb-2">
                            <Loader2 className="w-3 h-3 animate-spin" /> Calculating eligibility…
                          </div>
                        )}
                        {topUpPreview
                          ? renderForecast(topUpPreview, requestedCount)
                          : !topUpPreviewLoading && (
                              <p className="text-xs text-muted-foreground">Preview unavailable.</p>
                            )}
                      </CardContent>
                    </Card>
                  )}

                  <div className={cn(
                    "rounded-md border px-4 py-2.5 flex items-center justify-between",
                    poolAvailable >= requestedCount
                      ? "border-green-500/50"
                      : poolAvailable > 0
                        ? "border-yellow-500/50"
                        : "border-destructive/50"
                  )}>
                    <div>
                      <p className="text-sm">
                        <span className="font-bold">{poolAvailable.toLocaleString()}</span>
                        <span className="text-muted-foreground"> contacts available in pool</span>
                      </p>
                      {poolAvailable === 0 && (
                        <p className="text-[11px] text-destructive mt-0.5">No fresh contacts in pool — upload a list first</p>
                      )}
                    </div>
                    {poolAvailable < requestedCount && (
                      <Link href="/contacts/upload">
                        <Button variant="outline" size="sm" className="gap-1.5 shrink-0">
                          <Upload className="w-3.5 h-3.5" /> Upload
                        </Button>
                      </Link>
                    )}
                  </div>

                  {topUpError && (
                    <p className="text-sm text-destructive">{topUpError}</p>
                  )}
                </section>

                <DialogFooter>
                  <Button variant="outline" onClick={() => setTopUpOpen(false)} disabled={topUpSubmitting}>
                    Cancel
                  </Button>
                  <Button
                    onClick={handleTopUp}
                    disabled={topUpSubmitting || !activeCallListDef || requestedCount <= 0 || zeroEligible}
                    title={zeroEligible ? "No eligible contacts to add with this list's filters" : undefined}
                  >
                    {topUpSubmitting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                    {zeroEligible ? "No contacts to add" : `Add ${requestedCount} to list`}
                  </Button>
                </DialogFooter>
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>
    </div>
  );
}
