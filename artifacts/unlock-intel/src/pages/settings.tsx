import { useState, useEffect } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Loader2, CheckCircle, XCircle, Plus, Trash2, Copy, RefreshCw } from "lucide-react";

const API_BASE = (import.meta.env.BASE_URL?.replace(/\/$/, "") || "") + "/api";

interface AircallUser {
  id: number;
  name: string;
  email: string;
  available: boolean;
}

interface Agent {
  id: string;
  name: string;
  email: string | null;
  aircall_user_id: number | null;
  active: boolean;
}

export default function Settings() {
  // Aircall config state
  const [aircallApiId, setAircallApiId] = useState("");
  const [aircallApiToken, setAircallApiToken] = useState("");
  const [aircallWebhookToken, setAircallWebhookToken] = useState("");
  const [transcriptionMode, setTranscriptionMode] = useState("ai_assist");
  const [transcriptionApiKey, setTranscriptionApiKey] = useState("");
  const [aircallEnabled, setAircallEnabled] = useState(false);
  const [aircallSaving, setAircallSaving] = useState(false);
  const [aircallLoading, setAircallLoading] = useState(true);

  // Connection test
  const [testStatus, setTestStatus] = useState<"idle" | "testing" | "success" | "failed">("idle");
  const [testMessage, setTestMessage] = useState("");

  // Aircall users
  const [aircallUsers, setAircallUsers] = useState<AircallUser[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);

  // Agents
  const [agents, setAgents] = useState<Agent[]>([]);
  const [agentsLoading, setAgentsLoading] = useState(true);
  const [addAgentOpen, setAddAgentOpen] = useState(false);
  const [newAgentName, setNewAgentName] = useState("");
  const [newAgentEmail, setNewAgentEmail] = useState("");
  const [newAgentAircallId, setNewAgentAircallId] = useState<string>("");
  const [addingAgent, setAddingAgent] = useState(false);

  // Tag mapping — canonical model, see docs/decisions/001-tag-outcome-side-effect-model.md
  type Outcome =
    | "interested" | "no-interest" | "no-answer" | "callback-requested"
    | "meeting-booked" | "hung-up" | "do-not-call" | "does-not-exist";
  type SideEffect =
    | "none" | "cool_off" | "immediate_recall"
    | "callback_1d" | "callback_2d" | "callback_3d" | "callback_7d"
    | "exclude_from_campaign" | "global_exclude";
  interface TagMapping {
    aircall_tag: string;
    outcome: Outcome;
    side_effect: SideEffect;
    // Only meaningful when side_effect === "cool_off". Null/undefined = use global.
    cool_off_days?: number | null;
  }

  const OUTCOMES: Outcome[] = [
    "interested", "no-interest", "no-answer", "callback-requested",
    "meeting-booked", "hung-up", "do-not-call", "does-not-exist",
  ];
  const OUTCOME_LABELS: Record<Outcome, string> = {
    "interested": "Interested",
    "no-interest": "Not interested",
    "no-answer": "No answer",
    "callback-requested": "Callback requested",
    "meeting-booked": "Meeting booked",
    "hung-up": "Hung up",
    "do-not-call": "Do not call",
    "does-not-exist": "Number does not exist",
  };
  const SIDE_EFFECT_LABELS: Record<SideEffect, string> = {
    "none": "None — engine decides next step",
    "cool_off": "Cool-off for N days",
    "immediate_recall": "Immediate recall (bottom of today's queue)",
    "callback_1d": "Callback in 1 day",
    "callback_2d": "Callback in 2 days",
    "callback_3d": "Callback in 3 days",
    "callback_7d": "Callback in 7 days",
    "exclude_from_campaign": "Exclude from this campaign",
    "global_exclude": "Archive — never call again",
  };
  const ALLOWED_SIDE_EFFECTS: Record<Outcome, SideEffect[]> = {
    "interested": ["none"],
    "no-interest": ["exclude_from_campaign", "cool_off", "none"],
    "no-answer": ["cool_off", "immediate_recall", "none"],
    "callback-requested": ["callback_1d", "callback_2d", "callback_3d", "callback_7d"],
    "meeting-booked": ["none"],
    "hung-up": ["cool_off", "immediate_recall", "none"],
    "do-not-call": ["global_exclude"],
    "does-not-exist": ["global_exclude"],
  };

  const [tagMappings, setTagMappings] = useState<TagMapping[]>([
    { aircall_tag: "Cloudworkz", outcome: "interested", side_effect: "none" },
    { aircall_tag: "Not Interested", outcome: "no-interest", side_effect: "exclude_from_campaign" },
    { aircall_tag: "No Answer", outcome: "no-answer", side_effect: "immediate_recall" },
    { aircall_tag: "Callbacks", outcome: "callback-requested", side_effect: "callback_1d" },
    { aircall_tag: "DNC", outcome: "do-not-call", side_effect: "global_exclude" },
    { aircall_tag: "demo", outcome: "meeting-booked", side_effect: "none" },
    { aircall_tag: "Hung Up", outcome: "hung-up", side_effect: "cool_off" },
    { aircall_tag: "DNE", outcome: "does-not-exist", side_effect: "global_exclude" },
  ]);
  const [maxCallAttempts, setMaxCallAttempts] = useState<number>(3);
  const [coolOffDays, setCoolOffDays] = useState<number>(28);

  // Webhook URL
  const webhookUrl = `${window.location.origin}/api/aircall/webhook`;

  // Load Aircall config on mount
  useEffect(() => {
    fetchAircallConfig();
    fetchAgents();
  }, []);

  // Track whether credentials are stored so we can show "set / not set" badges
  // without ever displaying the masked value in the input itself.
  const [tokenIsSet, setTokenIsSet] = useState(false);
  const [tokenLast4, setTokenLast4] = useState<string | null>(null);
  const [webhookTokenIsSet, setWebhookTokenIsSet] = useState(false);
  const [transcriptionKeyIsSet, setTranscriptionKeyIsSet] = useState(false);

  const fetchAircallConfig = async () => {
    setAircallLoading(true);
    try {
      const res = await fetch(`${API_BASE}/settings/integrations/aircall`);
      const data = await res.json();
      if (data.integration?.exists) {
        const cfg = data.integration.config;
        setAircallApiId(cfg.api_id || "");
        // CRITICAL: do NOT load the masked token into the form state.
        // If we did, saving the form would overwrite the real token in the DB
        // with the "****abc1" placeholder, breaking authentication silently.
        // Instead, leave the input empty and show a "set" badge.
        setAircallApiToken("");
        setTokenIsSet(typeof cfg.api_token === "string" && cfg.api_token.length > 0);
        setTokenLast4(typeof cfg.api_token === "string" && cfg.api_token.startsWith("****")
          ? cfg.api_token.slice(-4) : null);
        setAircallWebhookToken("");
        setWebhookTokenIsSet(typeof cfg.webhook_token === "string" && cfg.webhook_token.length > 0);
        setTranscriptionMode(cfg.transcription_mode || "ai_assist");
        setTranscriptionApiKey("");
        setTranscriptionKeyIsSet(typeof cfg.transcription_api_key === "string" && cfg.transcription_api_key.length > 0);
        setAircallEnabled(data.integration.enabled);
        if (cfg.tag_mapping && Array.isArray(cfg.tag_mapping) && cfg.tag_mapping.length > 0) {
          setTagMappings(cfg.tag_mapping);
        }
        if (Number.isFinite(Number(cfg.max_call_attempts))) {
          setMaxCallAttempts(Number(cfg.max_call_attempts));
        }
        if (Number.isFinite(Number(cfg.cool_off_days))) {
          setCoolOffDays(Number(cfg.cool_off_days));
        }
      }
    } catch { /* ignore */ }
    finally { setAircallLoading(false); }
  };

  const fetchAgents = async () => {
    setAgentsLoading(true);
    try {
      const res = await fetch(`${API_BASE}/settings/agents`);
      const data = await res.json();
      setAgents(data.agents || []);
    } catch { /* ignore */ }
    finally { setAgentsLoading(false); }
  };

  const saveAircallConfig = async () => {
    setAircallSaving(true);
    try {
      // Only include sensitive fields if the user actually entered a new value.
      // Empty string means "leave existing alone" — backend already strips
      // masked values defensively as well.
      const sensitiveFields: Record<string, string> = {};
      if (aircallApiToken.trim()) sensitiveFields.api_token = aircallApiToken.trim();
      if (aircallWebhookToken.trim()) sensitiveFields.webhook_token = aircallWebhookToken.trim();
      if (transcriptionMode === "external" && transcriptionApiKey.trim()) {
        sensitiveFields.transcription_api_key = transcriptionApiKey.trim();
      }

      await fetch(`${API_BASE}/settings/integrations/aircall`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          config: {
            api_id: aircallApiId,
            ...sensitiveFields,
            webhook_url: webhookUrl,
            transcription_mode: transcriptionMode,
            tag_mapping: tagMappings,
            max_call_attempts: maxCallAttempts,
            cool_off_days: coolOffDays,
          },
          enabled: aircallEnabled,
        }),
      });
      await fetchAircallConfig();
    } catch { /* ignore */ }
    finally { setAircallSaving(false); }
  };

  const testConnection = async () => {
    setTestStatus("testing");
    setTestMessage("");
    try {
      const res = await fetch(`${API_BASE}/settings/integrations/aircall/test-connection`, { method: "POST" });
      const data = await res.json();
      if (data.success) {
        setTestStatus("success");
        setTestMessage(`Connected to ${data.company}`);
      } else {
        setTestStatus("failed");
        setTestMessage(data.error || "Connection failed");
      }
    } catch (err: any) {
      setTestStatus("failed");
      setTestMessage(err.message);
    }
  };

  const [aircallUsersError, setAircallUsersError] = useState<string | null>(null);

  const fetchAircallUsers = async () => {
    setUsersLoading(true);
    setAircallUsersError(null);
    try {
      const res = await fetch(`${API_BASE}/settings/integrations/aircall/users`);
      const data = await res.json();
      if (!res.ok) {
        const bits: string[] = [];
        if (data.aircall_status) bits.push(`HTTP ${data.aircall_status}`);
        if (data.api_id_prefix) bits.push(`key ${data.api_id_prefix}`);
        if (data.hint) bits.push(data.hint);
        if (data.aircall_body) bits.push(`Aircall: ${data.aircall_body}`);
        setAircallUsersError(bits.join(" · "));
        setAircallUsers([]);
      } else {
        setAircallUsers(data.users || []);
      }
    } catch (err: any) {
      setAircallUsersError(err.message || "Failed to fetch");
    }
    finally { setUsersLoading(false); }
  };

  const addAgent = async () => {
    if (!newAgentName.trim()) return;
    setAddingAgent(true);
    try {
      await fetch(`${API_BASE}/settings/agents`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newAgentName.trim(),
          email: newAgentEmail.trim() || null,
          aircall_user_id: newAgentAircallId ? parseInt(newAgentAircallId) : null,
        }),
      });
      setNewAgentName("");
      setNewAgentEmail("");
      setNewAgentAircallId("");
      setAddAgentOpen(false);
      await fetchAgents();
    } catch { /* ignore */ }
    finally { setAddingAgent(false); }
  };

  const deleteAgent = async (id: string) => {
    try {
      await fetch(`${API_BASE}/settings/agents/${id}`, { method: "DELETE" });
      await fetchAgents();
    } catch { /* ignore */ }
  };

  const toggleAgent = async (id: string, active: boolean) => {
    try {
      await fetch(`${API_BASE}/settings/agents/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: !active }),
      });
      await fetchAgents();
    } catch { /* ignore */ }
  };

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Integration Settings</h1>
        <p className="text-muted-foreground mt-1">Configure external service connections and agent mappings.</p>
      </div>

      <Tabs defaultValue="aircall">
        <TabsList>
          <TabsTrigger value="aircall">Aircall</TabsTrigger>
          <TabsTrigger value="agents">Agents</TabsTrigger>
          <TabsTrigger value="pipedrive" disabled>Pipedrive</TabsTrigger>
          <TabsTrigger value="fireflies" disabled>Fireflies</TabsTrigger>
          <TabsTrigger value="calendar" disabled>Calendar</TabsTrigger>
        </TabsList>

        {/* ===== AIRCALL TAB ===== */}
        <TabsContent value="aircall" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                Aircall Configuration
                {aircallEnabled && <Badge variant="default">Enabled</Badge>}
                {!aircallEnabled && <Badge variant="secondary">Disabled</Badge>}
              </CardTitle>
              <CardDescription>Connect to Aircall for call tracking, outcomes, and transcripts.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {aircallLoading ? (
                <div className="flex items-center gap-2 text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" /> Loading...</div>
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <label className="text-sm font-medium">API ID</label>
                      <Input value={aircallApiId} onChange={e => setAircallApiId(e.target.value)} placeholder="Your Aircall API ID" />
                    </div>
                    <div className="space-y-1">
                      <label className="text-sm font-medium flex items-center gap-2">
                        API Token
                        {tokenIsSet && (
                          <Badge variant="outline" className="text-xs h-5 font-normal">
                            Set{tokenLast4 ? ` · ends ${tokenLast4}` : ""}
                          </Badge>
                        )}
                      </label>
                      <Input
                        type="password"
                        value={aircallApiToken}
                        onChange={e => setAircallApiToken(e.target.value)}
                        placeholder={tokenIsSet ? "Leave blank to keep existing token" : "Paste your Aircall API token"}
                      />
                    </div>
                  </div>

                  <div className="space-y-1">
                    <label className="text-sm font-medium flex items-center gap-2">
                      Webhook Verification Token
                      {webhookTokenIsSet && <Badge variant="outline" className="text-xs h-5 font-normal">Set</Badge>}
                    </label>
                    <Input
                      type="password"
                      value={aircallWebhookToken}
                      onChange={e => setAircallWebhookToken(e.target.value)}
                      placeholder={webhookTokenIsSet ? "Leave blank to keep existing token" : "Token for verifying Aircall webhook requests"}
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-sm font-medium">Webhook URL</label>
                    <div className="flex gap-2">
                      <Input value={webhookUrl} readOnly className="bg-muted" />
                      <Button variant="outline" size="icon" onClick={() => navigator.clipboard.writeText(webhookUrl)}>
                        <Copy className="w-4 h-4" />
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground">Register this URL in your Aircall dashboard under Webhooks.</p>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <label className="text-sm font-medium">Transcription Mode</label>
                      <Select value={transcriptionMode} onValueChange={setTranscriptionMode}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="ai_assist">AI Assist (Aircall built-in)</SelectItem>
                          <SelectItem value="external">External (Whisper/Deepgram)</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    {transcriptionMode === "external" && (
                      <div className="space-y-1">
                        <label className="text-sm font-medium flex items-center gap-2">
                          Transcription API Key
                          {transcriptionKeyIsSet && <Badge variant="outline" className="text-xs h-5 font-normal">Set</Badge>}
                        </label>
                        <Input
                          type="password"
                          value={transcriptionApiKey}
                          onChange={e => setTranscriptionApiKey(e.target.value)}
                          placeholder={transcriptionKeyIsSet ? "Leave blank to keep existing key" : "Whisper or Deepgram API key"}
                        />
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-4 pt-2">
                    <Button onClick={saveAircallConfig} disabled={aircallSaving}>
                      {aircallSaving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                      Save Configuration
                    </Button>
                    <Button variant="outline" onClick={testConnection} disabled={testStatus === "testing"}>
                      {testStatus === "testing" && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                      Test Connection
                    </Button>
                    {testStatus === "success" && (
                      <span className="flex items-center gap-1 text-sm text-green-600">
                        <CheckCircle className="w-4 h-4" /> {testMessage}
                      </span>
                    )}
                    {testStatus === "failed" && (
                      <span className="flex items-center gap-1 text-sm text-destructive">
                        <XCircle className="w-4 h-4" /> {testMessage}
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-2 pt-2">
                    <label className="text-sm font-medium">Integration Enabled</label>
                    <Button
                      variant={aircallEnabled ? "default" : "outline"}
                      size="sm"
                      onClick={() => setAircallEnabled(!aircallEnabled)}
                    >
                      {aircallEnabled ? "Enabled" : "Disabled"}
                    </Button>
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          {/* Pool rules */}
          <Card>
            <CardHeader>
              <CardTitle>Pool Rules</CardTitle>
              <CardDescription>Controls how contacts flow back into future call lists.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-3">
                <label className="text-sm font-medium w-48">Max call attempts</label>
                <Input
                  type="number"
                  min={1}
                  max={20}
                  value={maxCallAttempts}
                  onChange={e => setMaxCallAttempts(Math.max(1, Math.min(20, parseInt(e.target.value) || 1)))}
                  className="h-8 w-24"
                />
                <p className="text-xs text-muted-foreground">
                  Upper limit on automatic retry dispatches per contact. Immediate recalls do not count.
                </p>
              </div>
              <div className="flex items-center gap-3">
                <label className="text-sm font-medium w-48">Cool-off period (days)</label>
                <Input
                  type="number"
                  min={1}
                  max={365}
                  value={coolOffDays}
                  onChange={e => setCoolOffDays(Math.max(1, Math.min(365, parseInt(e.target.value) || 1)))}
                  className="h-8 w-24"
                />
                <p className="text-xs text-muted-foreground">
                  Global default. Individual tag mappings can override this below.
                </p>
              </div>
            </CardContent>
          </Card>

          {/* Tag Mapping */}
          <Card>
            <CardHeader>
              <CardTitle>Tag Mapping</CardTitle>
              <CardDescription>
                Map Aircall call tags to canonical outcomes and side-effects.
                Side-effect options are constrained to valid combinations per
                <a href="/docs/decisions/001-tag-outcome-side-effect-model.md" className="underline mx-1">ADR 001</a>.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Aircall Tag</TableHead>
                    <TableHead>Maps to Outcome</TableHead>
                    <TableHead>Side Effect</TableHead>
                    <TableHead className="w-28">Cool-off (days)</TableHead>
                    <TableHead className="w-10"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {tagMappings.map((mapping, i) => (
                    <TableRow key={i}>
                      <TableCell>
                        <Input
                          value={mapping.aircall_tag}
                          onChange={e => {
                            const updated = [...tagMappings];
                            updated[i] = { ...updated[i], aircall_tag: e.target.value };
                            setTagMappings(updated);
                          }}
                          placeholder="e.g. interested"
                          className="h-8"
                        />
                      </TableCell>
                      <TableCell>
                        <Select
                          value={mapping.outcome}
                          onValueChange={val => {
                            const nextOutcome = val as Outcome;
                            const allowed = ALLOWED_SIDE_EFFECTS[nextOutcome];
                            // If the current side_effect is no longer valid, reset to the first allowed.
                            const nextSide = allowed.includes(mapping.side_effect) ? mapping.side_effect : allowed[0];
                            const updated = [...tagMappings];
                            updated[i] = { ...updated[i], outcome: nextOutcome, side_effect: nextSide };
                            setTagMappings(updated);
                          }}>
                          <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {OUTCOMES.map(o => <SelectItem key={o} value={o}>{OUTCOME_LABELS[o]}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell>
                        <Select
                          value={mapping.side_effect}
                          onValueChange={val => {
                            const updated = [...tagMappings];
                            updated[i] = { ...updated[i], side_effect: val as SideEffect };
                            setTagMappings(updated);
                          }}
                          disabled={ALLOWED_SIDE_EFFECTS[mapping.outcome].length <= 1}>
                          <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {ALLOWED_SIDE_EFFECTS[mapping.outcome].map(s =>
                              <SelectItem key={s} value={s}>{SIDE_EFFECT_LABELS[s]}</SelectItem>
                            )}
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell>
                        {mapping.side_effect === "cool_off" ? (
                          <Input
                            type="number"
                            min={1}
                            max={365}
                            placeholder={String(coolOffDays)}
                            value={mapping.cool_off_days ?? ""}
                            onChange={e => {
                              const v = e.target.value;
                              const updated = [...tagMappings];
                              updated[i] = { ...updated[i], cool_off_days: v === "" ? null : Math.max(1, Math.min(365, parseInt(v) || 1)) };
                              setTagMappings(updated);
                            }}
                            className="h-8"
                          />
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive"
                          onClick={() => setTagMappings(prev => prev.filter((_, idx) => idx !== i))}>
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <div className="flex items-center gap-2 mt-3">
                <Button variant="outline" size="sm" onClick={() => setTagMappings(prev => [...prev, { aircall_tag: "", outcome: "no-answer", side_effect: "cool_off" }])}>
                  <Plus className="w-4 h-4 mr-1" /> Add Mapping
                </Button>
                <Button size="sm" onClick={saveAircallConfig} disabled={aircallSaving}>
                  {aircallSaving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                  Save Mappings
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ===== AGENTS TAB ===== */}
        <TabsContent value="agents" className="space-y-4">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>Agent Management</CardTitle>
                  <CardDescription>Map team members to Aircall users for call attribution.</CardDescription>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={fetchAircallUsers} disabled={usersLoading}>
                    <RefreshCw className={`w-4 h-4 mr-1 ${usersLoading ? "animate-spin" : ""}`} />
                    Fetch Aircall Users
                  </Button>
                  <Button size="sm" onClick={() => setAddAgentOpen(true)}>
                    <Plus className="w-4 h-4 mr-1" /> Add Agent
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {aircallUsersError && (
                <div className="mb-3 p-3 border border-destructive/40 bg-destructive/5 rounded text-xs text-destructive">
                  <div className="font-medium mb-1">Fetch Aircall Users failed</div>
                  <div className="whitespace-pre-wrap break-all">{aircallUsersError}</div>
                </div>
              )}
              {agentsLoading ? (
                <div className="flex items-center gap-2 text-muted-foreground py-4"><Loader2 className="w-4 h-4 animate-spin" /> Loading...</div>
              ) : agents.length === 0 ? (
                <p className="text-muted-foreground py-4 text-center">No agents configured. Add an agent to get started.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Email</TableHead>
                      <TableHead>Aircall User</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {agents.map(agent => (
                      <TableRow key={agent.id}>
                        <TableCell className="font-medium">{agent.name}</TableCell>
                        <TableCell>{agent.email || "—"}</TableCell>
                        <TableCell>
                          {agent.aircall_user_id ? (
                            <Badge variant="outline">ID: {agent.aircall_user_id}</Badge>
                          ) : (
                            <span className="text-muted-foreground">Not mapped</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <Badge variant={agent.active ? "default" : "secondary"}>
                            {agent.active ? "Active" : "Inactive"}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-2">
                            <Button variant="ghost" size="sm" onClick={() => toggleAgent(agent.id, agent.active)}>
                              {agent.active ? "Deactivate" : "Activate"}
                            </Button>
                            <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive" onClick={() => deleteAgent(agent.id)}>
                              <Trash2 className="w-3.5 h-3.5" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}

              {aircallUsers.length > 0 && (
                <div className="mt-4 border-t pt-4">
                  <h4 className="text-sm font-medium mb-2">Available Aircall Users</h4>
                  <div className="grid grid-cols-2 gap-2">
                    {aircallUsers.map(u => (
                      <div key={u.id} className="flex items-center justify-between p-2 rounded border text-sm">
                        <div>
                          <span className="font-medium">{u.name}</span>
                          <span className="text-muted-foreground ml-2">{u.email}</span>
                        </div>
                        <Badge variant={u.available ? "default" : "secondary"} className="text-xs">
                          {u.available ? "Available" : "Unavailable"}
                        </Badge>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Add Agent Dialog */}
          <Dialog open={addAgentOpen} onOpenChange={setAddAgentOpen}>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>Add Agent</DialogTitle>
              </DialogHeader>
              <div className="space-y-3 py-2">
                <div className="space-y-1">
                  <label className="text-sm font-medium">Name <span className="text-destructive">*</span></label>
                  <Input value={newAgentName} onChange={e => setNewAgentName(e.target.value)} placeholder="Agent name" />
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium">Email</label>
                  <Input value={newAgentEmail} onChange={e => setNewAgentEmail(e.target.value)} placeholder="agent@company.com" />
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium">Aircall User ID</label>
                  {aircallUsers.length > 0 ? (
                    <Select value={newAgentAircallId} onValueChange={setNewAgentAircallId}>
                      <SelectTrigger><SelectValue placeholder="Select Aircall user..." /></SelectTrigger>
                      <SelectContent>
                        {aircallUsers.map(u => (
                          <SelectItem key={u.id} value={String(u.id)}>{u.name} ({u.email})</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <Input value={newAgentAircallId} onChange={e => setNewAgentAircallId(e.target.value)} placeholder="Numeric Aircall user ID (e.g. 1543884)" />
                  )}
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setAddAgentOpen(false)}>Cancel</Button>
                <Button onClick={addAgent} disabled={addingAgent || !newAgentName.trim()}>
                  {addingAgent && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                  Add Agent
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </TabsContent>

        {/* Placeholder tabs */}
        <TabsContent value="pipedrive">
          <Card><CardContent className="py-8 text-center text-muted-foreground">Pipedrive integration will be configured in Phase 1.</CardContent></Card>
        </TabsContent>
        <TabsContent value="fireflies">
          <Card><CardContent className="py-8 text-center text-muted-foreground">Fireflies integration coming in Phase 2.</CardContent></Card>
        </TabsContent>
        <TabsContent value="calendar">
          <Card><CardContent className="py-8 text-center text-muted-foreground">Google Calendar integration coming in Phase 2.</CardContent></Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
