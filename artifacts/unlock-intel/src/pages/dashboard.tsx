import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Link } from "wouter";
import { Phone, PhoneCall, Clock, TrendingUp, RotateCcw, Sparkles, Users, Upload, Settings, ArrowRight, Loader2, Play, ChevronRight } from "lucide-react";

const API_BASE = (import.meta.env.BASE_URL?.replace(/\/$/, "") || "") + "/api";

interface QueueStats {
  callbacks: number;
  followups: number;
  retries: number;
  fresh: number;
  pool: number;
}

interface CallContact {
  id: string; first_name: string; last_name: string; email: string | null;
  phone: string | null; company: string | null; call_attempts: number;
  last_call_outcome: string | null; priority: string;
}

interface Campaign {
  id: string; name: string; daily_quota: number; active: boolean;
}

export default function Dashboard() {
  const [stats, setStats] = useState<QueueStats>({ callbacks: 0, followups: 0, retries: 0, fresh: 0, pool: 0 });
  const [callList, setCallList] = useState<CallContact[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [activeCampaign, setActiveCampaign] = useState<Campaign | null>(null);
  const [loading, setLoading] = useState(true);
  const [building, setBuilding] = useState(false);
  const [buildCount, setBuildCount] = useState(50);
  const [buildResult, setBuildResult] = useState<any>(null);
  const [currentCallIndex, setCurrentCallIndex] = useState(0);

  const now = new Date();
  const hour = now.getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const dateStr = now.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });

  // Get agent name from first active agent
  const [agentName, setAgentName] = useState("there");

  useEffect(() => {
    loadDashboard();
  }, []);

  const loadDashboard = async () => {
    setLoading(true);
    try {
      // Fetch campaigns, pool stats, and agent name
      const [campaignsRes, poolRes, agentsRes] = await Promise.all([
        fetch(`${API_BASE}/campaigns`),
        fetch(`${API_BASE}/contacts/stats`),
        fetch(`${API_BASE}/settings/agents`),
      ]);

      const campaignsData = await campaignsRes.json();
      const poolData = await poolRes.json();
      const agentsData = await agentsRes.json();

      const allCampaigns = campaignsData.campaigns || [];
      setCampaigns(allCampaigns);

      const active = allCampaigns.find((c: Campaign) => c.active);
      setActiveCampaign(active || null);

      // Set agent name
      const agents = agentsData.agents || [];
      if (agents.length > 0) setAgentName(agents[0].name.split(" ")[0]);

      // Pool count
      const poolCount = poolData.by_status?.pool || 0;

      // If we have an active campaign, load queue status and call list
      if (active) {
        const [queueRes, listRes] = await Promise.all([
          fetch(`${API_BASE}/campaigns/${active.id}/queue-status`),
          fetch(`${API_BASE}/campaigns/${active.id}/call-list`),
        ]);

        const queueData = await queueRes.json();
        const listData = await listRes.json();

        setStats({
          callbacks: queueData.callbacks_due || 0,
          followups: queueData.interested_followups || 0,
          retries: queueData.retry_eligible || 0,
          fresh: queueData.already_dispatched_today || 0,
          pool: poolCount,
        });

        setCallList(listData.contacts || []);
      } else {
        setStats({ callbacks: 0, followups: 0, retries: 0, fresh: 0, pool: poolCount });
      }
    } catch {} finally { setLoading(false); }
  };

  const handleBuildList = async () => {
    if (!activeCampaign) return;
    setBuilding(true); setBuildResult(null);
    try {
      const res = await fetch(`${API_BASE}/campaigns/${activeCampaign.id}/fill-queue`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ count: buildCount }),
      });
      const data = await res.json();
      setBuildResult(data);
      setCurrentCallIndex(0);
      await loadDashboard();
    } catch {} finally { setBuilding(false); }
  };

  const currentContact = callList[currentCallIndex] || null;
  const totalCalls = callList.length;
  const callsRemaining = totalCalls - currentCallIndex;

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{greeting}, {agentName}</h1>
          <p className="text-muted-foreground mt-1">{dateStr}</p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/contacts/upload">
            <Button variant="outline" size="sm"><Upload className="w-4 h-4 mr-1" /> Upload Contacts</Button>
          </Link>
          <Link href="/settings">
            <Button variant="outline" size="sm"><Settings className="w-4 h-4" /></Button>
          </Link>
        </div>
      </div>

      {/* Queue Status Cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Card>
          <CardContent className="pt-4 pb-3 text-center">
            <div className="flex items-center justify-center gap-2 mb-1">
              <Clock className="w-4 h-4 text-orange-500" />
              <span className="text-2xl font-bold">{stats.callbacks}</span>
            </div>
            <p className="text-xs text-muted-foreground">Callbacks</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3 text-center">
            <div className="flex items-center justify-center gap-2 mb-1">
              <TrendingUp className="w-4 h-4 text-green-500" />
              <span className="text-2xl font-bold">{stats.followups}</span>
            </div>
            <p className="text-xs text-muted-foreground">Follow-ups</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3 text-center">
            <div className="flex items-center justify-center gap-2 mb-1">
              <RotateCcw className="w-4 h-4 text-yellow-500" />
              <span className="text-2xl font-bold">{stats.retries}</span>
            </div>
            <p className="text-xs text-muted-foreground">Retries</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3 text-center">
            <div className="flex items-center justify-center gap-2 mb-1">
              <Sparkles className="w-4 h-4 text-blue-500" />
              <span className="text-2xl font-bold">{stats.fresh}</span>
            </div>
            <p className="text-xs text-muted-foreground">Fresh</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3 text-center">
            <div className="flex items-center justify-center gap-2 mb-1">
              <Users className="w-4 h-4 text-muted-foreground" />
              <span className="text-2xl font-bold">{stats.pool}</span>
            </div>
            <p className="text-xs text-muted-foreground">In Pool</p>
          </CardContent>
        </Card>
      </div>

      {/* Build Call List */}
      <Card>
        <CardContent className="py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                <PhoneCall className="w-5 h-5 text-primary" />
              </div>
              <div>
                <p className="font-medium">Build your call list</p>
                <p className="text-sm text-muted-foreground">
                  {stats.pool} contacts available. Callbacks and follow-ups are included automatically.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {[25, 50, 75, 100].map(n => (
                <Button key={n} variant={buildCount === n ? "default" : "outline"} size="sm"
                  onClick={() => setBuildCount(n)} className="w-10 h-8 px-0">
                  {n}
                </Button>
              ))}
              <Button onClick={handleBuildList} disabled={building || !activeCampaign} className="ml-2">
                {building ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Play className="w-4 h-4 mr-2" />}
                Build List
              </Button>
            </div>
          </div>
          {!activeCampaign && campaigns.length === 0 && (
            <div className="mt-3 p-3 rounded-lg bg-muted text-sm text-muted-foreground">
              No campaign configured. <Link href="/call-list" className="text-primary hover:underline">Create a campaign</Link> first to start building call lists.
            </div>
          )}
          {buildResult && (
            <div className="mt-3 p-3 rounded-lg bg-green-50 dark:bg-green-950/20 text-sm">
              <span className="font-medium text-green-700 dark:text-green-400">
                {buildResult.dispatched} contacts added to your list
              </span>
              <span className="text-green-600 dark:text-green-500 ml-2">
                ({buildResult.callbacks} callbacks, {buildResult.interested} follow-ups, {buildResult.retries} retries, {buildResult.fresh} fresh)
              </span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Main content: Next Call + Aircall */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Next Call */}
        <div className="lg:col-span-2">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center gap-2">
                  <Phone className="w-5 h-5" /> Next Call
                </CardTitle>
                {totalCalls > 0 && (
                  <Badge variant="outline">{currentCallIndex + 1} of {totalCalls} | {callsRemaining} remaining</Badge>
                )}
              </div>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="py-8 text-center"><Loader2 className="w-6 h-6 animate-spin mx-auto" /></div>
              ) : !currentContact ? (
                <div className="py-8 text-center text-muted-foreground">
                  <Phone className="w-10 h-10 mx-auto mb-3 opacity-30" />
                  <p className="font-medium">No calls queued</p>
                  <p className="text-sm mt-1">Build your call list above to get started.</p>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="flex items-start justify-between">
                    <div>
                      <h3 className="text-xl font-bold">{currentContact.first_name} {currentContact.last_name}</h3>
                      {currentContact.company && <p className="text-muted-foreground">{currentContact.company}</p>}
                    </div>
                    <Badge className={
                      currentContact.priority === "callback" ? "bg-orange-100 text-orange-700 border-orange-200" :
                      currentContact.priority === "follow-up" ? "bg-green-100 text-green-700 border-green-200" :
                      currentContact.priority === "retry" ? "bg-yellow-100 text-yellow-700 border-yellow-200" :
                      "bg-blue-100 text-blue-700 border-blue-200"
                    }>
                      {currentContact.priority === "callback" && <Clock className="w-3 h-3 mr-1" />}
                      {currentContact.priority === "follow-up" && <TrendingUp className="w-3 h-3 mr-1" />}
                      {currentContact.priority === "retry" && <RotateCcw className="w-3 h-3 mr-1" />}
                      {currentContact.priority === "fresh" && <Sparkles className="w-3 h-3 mr-1" />}
                      {currentContact.priority}
                    </Badge>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground uppercase tracking-wide">Phone</p>
                      <p className="font-mono text-lg">{currentContact.phone || "No phone"}</p>
                    </div>
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground uppercase tracking-wide">Email</p>
                      <p className="text-sm">{currentContact.email || "No email"}</p>
                    </div>
                  </div>

                  {currentContact.call_attempts > 0 && (
                    <div className="flex items-center gap-4 text-sm text-muted-foreground">
                      <span>Previous attempts: {currentContact.call_attempts}</span>
                      {currentContact.last_call_outcome && <span>Last outcome: {currentContact.last_call_outcome}</span>}
                    </div>
                  )}

                  <div className="flex items-center gap-2 pt-2">
                    <Button disabled={currentCallIndex <= 0} variant="outline"
                      onClick={() => setCurrentCallIndex(i => Math.max(0, i - 1))}>
                      Previous
                    </Button>
                    <Button disabled={currentCallIndex >= totalCalls - 1}
                      onClick={() => setCurrentCallIndex(i => Math.min(totalCalls - 1, i + 1))}>
                      Next Contact <ChevronRight className="w-4 h-4 ml-1" />
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Right sidebar */}
        <div className="space-y-4">
          {/* Aircall Status */}
          <Card className="bg-emerald-600 text-white border-none">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-white flex items-center gap-2">
                  <Phone className="w-5 h-5" /> Aircall
                </CardTitle>
                <Badge className="bg-white/20 text-white border-none">Available</Badge>
              </div>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-center py-4">
                <div className="w-16 h-16 rounded-full bg-white/20 flex items-center justify-center">
                  <PhoneCall className="w-8 h-8" />
                </div>
              </div>
              <p className="text-center text-sm text-white/80">Ready to dial</p>
            </CardContent>
          </Card>

          {/* Campaign Info */}
          {activeCampaign && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Active Campaign</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <p className="font-medium">{activeCampaign.name}</p>
                <p className="text-sm text-muted-foreground">Quota: {activeCampaign.daily_quota}/day</p>
                <Link href="/call-list">
                  <Button variant="outline" size="sm" className="w-full mt-2">
                    Manage Campaigns <ArrowRight className="w-3 h-3 ml-1" />
                  </Button>
                </Link>
              </CardContent>
            </Card>
          )}

          {/* Quick Stats */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Today's Progress</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Calls made</span>
                  <span className="font-medium">{currentCallIndex}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Remaining</span>
                  <span className="font-medium">{callsRemaining}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Total dispatched</span>
                  <span className="font-medium">{totalCalls}</span>
                </div>
              </div>
              {totalCalls > 0 && (
                <div className="mt-3">
                  <div className="h-2 bg-muted rounded-full overflow-hidden">
                    <div className="h-full bg-primary rounded-full transition-all"
                      style={{ width: `${(currentCallIndex / totalCalls) * 100}%` }} />
                  </div>
                  <p className="text-xs text-muted-foreground mt-1 text-center">
                    {Math.round((currentCallIndex / totalCalls) * 100)}% complete
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
