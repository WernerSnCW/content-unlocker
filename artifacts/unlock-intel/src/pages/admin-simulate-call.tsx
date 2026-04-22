import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Loader2, PlayCircle, CheckCircle2 } from "lucide-react";
import { apiFetch, apiPost } from "@/lib/apiClient";
import { useCurrentUser } from "@/hooks/useCurrentUser";

interface AdminAgent {
  id: string;
  name: string;
  email: string | null;
  active: boolean;
}

interface ContactRow {
  id: string;
  first_name: string;
  last_name: string;
  email: string | null;
  phone: string | null;
  company: string | null;
  dispatch_status: string | null;
  last_call_outcome: string | null;
}

interface AgentCallList {
  id: string;
  name: string;
  active: boolean;
  closing_only: boolean;
  daily_quota: number;
  contacts: Array<{
    id: string;
    first_name: string;
    last_name: string;
    phone: string | null;
    dispatch_status: string | null;
    last_call_outcome: string | null;
    membership_added_at: string;
  }>;
}

interface TagMappingRow {
  aircall_tag: string;
  outcome: string;
  side_effect: string;
  cool_off_days?: number | null;
}

interface SimulateResult {
  ok: boolean;
  synthetic_call_id: string;
  resolved: { outcome: string; side_effect: string };
  events: Array<{
    event: string;
    result: string | null;
    error?: string;
  }>;
  created_simulator_list: boolean;
  created_simulator_membership: boolean;
  final: {
    contact: {
      id: string;
      dispatch_status: string | null;
      last_call_outcome: string | null;
      call_attempts: number | null;
      callback_date: string | null;
      cool_off_until: string | null;
    } | null;
    conversation: {
      id: string;
      call_outcome: string | null;
      tags: unknown;
      processed_at: string | null;
      engine_version: string | null;
      has_transcript: boolean;
      has_summary: boolean;
    } | null;
    memberships: Array<{
      id: string;
      call_list_id: string;
      added_at: string;
      removed_at: string | null;
      removal_reason: string | null;
      outcome_at_removal: string | null;
    }>;
  };
}

const API_BASE = (import.meta.env.BASE_URL?.replace(/\/$/, "") || "") + "/api";

export default function AdminSimulateCallPage() {
  const { data: currentUser } = useCurrentUser();

  // Reference data
  const [agents, setAgents] = useState<AdminAgent[]>([]);
  const [tagMapping, setTagMapping] = useState<TagMappingRow[]>([]);

  // Contacts (plain Select dropdown — small enough DB that fetching all works)
  const [contacts, setContacts] = useState<ContactRow[]>([]);
  const [contactsLoading, setContactsLoading] = useState(true);
  const [selectedContactId, setSelectedContactId] = useState<string>("");
  const selectedContact = useMemo(
    () => contacts.find(c => c.id === selectedContactId) || null,
    [contacts, selectedContactId],
  );

  // Agent-owned call lists. Loaded when the agent picker changes. The flow
  // is agent → list → contact so the operator picks a realistic combination
  // (matching how agents actually work — only contacts on their own list).
  // Special values for selectedListId:
  //   ""    = nothing picked yet (blocks contact picker)
  //   "any" = ad-hoc ("Any contact") — falls back to the full contact list
  //   else  = specific list id → filtered contacts shown
  const [agentLists, setAgentLists] = useState<AgentCallList[]>([]);
  const [agentListsLoading, setAgentListsLoading] = useState(false);
  const [selectedListId, setSelectedListId] = useState<string>("");

  // Form fields
  const [agentId, setAgentId] = useState<string>("");
  const [tag, setTag] = useState<string>("");
  const [duration, setDuration] = useState<string>("60");
  // Session-4 improvement B — explicit call type override. "auto" = infer
  // from duration (the production behaviour). Picking cold/demo/opportunity
  // tells the backend to synthesize a duration in the right bucket so the
  // engine classifies as requested, regardless of what's typed in the
  // duration field.
  const [callType, setCallType] = useState<"auto" | "cold_call" | "demo" | "opportunity">("auto");
  const [direction, setDirection] = useState<"inbound" | "outbound">("outbound");
  const [ensureMembership, setEnsureMembership] = useState(true);
  const [transcript, setTranscript] = useState<string>("");
  const [summary, setSummary] = useState<string>("");

  // UI state
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [result, setResult] = useState<SimulateResult | null>(null);

  // Load agents + tag mapping on mount.
  useEffect(() => {
    (async () => {
      try {
        const [agentsRes, mappingRes] = await Promise.all([
          apiFetch(`${API_BASE}/admin/agents`),
          apiFetch(`${API_BASE}/admin/tag-mapping`),
        ]);
        const agentsData = await agentsRes.json();
        const activeAgents: AdminAgent[] = (agentsData.agents || []).filter((a: AdminAgent) => a.active);
        setAgents(activeAgents);
        // Default the agent to the logged-in admin's own linked agent if any.
        const myAgent = activeAgents.find(a => a.id === currentUser?.agent?.id);
        if (myAgent) setAgentId(myAgent.id);
        else if (activeAgents[0]) setAgentId(activeAgents[0].id);

        const mappingData = await mappingRes.json();
        setTagMapping(mappingData.mapping || []);
        if ((mappingData.mapping || []).length > 0) {
          setTag(mappingData.mapping[0].aircall_tag);
        }
      } catch { /* ignore */ }
    })();
  }, [currentUser?.agent?.id]);

  // Load all contacts on mount for the dropdown. Page size is high (100 max
  // per the API) so this works for small-to-medium DBs; if the pool ever
  // grows past a few hundred, swap this for a combobox with server-side
  // search.
  useEffect(() => {
    (async () => {
      setContactsLoading(true);
      try {
        const res = await apiFetch(`${API_BASE}/contacts?page_size=100`);
        const data = await res.json();
        setContacts(data.data || []);
      } catch { /* ignore */ }
      finally { setContactsLoading(false); }
    })();
  }, []);

  const selectedTagMapping = useMemo(
    () => tagMapping.find(m => m.aircall_tag === tag) || null,
    [tag, tagMapping],
  );

  // When agent changes, load their call lists. Reset list + contact pickers
  // so the operator doesn't accidentally simulate an inconsistent combo.
  useEffect(() => {
    if (!agentId) {
      setAgentLists([]);
      setSelectedListId("");
      setSelectedContactId("");
      return;
    }
    setAgentListsLoading(true);
    setSelectedListId("");
    setSelectedContactId("");
    (async () => {
      try {
        const res = await apiFetch(`${API_BASE}/admin/agents/${agentId}/call-lists`);
        const data = await res.json();
        setAgentLists(data.lists || []);
      } catch {
        setAgentLists([]);
      } finally {
        setAgentListsLoading(false);
      }
    })();
  }, [agentId]);

  // Contacts to show in the contact picker, based on list selection.
  const contactOptions = useMemo(() => {
    if (selectedListId === "any") {
      return contacts.map((c) => ({
        id: c.id,
        label: `${c.first_name} ${c.last_name}`,
        sub: [c.phone, c.dispatch_status].filter(Boolean).join(" · "),
      }));
    }
    if (!selectedListId) return [];
    const list = agentLists.find((l) => l.id === selectedListId);
    if (!list) return [];
    return list.contacts.map((c) => ({
      id: c.id,
      label: `${c.first_name} ${c.last_name}`,
      sub: [c.phone, c.dispatch_status, c.last_call_outcome].filter(Boolean).join(" · "),
    }));
  }, [selectedListId, agentLists, contacts]);

  const handleSubmit = async () => {
    if (!selectedContact) { setSubmitError("Pick a contact first"); return; }
    if (!agentId) { setSubmitError("Pick an agent"); return; }
    if (!tag) { setSubmitError("Pick a tag"); return; }
    setSubmitting(true);
    setSubmitError(null);
    setResult(null);
    try {
      const res = await apiPost(`${API_BASE}/admin/simulate-call`, {
        contact_id: selectedContact.id,
        agent_id: agentId,
        tag,
        transcript,
        summary,
        duration_seconds: Number(duration) || 60,
        call_type: callType === "auto" ? undefined : callType,
        direction,
        ensure_membership: ensureMembership,
      }, { redirectOn401: false });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setSubmitError(body.message || body.error || `Request failed (${res.status})`);
        return;
      }
      const data = (await res.json()) as SimulateResult;
      setResult(data);
    } catch (err: any) {
      setSubmitError(err?.message || "Simulation failed");
    } finally {
      setSubmitting(false);
    }
  };

  const reset = () => {
    setResult(null);
    setSubmitError(null);
  };

  return (
    <div className="space-y-5 max-w-4xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Simulate Call</h1>
          <p className="text-sm text-muted-foreground">
            Admin test harness — runs a fake call through every downstream path
            (conversation row, outcome + side-effect, engine) without dialling Aircall.
          </p>
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-5">
        {/* LEFT: form */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Simulation inputs</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Contact picker */}
            <div className="space-y-1">
              <label className="text-sm font-medium">1. Calling as (agent)</label>
              <Select value={agentId} onValueChange={setAgentId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select agent..." />
                </SelectTrigger>
                <SelectContent>
                  {agents.map(a => (
                    <SelectItem key={a.id} value={a.id}>{a.name} ({a.email || "no email"})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Pick the agent first — their call lists load below, then you
                pick a contact from one of those lists. This mirrors real
                operation: agents only call contacts on their own lists.
              </p>
            </div>

            {/* List picker — appears once an agent is picked */}
            <div className="space-y-1">
              <label className="text-sm font-medium">2. Call list</label>
              <Select
                value={selectedListId}
                onValueChange={(v) => { setSelectedListId(v); setSelectedContactId(""); }}
                disabled={!agentId || agentListsLoading}
              >
                <SelectTrigger>
                  <SelectValue
                    placeholder={
                      !agentId
                        ? "Pick an agent first"
                        : agentListsLoading
                        ? "Loading lists…"
                        : agentLists.length === 0
                        ? "Agent has no call lists (use 'Any contact' below)"
                        : "Select a call list…"
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  {agentLists.map((l) => (
                    <SelectItem key={l.id} value={l.id}>
                      {l.name} · {l.contacts.length} active
                      {l.closing_only ? " · closing only" : ""}
                      {!l.active ? " · inactive" : ""}
                    </SelectItem>
                  ))}
                  <SelectItem value="any">
                    Any contact (ad-hoc — bypasses realistic list routing)
                  </SelectItem>
                </SelectContent>
              </Select>
              {selectedListId === "any" && (
                <p className="text-xs text-amber-600">
                  Ad-hoc mode — you're simulating an unusual scenario
                  (admin override, Power Dialer override, etc.). Review
                  ownership may route to whoever owns the contact's current
                  list, not the agent you picked.
                </p>
              )}
            </div>

            {/* Contact picker — filtered to the selected list's contacts */}
            <div className="space-y-1">
              <label className="text-sm font-medium">3. Contact</label>
              <Select
                value={selectedContactId}
                onValueChange={setSelectedContactId}
                disabled={!selectedListId || (selectedListId === "any" && contactsLoading)}
              >
                <SelectTrigger>
                  <SelectValue
                    placeholder={
                      !selectedListId
                        ? "Pick a list first"
                        : contactOptions.length === 0
                        ? "No contacts on this list"
                        : "Select a contact…"
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  {contactOptions.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.label}
                      {c.sub ? ` · ${c.sub}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedContact && (
                <p className="text-xs text-muted-foreground">
                  {selectedContact.email || "no email"} · status: {selectedContact.dispatch_status || "—"} · last outcome: {selectedContact.last_call_outcome || "—"}
                </p>
              )}
            </div>

            {/* Tag picker */}
            <div className="space-y-1">
              <label className="text-sm font-medium">Tag</label>
              <Select value={tag} onValueChange={setTag}>
                <SelectTrigger>
                  <SelectValue placeholder="Select tag..." />
                </SelectTrigger>
                <SelectContent>
                  {tagMapping.map(m => (
                    <SelectItem key={m.aircall_tag} value={m.aircall_tag}>
                      {m.aircall_tag} → {m.outcome} / {m.side_effect}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedTagMapping && (
                <p className="text-xs text-muted-foreground">
                  Resolves to outcome=<code>{selectedTagMapping.outcome}</code>, side_effect=<code>{selectedTagMapping.side_effect}</code>.
                </p>
              )}
            </div>

            {/* Metadata row */}
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1">
                <label className="text-sm font-medium">Call type</label>
                <Select value={callType} onValueChange={(v: any) => setCallType(v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="auto">Auto (from duration)</SelectItem>
                    <SelectItem value="cold_call">Cold call</SelectItem>
                    <SelectItem value="demo">Demo</SelectItem>
                    <SelectItem value="opportunity">Opportunity</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  {callType === "auto"
                    ? "Engine infers from duration."
                    : "Overrides duration-based inference."}
                </p>
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium">Duration (s)</label>
                <Input
                  type="number"
                  value={duration}
                  onChange={e => setDuration(e.target.value)}
                  disabled={callType !== "auto"}
                />
                <p className="text-xs text-muted-foreground">
                  {callType !== "auto" ? "Overridden by call type." : "Any positive number."}
                </p>
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium">Direction</label>
                <Select value={direction} onValueChange={(v: any) => setDirection(v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="outbound">outbound</SelectItem>
                    <SelectItem value="inbound">inbound</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Transcript */}
            <div className="space-y-1">
              <label className="text-sm font-medium">Transcript</label>
              <Textarea
                className="font-mono text-xs min-h-[140px]"
                placeholder={`Agent: Hi Jane, is this a good time to chat about your pension?\nContact: Sure, go on.\n...`}
                value={transcript}
                onChange={e => setTranscript(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Engine runs on this text. Leave blank to skip engine processing.
              </p>
            </div>

            {/* Summary */}
            <div className="space-y-1">
              <label className="text-sm font-medium">Summary (optional)</label>
              <Textarea
                className="text-xs min-h-[60px]"
                placeholder="Aircall-style AI summary (optional)"
                value={summary}
                onChange={e => setSummary(e.target.value)}
              />
            </div>

            <div className="flex items-center gap-2">
              <input
                id="ensureMem"
                type="checkbox"
                checked={ensureMembership}
                onChange={e => setEnsureMembership(e.target.checked)}
                className="h-4 w-4"
              />
              <label htmlFor="ensureMem" className="text-xs">
                Auto-add to Simulator list if no active membership (recommended)
              </label>
            </div>

            {submitError && (
              <p className="text-sm text-destructive">{submitError}</p>
            )}

            <div className="flex items-center gap-2 pt-2">
              <Button
                onClick={handleSubmit}
                disabled={submitting || !selectedContact || !agentId || !tag}
                className="gap-1.5"
              >
                {submitting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <PlayCircle className="w-3.5 h-3.5" />}
                Run Simulation
              </Button>
              {result && (
                <Button variant="outline" onClick={reset}>Clear result</Button>
              )}
            </div>
          </CardContent>
        </Card>

        {/* RIGHT: result panel */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              {result ? <CheckCircle2 className="w-4 h-4 text-green-600" /> : null}
              Simulation result
            </CardTitle>
          </CardHeader>
          <CardContent>
            {!result ? (
              <div className="text-sm text-muted-foreground py-6 text-center">
                Run a simulation to see the full state change.
              </div>
            ) : (
              <div className="space-y-3 text-xs">
                <div className="flex items-center gap-2">
                  <Badge variant="outline">call id</Badge>
                  <code className="truncate">{result.synthetic_call_id}</code>
                </div>

                <div>
                  <div className="font-semibold mb-1">Resolved</div>
                  <div className="bg-muted/40 border rounded px-3 py-2">
                    outcome=<code>{result.resolved.outcome}</code> · side_effect=<code>{result.resolved.side_effect}</code>
                  </div>
                </div>

                <div>
                  <div className="font-semibold mb-1">Webhook event sequence</div>
                  <div className="bg-muted/40 border rounded divide-y">
                    {result.events.map(e => (
                      <div key={e.event} className="px-3 py-2">
                        <div className="flex items-center gap-2 font-mono text-[11px]">
                          {e.error
                            ? <Badge variant="destructive" className="text-[9px]">error</Badge>
                            : e.result?.startsWith("skipped") || e.result?.startsWith("simulator:")
                              ? <Badge variant="outline" className="text-[9px]">skipped</Badge>
                              : <Badge variant="outline" className="bg-green-500/10 text-green-700 border-green-500/30 text-[9px]">processed</Badge>
                          }
                          <code>{e.event}</code>
                        </div>
                        <div className="text-muted-foreground mt-1 break-words">
                          {e.error || e.result || "—"}
                        </div>
                      </div>
                    ))}
                  </div>
                  <p className="text-[10px] text-muted-foreground mt-1">
                    Each event was processed by the real webhook handler and logged to <code>/webhook-log</code>.
                  </p>
                </div>

                {result.final.contact && (
                  <div>
                    <div className="font-semibold mb-1">Contact state</div>
                    <div className="bg-muted/40 border rounded px-3 py-2 space-y-0.5">
                      <div><code>dispatch_status</code>: {result.final.contact.dispatch_status || "—"}</div>
                      <div><code>last_call_outcome</code>: {result.final.contact.last_call_outcome || "—"}</div>
                      <div><code>call_attempts</code>: {result.final.contact.call_attempts ?? 0}</div>
                      {result.final.contact.callback_date && (
                        <div><code>callback_date</code>: {new Date(result.final.contact.callback_date).toLocaleString()}</div>
                      )}
                      {result.final.contact.cool_off_until && (
                        <div><code>cool_off_until</code>: {new Date(result.final.contact.cool_off_until).toLocaleString()}</div>
                      )}
                    </div>
                  </div>
                )}

                {result.final.conversation ? (
                  <div>
                    <div className="font-semibold mb-1">Conversation</div>
                    <div className="bg-muted/40 border rounded px-3 py-2 space-y-0.5">
                      <div><code>call_outcome</code>: {result.final.conversation.call_outcome || "—"}</div>
                      <div><code>processed_at</code>: {result.final.conversation.processed_at ? new Date(result.final.conversation.processed_at).toLocaleString() : "—"}</div>
                      <div><code>engine_version</code>: {result.final.conversation.engine_version || "—"}</div>
                      <div>has_transcript: {String(result.final.conversation.has_transcript)}</div>
                      <div>has_summary: {String(result.final.conversation.has_summary)}</div>
                      <div><code>tags</code>: {JSON.stringify(result.final.conversation.tags)}</div>
                    </div>
                  </div>
                ) : (
                  <div className="text-muted-foreground italic">
                    No conversation row was created — the call.ended handler probably rejected it (check the event results above).
                  </div>
                )}

                <div>
                  <div className="font-semibold mb-1">Memberships (most recent first)</div>
                  <div className="bg-muted/40 border rounded px-3 py-2 space-y-1">
                    {result.final.memberships.length === 0 ? (
                      <div className="text-muted-foreground">none</div>
                    ) : result.final.memberships.map(m => (
                      <div key={m.id} className="border-b last:border-0 pb-1">
                        added: {new Date(m.added_at).toLocaleString()}<br />
                        removed: {m.removed_at ? `${new Date(m.removed_at).toLocaleString()} (${m.removal_reason})` : "active"}
                        {m.outcome_at_removal && (
                          <> · outcome: {m.outcome_at_removal}</>
                        )}
                      </div>
                    ))}
                  </div>
                </div>

                {(result.created_simulator_list || result.created_simulator_membership) && (
                  <div className="text-[11px] text-muted-foreground italic">
                    Simulator {result.created_simulator_list ? "created a Simulator Test List + " : ""}
                    {result.created_simulator_membership ? "added a membership" : ""} to satisfy the tag transaction.
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
