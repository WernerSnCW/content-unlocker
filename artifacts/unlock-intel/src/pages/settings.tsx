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

  // Tag mapping
  interface TagMapping { aircall_tag: string; outcome: string; side_effect: string | null; }
  const OUTCOMES = ["interested", "no-interest", "no-answer", "callback-requested", "meeting-booked", "not-now"];
  const SIDE_EFFECTS = [
    { value: "", label: "None" },
    { value: "cool_off", label: "Cool-off (28 days)" },
    { value: "callback", label: "Schedule callback (+1 day)" },
  ];
  const [tagMappings, setTagMappings] = useState<TagMapping[]>([
    { aircall_tag: "interested", outcome: "interested", side_effect: null },
    { aircall_tag: "no-interest", outcome: "no-interest", side_effect: null },
    { aircall_tag: "no-answer", outcome: "no-answer", side_effect: "cool_off" },
    { aircall_tag: "callback", outcome: "callback-requested", side_effect: "callback" },
    { aircall_tag: "meeting-booked", outcome: "meeting-booked", side_effect: null },
    { aircall_tag: "not-now", outcome: "not-now", side_effect: null },
  ]);

  // Webhook URL
  const webhookUrl = `${window.location.origin}/api/aircall/webhook`;

  // Load Aircall config on mount
  useEffect(() => {
    fetchAircallConfig();
    fetchAgents();
  }, []);

  const fetchAircallConfig = async () => {
    setAircallLoading(true);
    try {
      const res = await fetch(`${API_BASE}/settings/integrations/aircall`);
      const data = await res.json();
      if (data.integration?.exists) {
        const cfg = data.integration.config;
        setAircallApiId(cfg.api_id || "");
        setAircallApiToken(cfg.api_token || "");
        setAircallWebhookToken(cfg.webhook_token || "");
        setTranscriptionMode(cfg.transcription_mode || "ai_assist");
        setTranscriptionApiKey(cfg.transcription_api_key || "");
        setAircallEnabled(data.integration.enabled);
        if (cfg.tag_mapping && Array.isArray(cfg.tag_mapping) && cfg.tag_mapping.length > 0) {
          setTagMappings(cfg.tag_mapping);
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
      await fetch(`${API_BASE}/settings/integrations/aircall`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          config: {
            api_id: aircallApiId,
            api_token: aircallApiToken,
            webhook_token: aircallWebhookToken,
            webhook_url: webhookUrl,
            transcription_mode: transcriptionMode,
            ...(transcriptionMode === "external" ? { transcription_api_key: transcriptionApiKey } : {}),
            tag_mapping: tagMappings,
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

  const fetchAircallUsers = async () => {
    setUsersLoading(true);
    try {
      const res = await fetch(`${API_BASE}/settings/integrations/aircall/users`);
      const data = await res.json();
      setAircallUsers(data.users || []);
    } catch { /* ignore */ }
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
                      <label className="text-sm font-medium">API Token</label>
                      <Input type="password" value={aircallApiToken} onChange={e => setAircallApiToken(e.target.value)} placeholder="Your Aircall API Token" />
                    </div>
                  </div>

                  <div className="space-y-1">
                    <label className="text-sm font-medium">Webhook Verification Token</label>
                    <Input value={aircallWebhookToken} onChange={e => setAircallWebhookToken(e.target.value)} placeholder="Token for verifying Aircall webhook requests" />
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
                        <label className="text-sm font-medium">Transcription API Key</label>
                        <Input type="password" value={transcriptionApiKey} onChange={e => setTranscriptionApiKey(e.target.value)} placeholder="Whisper or Deepgram API key" />
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

          {/* Tag Mapping */}
          <Card>
            <CardHeader>
              <CardTitle>Tag Mapping</CardTitle>
              <CardDescription>Map Aircall call tags to contact outcomes. These are used when webhook events arrive.</CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Aircall Tag</TableHead>
                    <TableHead>Maps to Outcome</TableHead>
                    <TableHead>Side Effect</TableHead>
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
                            const updated = [...tagMappings];
                            updated[i] = { ...updated[i], outcome: val };
                            setTagMappings(updated);
                          }}>
                          <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {OUTCOMES.map(o => <SelectItem key={o} value={o}>{o}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell>
                        <Select
                          value={mapping.side_effect || ""}
                          onValueChange={val => {
                            const updated = [...tagMappings];
                            updated[i] = { ...updated[i], side_effect: val || null };
                            setTagMappings(updated);
                          }}>
                          <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {SIDE_EFFECTS.map(s => <SelectItem key={s.value || "__none__"} value={s.value || "__none__"}>{s.label}</SelectItem>)}
                          </SelectContent>
                        </Select>
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
                <Button variant="outline" size="sm" onClick={() => setTagMappings(prev => [...prev, { aircall_tag: "", outcome: "no-answer", side_effect: null }])}>
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
                    <Input value={newAgentAircallId} onChange={e => setNewAgentAircallId(e.target.value)} placeholder="Aircall user ID (fetch users first)" />
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
