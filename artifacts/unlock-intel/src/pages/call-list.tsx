import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Loader2, Phone, PhoneCall, PhoneOff, Users, Plus, Play, RefreshCw, ArrowRight, Clock, UserCheck, RotateCcw, Sparkles } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const API_BASE = (import.meta.env.BASE_URL?.replace(/\/$/, "") || "") + "/api";

type CallList = {
  id: string; name: string; daily_quota: number; active: boolean;
  assigned_agent_id: string | null; filter_criteria: any;
  total_dispatched: number; total_called: number; total_qualified: number;
  agent: { id: string; name: string } | null;
  created_at: string;
};

type QueueStatus = {
  callList_id: string; callList_name: string; daily_quota: number;
  callbacks_due: number; interested_followups: number; retry_eligible: number;
  already_dispatched_today: number; fresh_needed: number; total_queued: number;
};

type CallContact = {
  id: string; first_name: string; last_name: string; email: string | null;
  phone: string | null; company: string | null; call_attempts: number;
  last_call_outcome: string | null; callback_date: string | null;
  priority: string;
};

type Agent = { id: string; name: string; email: string | null; active: boolean };

export default function CallList() {
  const [callLists, setCallLists] = useState<CallList[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedCallList, setSelectedCallList] = useState<CallList | null>(null);
  const [queueStatus, setQueueStatus] = useState<QueueStatus | null>(null);
  const [callList, setCallList] = useState<CallContact[]>([]);
  const [listLoading, setListLoading] = useState(false);
  const [filling, setFilling] = useState(false);
  const [fillResult, setFillResult] = useState<any>(null);
  const [poolAvailable, setPoolAvailable] = useState<number | null>(null);
  const [sources, setSources] = useState<string[]>([]);

  // Create callList dialog
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newQuota, setNewQuota] = useState("100");
  const [newAgent, setNewAgent] = useState("");
  const [newSourceLists, setNewSourceLists] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);

  useEffect(() => { fetchCallLists(); fetchAgents(); fetchSources(); }, []);

  const fetchCallLists = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/call-lists`);
      const data = await res.json();
      setCallLists(data.call_lists || []);
    } catch {} finally { setLoading(false); }
  };

  const fetchAgents = async () => {
    try { const res = await fetch(`${API_BASE}/settings/agents`); const data = await res.json(); setAgents(data.agents || []); } catch {}
  };

  const fetchSources = async () => {
    try { const res = await fetch(`${API_BASE}/contacts/sources`); const data = await res.json(); setSources(data.sources || []); } catch {}
  };

  const selectCallList = async (callList: CallList) => {
    setSelectedCallList(callList);
    setFillResult(null);
    setListLoading(true);
    try {
      const [statusRes, listRes, poolRes] = await Promise.all([
        fetch(`${API_BASE}/call-lists/${callList.id}/queue-status`),
        fetch(`${API_BASE}/call-lists/${callList.id}/call-list`),
        fetch(`${API_BASE}/call-lists/${callList.id}/pool-count`),
      ]);
      setQueueStatus(await statusRes.json());
      const listData = await listRes.json();
      setCallList(listData.contacts || []);
      const poolData = await poolRes.json();
      setPoolAvailable(poolData.available);
    } catch {} finally { setListLoading(false); }
  };

  const handleFillQueue = async () => {
    if (!selectedCallList) return;
    setFilling(true); setFillResult(null);
    try {
      const res = await fetch(`${API_BASE}/call-lists/${selectedCallList.id}/fill-queue`, { method: "POST" });
      const data = await res.json();
      setFillResult(data);
      await selectCallList(selectedCallList);
    } catch {} finally { setFilling(false); }
  };

  const handleReconcile = async () => {
    try {
      const res = await fetch(`${API_BASE}/call-lists/reconcile`, { method: "POST" });
      const data = await res.json();
      if (selectedCallList) await selectCallList(selectedCallList);
      alert(`Reconciliation complete: ${data.reset_count} uncalled contacts returned to pool.`);
    } catch {}
  };

  const handleCreate = async () => {
    if (!newName.trim()) return;
    setCreating(true);
    try {
      const res = await fetch(`${API_BASE}/call-lists`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newName.trim(),
          daily_quota: parseInt(newQuota) || 100,
          assigned_agent_id: newAgent || null,
          filter_criteria: { source_lists: newSourceLists.length > 0 ? newSourceLists : undefined, exclude_outcomes: ["no-interest"] },
        }),
      });
      setCreateOpen(false); setNewName(""); setNewQuota("100"); setNewAgent(""); setNewSourceLists([]);
      await fetchCallLists();
    } catch {} finally { setCreating(false); }
  };

  const priorityBadge = (priority: string) => {
    switch (priority) {
      case "callback": return <Badge className="bg-orange-100 text-orange-700 border-orange-200"><Clock className="w-3 h-3 mr-1" /> Callback</Badge>;
      case "follow-up": return <Badge className="bg-green-100 text-green-700 border-green-200"><UserCheck className="w-3 h-3 mr-1" /> Follow-up</Badge>;
      case "retry": return <Badge className="bg-yellow-100 text-yellow-700 border-yellow-200"><RotateCcw className="w-3 h-3 mr-1" /> Retry</Badge>;
      default: return <Badge className="bg-blue-100 text-blue-700 border-blue-200"><Sparkles className="w-3 h-3 mr-1" /> Fresh</Badge>;
    }
  };

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Call List</h1>
          <p className="text-muted-foreground mt-1">Build and manage your daily call queue from the contact pool.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={handleReconcile}>
            <RefreshCw className="w-4 h-4 mr-1" /> Reconcile Yesterday
          </Button>
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="w-4 h-4 mr-1" /> New Call List
          </Button>
        </div>
      </div>

      <Tabs defaultValue="callLists">
        <TabsList>
          <TabsTrigger value="callLists"><Users className="w-4 h-4 mr-1" /> CallLists</TabsTrigger>
          <TabsTrigger value="queue" disabled={!selectedCallList}><PhoneCall className="w-4 h-4 mr-1" /> Today's Queue</TabsTrigger>
        </TabsList>

        {/* ===== CAMPAIGNS TAB ===== */}
        <TabsContent value="callLists" className="space-y-4">
          {loading ? (
            <Card><CardContent className="py-8 text-center"><Loader2 className="w-6 h-6 animate-spin mx-auto" /></CardContent></Card>
          ) : callLists.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center space-y-3">
                <Phone className="w-10 h-10 mx-auto text-muted-foreground opacity-50" />
                <p className="text-lg font-medium">No call lists yet</p>
                <p className="text-muted-foreground">Create a call list to start building call lists from your contact pool.</p>
                <Button onClick={() => setCreateOpen(true)}><Plus className="w-4 h-4 mr-1" /> Create Call List</Button>
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {callLists.map(c => (
                <Card key={c.id} className={`cursor-pointer transition-shadow hover:shadow-md ${selectedCallList?.id === c.id ? "ring-2 ring-primary" : ""}`}
                  onClick={() => selectCallList(c)}>
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-lg">{c.name}</CardTitle>
                      <Badge variant={c.active ? "default" : "secondary"}>{c.active ? "Active" : "Paused"}</Badge>
                    </div>
                    <CardDescription>
                      {c.agent ? `Assigned to ${c.agent.name}` : "Unassigned"} | Quota: {c.daily_quota}/day
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-3 gap-2 text-center">
                      <div>
                        <p className="text-xl font-bold">{c.total_dispatched}</p>
                        <p className="text-xs text-muted-foreground">Dispatched</p>
                      </div>
                      <div>
                        <p className="text-xl font-bold">{c.total_called}</p>
                        <p className="text-xs text-muted-foreground">Called</p>
                      </div>
                      <div>
                        <p className="text-xl font-bold">{c.total_qualified}</p>
                        <p className="text-xs text-muted-foreground">Qualified</p>
                      </div>
                    </div>
                    <Button variant="outline" size="sm" className="w-full mt-3" onClick={(e) => { e.stopPropagation(); selectCallList(c); }}>
                      View Queue <ArrowRight className="w-3 h-3 ml-1" />
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* ===== QUEUE TAB ===== */}
        <TabsContent value="queue" className="space-y-4">
          {selectedCallList && (
            <>
              {/* Queue status */}
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle>{selectedCallList.name}</CardTitle>
                      <CardDescription>Daily quota: {selectedCallList.daily_quota} calls | Pool available: {poolAvailable ?? "..."}</CardDescription>
                    </div>
                    <Button onClick={handleFillQueue} disabled={filling}>
                      {filling ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Play className="w-4 h-4 mr-2" />}
                      Fill Queue
                    </Button>
                  </div>
                </CardHeader>
                {queueStatus && (
                  <CardContent>
                    <div className="grid grid-cols-5 gap-3">
                      <div className="rounded-lg bg-orange-50 dark:bg-orange-950/20 p-3 text-center">
                        <p className="text-2xl font-bold text-orange-700 dark:text-orange-400">{queueStatus.callbacks_due}</p>
                        <p className="text-xs text-orange-600">Callbacks</p>
                      </div>
                      <div className="rounded-lg bg-green-50 dark:bg-green-950/20 p-3 text-center">
                        <p className="text-2xl font-bold text-green-700 dark:text-green-400">{queueStatus.interested_followups}</p>
                        <p className="text-xs text-green-600">Follow-ups</p>
                      </div>
                      <div className="rounded-lg bg-yellow-50 dark:bg-yellow-950/20 p-3 text-center">
                        <p className="text-2xl font-bold text-yellow-700 dark:text-yellow-400">{queueStatus.retry_eligible}</p>
                        <p className="text-xs text-yellow-600">Retries</p>
                      </div>
                      <div className="rounded-lg bg-blue-50 dark:bg-blue-950/20 p-3 text-center">
                        <p className="text-2xl font-bold text-blue-700 dark:text-blue-400">{queueStatus.already_dispatched_today}</p>
                        <p className="text-xs text-blue-600">Dispatched</p>
                      </div>
                      <div className="rounded-lg bg-slate-50 dark:bg-slate-950/20 p-3 text-center">
                        <p className="text-2xl font-bold text-slate-700 dark:text-slate-400">{queueStatus.fresh_needed}</p>
                        <p className="text-xs text-slate-500">Needed</p>
                      </div>
                    </div>
                  </CardContent>
                )}
              </Card>

              {/* Fill result */}
              {fillResult && (
                <Card className="border-green-500">
                  <CardContent className="pt-4">
                    <div className="flex items-center gap-2 text-sm">
                      <PhoneCall className="w-4 h-4 text-green-600" />
                      <span className="font-medium">{fillResult.dispatched} contacts dispatched:</span>
                      <span>{fillResult.callbacks} callbacks, {fillResult.interested} follow-ups, {fillResult.retries} retries, {fillResult.fresh} fresh</span>
                      {fillResult.errors > 0 && <span className="text-destructive">({fillResult.errors} errors)</span>}
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Call list table */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Phone className="w-5 h-5" /> Today's Call List ({callList.length})
                  </CardTitle>
                  <CardDescription>Contacts are ordered by priority: callbacks first, then follow-ups, retries, and fresh contacts.</CardDescription>
                </CardHeader>
                <CardContent>
                  {listLoading ? (
                    <div className="py-8 text-center"><Loader2 className="w-6 h-6 animate-spin mx-auto" /></div>
                  ) : callList.length === 0 ? (
                    <div className="py-8 text-center text-muted-foreground">
                      <PhoneOff className="w-8 h-8 mx-auto mb-2 opacity-50" />
                      <p>No contacts in today's queue. Click "Fill Queue" to dispatch contacts.</p>
                    </div>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-8">#</TableHead>
                          <TableHead>Name</TableHead>
                          <TableHead>Phone</TableHead>
                          <TableHead>Company</TableHead>
                          <TableHead>Priority</TableHead>
                          <TableHead>Attempts</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {callList.map((contact, i) => (
                          <TableRow key={contact.id}>
                            <TableCell className="text-muted-foreground font-mono text-xs">{i + 1}</TableCell>
                            <TableCell className="font-medium">{contact.first_name} {contact.last_name}</TableCell>
                            <TableCell className="font-mono text-sm">{contact.phone || "No phone"}</TableCell>
                            <TableCell className="text-sm">{contact.company || "—"}</TableCell>
                            <TableCell>{priorityBadge(contact.priority)}</TableCell>
                            <TableCell className="text-center">{contact.call_attempts}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </CardContent>
              </Card>
            </>
          )}

          {!selectedCallList && (
            <Card>
              <CardContent className="py-12 text-center text-muted-foreground">
                <Phone className="w-8 h-8 mx-auto mb-3 opacity-50" />
                <p>Select a callList from the CallLists tab to see its call queue.</p>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>

      {/* Create Call List Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Create Call List</DialogTitle>
            <DialogDescription>Define a callList to dispatch contacts from your pool to the call queue.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1">
              <label className="text-sm font-medium">Call List Name <span className="text-destructive">*</span></label>
              <Input value={newName} onChange={e => setNewName(e.target.value)} placeholder="e.g. London HNW Wave 1" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <label className="text-sm font-medium">Daily Quota</label>
                <Input type="number" value={newQuota} onChange={e => setNewQuota(e.target.value)} />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium">Assigned Agent</label>
                <Select value={newAgent} onValueChange={setNewAgent}>
                  <SelectTrigger><SelectValue placeholder="Select agent..." /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">Unassigned</SelectItem>
                    {agents.filter(a => a.active).map(a => (
                      <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">Source Lists (filter contacts from these lists)</label>
              <div className="flex flex-wrap gap-2">
                {sources.map(s => (
                  <Badge key={s} variant={newSourceLists.includes(s) ? "default" : "outline"}
                    className="cursor-pointer"
                    onClick={() => setNewSourceLists(prev =>
                      prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s]
                    )}>
                    {s}
                  </Badge>
                ))}
                {sources.length === 0 && <p className="text-sm text-muted-foreground">No contact lists uploaded yet.</p>}
              </div>
              <p className="text-xs text-muted-foreground">Leave empty to draw from all available contacts.</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button onClick={handleCreate} disabled={creating || !newName.trim()}>
              {creating && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Create Call List
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
