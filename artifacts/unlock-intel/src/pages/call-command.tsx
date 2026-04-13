import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Link } from "wouter";
import {
  Phone, PhoneCall, PhoneOff, PhoneMissed, CalendarClock, UserPlus,
  ArrowRight, Clock, Upload, CheckCircle, XCircle, Calendar,
  ListPlus, TrendingUp, Headphones, ExternalLink, Settings,
  User, Building2, Mail, MailWarning,
  Loader2
} from "lucide-react";
import { useAircallPhone } from "@/hooks/use-aircall-phone";

const API_BASE = (import.meta.env.BASE_URL?.replace(/\/$/, "") || "") + "/api";

interface CallContact {
  id: string; first_name: string; last_name: string; email: string | null;
  phone: string | null; company: string | null; call_attempts: number;
  last_call_outcome: string | null; priority: string;
}

interface CallListDef {
  id: string; name: string; daily_quota: number; active: boolean;
}

interface Agent {
  id: string; name: string; email: string | null; active: boolean;
}

export default function CallCommand() {
  const [poolAvailable, setPoolAvailable] = useState(0);
  const [callList, setCallList] = useState<CallContact[]>([]);
  const [todayOutcomes, setTodayOutcomes] = useState<{ total: number; outcomes: Record<string, number> }>({ total: 0, outcomes: {} });
  const [callListDefs, setCallListDefs] = useState<CallListDef[]>([]);
  const [activeCallListDef, setActiveCallListDef] = useState<CallListDef | null>(null);
  const [loading, setLoading] = useState(true);
  const [currentCallIndex, setCurrentCallIndex] = useState(0);
  const [staleCount, setStaleCount] = useState(0);
  const [clearing, setClearing] = useState(false);
  const [aircallConfigured, setAircallConfigured] = useState(false);

  const handleCallEnded = useCallback(() => {
    // Call ended — agent will log outcome then click Next Contact
    // Refresh outcomes to update Today's Results cards
    loadAll();
  }, []);

  const { isLoggedIn, callStatus, error: aircallError, dial } = useAircallPhone({
    containerId: "aircall-phone-container",
    enabled: aircallConfigured,
    onCallEnded: handleCallEnded,
  });
  // Agent picker (persisted in localStorage)
  const [agents, setAgents] = useState<Agent[]>([]);
  const [activeAgentId, setActiveAgentId] = useState<string>(() => localStorage.getItem("activeAgentId") || "");
  const activeAgent = agents.find(a => a.id === activeAgentId) || null;
  const agentName = activeAgent ? activeAgent.name.split(" ")[0] : "there";

  const handleAgentChange = (id: string) => {
    setActiveAgentId(id);
    localStorage.setItem("activeAgentId", id);
  };

  // Create call list dialog
  const [createOpen, setCreateOpen] = useState(false);
  const defaultListName = () => {
    const d = new Date();
    return `${agentName} - ${d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}`;
  };
  const [newName, setNewName] = useState("");
  const [newQuota, setNewQuota] = useState("100");
  const [newAgent, setNewAgent] = useState("");
  const [newSourceLists, setNewSourceLists] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);
  const [carryOver, setCarryOver] = useState(false);
  const [sources, setSources] = useState<string[]>([]);
  const today = new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "morning" : hour < 17 ? "afternoon" : "evening";

  useEffect(() => { loadAll(); }, []);

  const loadAll = async () => {
    setLoading(true);
    try {
      const [callListDefsRes, poolRes, agentsRes, sourcesRes, staleRes, outcomesRes, aircallRes] = await Promise.all([
        fetch(`${API_BASE}/call-lists`),
        fetch(`${API_BASE}/contacts/stats`),
        fetch(`${API_BASE}/settings/agents`),
        fetch(`${API_BASE}/contacts/sources`),
        fetch(`${API_BASE}/call-lists/stale-count`),
        fetch(`${API_BASE}/call-lists/today-outcomes`),
        fetch(`${API_BASE}/settings/integrations/aircall`),
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
      const active = allCallListDefs.find((c: CallListDef) => c.active);
      setActiveCallListDef(active || null);

      const agentsList = (agentsData.agents || []).filter((a: Agent) => a.active);
      setAgents(agentsList);
      // Auto-select first agent if none persisted or persisted one no longer exists
      const storedId = localStorage.getItem("activeAgentId");
      if (agentsList.length > 0 && (!storedId || !agentsList.find((a: Agent) => a.id === storedId))) {
        handleAgentChange(agentsList[0].id);
      }

      setSources(sourcesData.sources || []);
      setPoolAvailable(poolData.by_status?.pool || 0);

      if (active) {
        const listRes = await fetch(`${API_BASE}/call-lists/${active.id}/call-list`);
        const listData = await listRes.json();
        setCallList(listData.contacts || []);
      }
    } catch {} finally { setLoading(false); }
  };

  const handleClearStale = async () => {
    setClearing(true);
    try {
      await fetch(`${API_BASE}/call-lists/reconcile`, { method: "POST" });
      await loadAll();
    } catch {} finally { setClearing(false); }
  };

  const handleCreateCallList = async () => {
    if (!newName.trim()) return;
    setCreating(true);
    try {
      // If carrying over, re-date stale contacts to today first
      let carriedOver = 0;
      if (carryOver && staleCount > 0) {
        const carryRes = await fetch(`${API_BASE}/call-lists/carry-over`, { method: "POST" });
        const carryData = await carryRes.json();
        carriedOver = carryData.carried_over || 0;
      }

      const res = await fetch(`${API_BASE}/call-lists`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newName.trim(),
          daily_quota: parseInt(newQuota) || 100,
          assigned_agent_id: newAgent || null,
          filter_criteria: { source_lists: newSourceLists.length > 0 ? newSourceLists : undefined, exclude_outcomes: ["no-interest"] },
        }),
      });
      const data = await res.json();
      const newCallList = data.campaign;

      // Fill remaining quota with fresh contacts
      if (newCallList?.id) {
        const quota = parseInt(newQuota) || 100;
        const freshNeeded = Math.max(0, quota - carriedOver);
        if (freshNeeded > 0) {
          await fetch(`${API_BASE}/call-lists/${newCallList.id}/fill-queue`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ count: freshNeeded }),
          });
        }
      }

      setCreateOpen(false); setNewName(""); setNewQuota("100"); setNewAgent(""); setNewSourceLists([]);
      setCarryOver(false);
      setCurrentCallIndex(0);
      await loadAll();
    } catch {} finally { setCreating(false); }
  };

  const queuedCalls = callList.length;
  const currentContact = callList[currentCallIndex] || null;
  const callsCompleted = currentCallIndex;
  const upNext = callList.slice(currentCallIndex + 1, currentCallIndex + 6);

  // Queue composition derived from actual call list
  const queueCallbacks = callList.filter(c => c.priority === "callback").length;
  const queueFollowUps = callList.filter(c => c.priority === "follow-up").length;
  const queueRetries = callList.filter(c => c.priority === "retry").length;
  const queueFresh = callList.filter(c => c.priority === "fresh").length;

  return (
    <div className="space-y-5 max-w-7xl mx-auto">
      {/* HEADER */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Good {greeting}, {agentName}</h1>
          <p className="text-sm text-muted-foreground">{today}</p>
        </div>
        <div className="flex items-center gap-2">
          {agents.length > 1 && (
            <Select value={activeAgentId} onValueChange={handleAgentChange}>
              <SelectTrigger className="w-[160px] h-8 text-sm">
                <User className="w-3.5 h-3.5 mr-1.5 shrink-0" />
                <SelectValue placeholder="Select agent..." />
              </SelectTrigger>
              <SelectContent>
                {agents.map(a => (
                  <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Link href="/contacts/upload">
            <Button variant="outline" size="sm" className="gap-1.5"><Upload className="w-3.5 h-3.5" /> Upload Contacts</Button>
          </Link>
          <Link href="/settings">
            <Button variant="ghost" size="sm">Settings</Button>
          </Link>
        </div>
      </div>

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
          <div className="grid grid-cols-4 gap-3">
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
            <Card>
              <CardContent className="pt-4 pb-3 px-4">
                <div className="flex items-center gap-3">
                  <Phone className="w-5 h-5 text-primary shrink-0" />
                  <div><p className="text-2xl font-bold leading-none">{todayOutcomes.total}</p><p className="text-xs text-muted-foreground mt-0.5">Called</p></div>
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
              <Button variant="outline" size="sm" className="gap-1.5 shrink-0" onClick={() => { setNewName(defaultListName()); setNewAgent(activeAgentId); setCreateOpen(true); }}>
                <ListPlus className="w-3.5 h-3.5" /> Top Up
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* NEXT CALL + AIRCALL */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">
        <div className="lg:col-span-3">
          <Card className="h-full">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center gap-2"><Phone className="w-5 h-5" /> Next Call</CardTitle>
                {currentContact && (
                  <Badge variant="outline" className="text-xs">
                    {currentContact.priority === "callback" ? "Callback" :
                     currentContact.priority === "follow-up" ? "Follow-up" :
                     currentContact.priority === "retry" ? "Retry" : "Fresh"}
                  </Badge>
                )}
              </div>
            </CardHeader>
            <CardContent>
              {currentContact ? (
                <div className="space-y-4">
                  <div className="flex items-start gap-4">
                    <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                      <User className="w-7 h-7 text-primary" />
                    </div>
                    <div className="flex-1">
                      <h3 className="text-xl font-bold">{currentContact.first_name} {currentContact.last_name}</h3>
                      <div className="flex items-center gap-4 mt-1 text-sm text-muted-foreground">
                        {currentContact.company && <span className="flex items-center gap-1"><Building2 className="w-3.5 h-3.5" /> {currentContact.company}</span>}
                        <span className="flex items-center gap-1"><Phone className="w-3.5 h-3.5" /> {currentContact.phone || "No phone"}</span>
                        {currentContact.email ? (
                          <span className="flex items-center gap-1"><Mail className="w-3.5 h-3.5" /> {currentContact.email}</span>
                        ) : (
                          <span className="flex items-center gap-1 text-yellow-600"><MailWarning className="w-3.5 h-3.5" /> No email</span>
                        )}
                      </div>
                    </div>
                  </div>
                  {currentContact.call_attempts > 0 && (
                    <div className="text-sm text-muted-foreground">
                      Previous attempts: {currentContact.call_attempts}
                      {currentContact.last_call_outcome && <span> | Last: {currentContact.last_call_outcome}</span>}
                    </div>
                  )}
                  <div className="rounded-lg bg-muted/50 p-3 text-sm text-muted-foreground">
                    <p className="font-medium text-foreground mb-1">Call Prep</p>
                    <p>Belief map and conversation history will appear here once intelligence is available for this contact.</p>
                  </div>
                  <div className="flex gap-2">
                    <Button variant="outline" disabled={currentCallIndex <= 0}
                      onClick={() => setCurrentCallIndex(i => Math.max(0, i - 1))}>Previous</Button>
                    <Button disabled={currentCallIndex >= queuedCalls - 1}
                      onClick={() => setCurrentCallIndex(i => i + 1)}>
                      Next Contact <ArrowRight className="w-4 h-4 ml-1" />
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-3">
                    <Phone className="w-8 h-8 text-muted-foreground/40" />
                  </div>
                  <p className="font-medium">No contact loaded</p>
                  <p className="text-sm text-muted-foreground mt-1">
                    {queuedCalls > 0 ? "Navigate through your call list." : "Build your call list to load contacts."}
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* AIRCALL WIDGET */}
        <div className="lg:col-span-2">
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
                <div id="aircall-phone-container" className="flex-1 min-h-[376px]" />
                {aircallError && (
                  <div className="px-3 py-2 text-xs text-destructive bg-destructive/10 border-t">
                    {aircallError}
                  </div>
                )}
                {isLoggedIn && currentContact?.phone && callStatus === "idle" && (
                  <div className="p-3 border-t">
                    <Button
                      className="w-full bg-[#00B388] hover:bg-[#009B76] text-white h-10"
                      onClick={() => dial(currentContact.phone!)}
                    >
                      <PhoneCall className="w-4 h-4 mr-2" />
                      Call {currentContact.first_name}
                    </Button>
                  </div>
                )}
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
            <CardTitle className="flex items-center gap-2 text-base">
              <Headphones className="w-4 h-4" /> Up Next ({Math.max(0, queuedCalls - currentCallIndex - 1)})
            </CardTitle>
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
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {upNext.map((c, i) => (
                    <TableRow key={c.id} className="cursor-pointer hover:bg-muted/50"
                      onClick={() => setCurrentCallIndex(currentCallIndex + 1 + i)}>
                      <TableCell className="text-muted-foreground text-xs">{currentCallIndex + 2 + i}</TableCell>
                      <TableCell className="font-medium text-sm">{c.first_name} {c.last_name}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{c.company || "—"}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-xs">
                          {c.priority === "callback" ? "Callback" : c.priority === "follow-up" ? "Follow-up" : c.priority === "retry" ? "Retry" : "Fresh"}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <div className="text-center py-6">
                <Headphones className="w-6 h-6 text-muted-foreground/30 mx-auto mb-2" />
                <p className="text-sm text-muted-foreground">{queuedCalls > 0 ? "No more contacts after this one." : "Queue is empty."}</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Create Call List Dialog */}
      <Dialog open={createOpen} onOpenChange={(open) => { setCreateOpen(open); if (!open) setCarryOver(false); }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Create Call List</DialogTitle>
            <DialogDescription>Define a call list to dispatch contacts from your pool to the call queue.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {carryOver && staleCount > 0 && (
              <Card className="border-orange-500/50">
                <CardContent className="py-2.5 px-3 text-sm">
                  <span className="font-medium">{staleCount} contact{staleCount !== 1 ? "s" : ""}</span>
                  <span className="text-muted-foreground"> from yesterday will be included. Remaining quota filled with fresh contacts.</span>
                </CardContent>
              </Card>
            )}
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
            {/* Pool availability indicator */}
            <Card className={`${
              poolAvailable >= (parseInt(newQuota) || 100)
                ? "border-green-500/50"
                : poolAvailable > 0
                  ? "border-yellow-500/50"
                  : "border-destructive/50"
            }`}>
              <CardContent className="py-3 px-4 flex items-center justify-between">
                <div>
                  <p className="text-sm">
                    <span className="font-bold">{poolAvailable.toLocaleString()}</span>
                    <span className="text-muted-foreground"> contacts available in pool</span>
                  </p>
                  {poolAvailable < (parseInt(newQuota) || 100) && poolAvailable > 0 && (
                    <p className="text-xs text-muted-foreground mt-0.5">Below daily quota of {parseInt(newQuota) || 100}</p>
                  )}
                  {poolAvailable === 0 && (
                    <p className="text-xs text-destructive mt-0.5">No contacts available — upload a list first</p>
                  )}
                </div>
                {poolAvailable < (parseInt(newQuota) || 100) && (
                  <Link href="/contacts/upload">
                    <Button variant="outline" size="sm" className="gap-1.5 shrink-0">
                      <Upload className="w-3.5 h-3.5" /> Top Up
                    </Button>
                  </Link>
                )}
              </CardContent>
            </Card>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button onClick={handleCreateCallList} disabled={creating || !newName.trim()}>
              {creating && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Create Call List
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
