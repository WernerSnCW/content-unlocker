import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Link } from "wouter";
import {
  Phone, PhoneCall, PhoneOff, PhoneMissed, CalendarClock, UserPlus,
  ArrowRight, Clock, AlertTriangle, Mail, MailWarning, CheckCircle,
  XCircle, Upload, ListPlus, TrendingUp, Users, Headphones, ExternalLink,
  MessageSquare, Timer, BarChart3, ChevronRight
} from "lucide-react";

const API_BASE = (import.meta.env.BASE_URL?.replace(/\/$/, "") || "") + "/api";

export default function CallCommand() {
  const [stats, setStats] = useState<any>(null);
  const agentName = "Tom"; // TODO: from auth/session
  const today = new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });

  useEffect(() => {
    fetchStats();
  }, []);

  const fetchStats = async () => {
    try {
      const res = await fetch(`${API_BASE}/contacts/stats`);
      setStats(await res.json());
    } catch {}
  };

  const poolSize = stats?.total || 0;
  const available = stats?.by_status?.pool || 0;

  // Placeholder data — will be replaced with real API calls
  const queuedCalls = 0;
  const callbacksToday = 0;
  const followUps = 0;
  const retries = 0;
  const freshContacts = 0;

  const recentCalls: Array<{
    name: string; time: string; duration: string;
    outcome: string; transcriptStatus: string;
  }> = [];

  const attentionItems: Array<{
    type: string; message: string; action: string;
  }> = [];

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* ===== GREETING + SUMMARY ===== */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">
            Good {new Date().getHours() < 12 ? "morning" : new Date().getHours() < 17 ? "afternoon" : "evening"}, {agentName}.
          </h1>
          <p className="text-muted-foreground mt-1">{today}</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-right">
            <p className="text-sm font-medium">{queuedCalls} calls queued</p>
            <p className="text-xs text-muted-foreground">{available.toLocaleString()} contacts in pool</p>
          </div>
        </div>
      </div>

      {/* ===== QUEUE BREAKDOWN CARDS ===== */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className={callbacksToday > 0 ? "border-orange-300 dark:border-orange-700" : ""}>
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-3xl font-bold">{callbacksToday}</p>
                <p className="text-sm text-muted-foreground mt-1">Callbacks</p>
              </div>
              <div className="w-10 h-10 rounded-full bg-orange-100 dark:bg-orange-950 flex items-center justify-center">
                <CalendarClock className="w-5 h-5 text-orange-600 dark:text-orange-400" />
              </div>
            </div>
            <p className="text-xs text-muted-foreground mt-2">Scheduled for today</p>
          </CardContent>
        </Card>

        <Card className={followUps > 0 ? "border-blue-300 dark:border-blue-700" : ""}>
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-3xl font-bold">{followUps}</p>
                <p className="text-sm text-muted-foreground mt-1">Follow-ups</p>
              </div>
              <div className="w-10 h-10 rounded-full bg-blue-100 dark:bg-blue-950 flex items-center justify-center">
                <TrendingUp className="w-5 h-5 text-blue-600 dark:text-blue-400" />
              </div>
            </div>
            <p className="text-xs text-muted-foreground mt-2">Interested, awaiting action</p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-3xl font-bold">{retries}</p>
                <p className="text-sm text-muted-foreground mt-1">Retries</p>
              </div>
              <div className="w-10 h-10 rounded-full bg-slate-100 dark:bg-slate-900 flex items-center justify-center">
                <PhoneMissed className="w-5 h-5 text-slate-500" />
              </div>
            </div>
            <p className="text-xs text-muted-foreground mt-2">No answer, try again</p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-3xl font-bold">{freshContacts}</p>
                <p className="text-sm text-muted-foreground mt-1">Fresh</p>
              </div>
              <div className="w-10 h-10 rounded-full bg-green-100 dark:bg-green-950 flex items-center justify-center">
                <UserPlus className="w-5 h-5 text-green-600 dark:text-green-400" />
              </div>
            </div>
            <p className="text-xs text-muted-foreground mt-2">New contacts to dial</p>
          </CardContent>
        </Card>
      </div>

      {/* ===== MAIN CONTENT: QUEUE + AIRCALL ===== */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* TODAY'S QUEUE — takes 2 columns */}
        <div className="lg:col-span-2 space-y-4">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <Phone className="w-5 h-5" /> Today's Queue
                  </CardTitle>
                  <CardDescription>Your prioritised call list for today.</CardDescription>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" disabled>
                    <ListPlus className="w-4 h-4 mr-1" /> Top Up
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {queuedCalls > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Priority</TableHead>
                      <TableHead>Contact</TableHead>
                      <TableHead>Company</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Last Outcome</TableHead>
                      <TableHead></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {/* Queue rows will appear here when campaign dispatch is built */}
                    <TableRow>
                      <TableCell><Badge variant="destructive" className="text-xs">1</Badge></TableCell>
                      <TableCell className="font-medium">Example Contact</TableCell>
                      <TableCell className="text-sm">Example Corp</TableCell>
                      <TableCell><Badge variant="outline" className="text-xs">Callback</Badge></TableCell>
                      <TableCell className="text-sm text-muted-foreground">Requested callback</TableCell>
                      <TableCell>
                        <Button variant="ghost" size="sm">
                          Prep <ChevronRight className="w-3 h-3 ml-1" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              ) : (
                <div className="text-center py-12 space-y-4">
                  <div className="w-16 h-16 rounded-full bg-muted mx-auto flex items-center justify-center">
                    <Phone className="w-8 h-8 text-muted-foreground/50" />
                  </div>
                  <div>
                    <p className="font-medium text-lg">No calls queued yet</p>
                    <p className="text-sm text-muted-foreground mt-1">
                      {poolSize > 0
                        ? `You have ${available.toLocaleString()} contacts in your pool. Build a call list to get started.`
                        : "Upload a contact list to build your outreach pool."}
                    </p>
                  </div>
                  <div className="flex items-center justify-center gap-3 pt-2">
                    {poolSize === 0 ? (
                      <Link href="/contacts/upload">
                        <Button className="gap-2"><Upload className="w-4 h-4" /> Upload Contacts</Button>
                      </Link>
                    ) : (
                      <>
                        <Button className="gap-2" disabled>
                          <ListPlus className="w-4 h-4" /> Build Your Call List
                        </Button>
                        <Link href="/contacts/upload">
                          <Button variant="outline" className="gap-2"><Upload className="w-4 h-4" /> Upload More</Button>
                        </Link>
                      </>
                    )}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* RECENT CALLS */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Headphones className="w-5 h-5" /> Recent Calls
              </CardTitle>
              <CardDescription>Live feed from Aircall. Calls appear here as they happen.</CardDescription>
            </CardHeader>
            <CardContent>
              {recentCalls.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Contact</TableHead>
                      <TableHead>Time</TableHead>
                      <TableHead>Duration</TableHead>
                      <TableHead>Outcome</TableHead>
                      <TableHead>Transcript</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {recentCalls.map((call, i) => (
                      <TableRow key={i}>
                        <TableCell className="font-medium">{call.name}</TableCell>
                        <TableCell className="text-sm">{call.time}</TableCell>
                        <TableCell className="text-sm">{call.duration}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-xs">{call.outcome}</Badge>
                        </TableCell>
                        <TableCell>
                          <Badge variant={call.transcriptStatus === "processed" ? "default" : "secondary"} className="text-xs">
                            {call.transcriptStatus}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <div className="text-center py-8">
                  <Headphones className="w-8 h-8 text-muted-foreground/30 mx-auto mb-2" />
                  <p className="text-sm text-muted-foreground">No calls recorded today.</p>
                  <p className="text-xs text-muted-foreground mt-1">Calls will appear here automatically via Aircall webhooks.</p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* RIGHT COLUMN — Aircall Widget + Campaign Stats + Attention */}
        <div className="space-y-4">

          {/* AIRCALL WIDGET */}
          <Card className="border-green-200 dark:border-green-800">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-lg">
                <PhoneCall className="w-5 h-5 text-green-600" /> Aircall
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="rounded-lg bg-gradient-to-b from-slate-900 to-slate-800 p-4 text-white">
                {/* Aircall phone widget representation */}
                <div className="text-center space-y-3">
                  <div className="w-12 h-12 rounded-full bg-green-500/20 mx-auto flex items-center justify-center">
                    <Phone className="w-6 h-6 text-green-400" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-slate-300">Power Dialer</p>
                    <p className="text-xs text-slate-400 mt-1">Ready to dial</p>
                  </div>
                  <div className="border-t border-slate-700 pt-3 space-y-2">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-slate-400">Status</span>
                      <Badge className="bg-green-600/20 text-green-400 border-green-600/30 text-xs">Available</Badge>
                    </div>
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-slate-400">Queue</span>
                      <span className="text-slate-300">{queuedCalls} contacts loaded</span>
                    </div>
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-slate-400">Calls today</span>
                      <span className="text-slate-300">{recentCalls.length}</span>
                    </div>
                  </div>
                  <Button size="sm" className="w-full bg-green-600 hover:bg-green-700 text-white text-xs" disabled>
                    <PhoneCall className="w-3.5 h-3.5 mr-1" /> Start Dialing
                  </Button>
                </div>
              </div>
              <a href="https://app.aircall.io" target="_blank" rel="noopener noreferrer"
                className="flex items-center justify-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors">
                Open Aircall Dashboard <ExternalLink className="w-3 h-3" />
              </a>
            </CardContent>
          </Card>

          {/* CAMPAIGN STATS */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-lg">
                <BarChart3 className="w-5 h-5" /> Campaign
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                <div className="text-center py-4">
                  <p className="text-sm text-muted-foreground">No active campaign</p>
                  <p className="text-xs text-muted-foreground mt-1">Set up a campaign to start dispatching contacts from your pool.</p>
                </div>

                {/* When active, show these stats */}
                {false && (
                  <>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">Campaign</span>
                        <span className="font-medium">London HNW Wave 1</span>
                      </div>
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">Daily quota</span>
                        <span className="font-medium">50 / 50</span>
                      </div>
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">Called today</span>
                        <span className="font-medium">23</span>
                      </div>
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">Connected</span>
                        <span className="font-medium text-green-600">8</span>
                      </div>
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">Interested</span>
                        <span className="font-medium text-blue-600">3</span>
                      </div>
                    </div>
                    {/* Progress bar */}
                    <div className="space-y-1">
                      <div className="flex justify-between text-xs text-muted-foreground">
                        <span>Progress</span>
                        <span>46%</span>
                      </div>
                      <div className="w-full bg-muted rounded-full h-2">
                        <div className="bg-primary rounded-full h-2" style={{ width: "46%" }}></div>
                      </div>
                    </div>
                  </>
                )}
              </div>
            </CardContent>
          </Card>

          {/* NEEDS ATTENTION */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-lg">
                <AlertTriangle className="w-5 h-5" /> Needs Attention
              </CardTitle>
            </CardHeader>
            <CardContent>
              {attentionItems.length > 0 ? (
                <div className="space-y-2">
                  {attentionItems.map((item, i) => (
                    <div key={i} className="flex items-start gap-2 p-2 rounded-lg bg-muted/50">
                      <AlertTriangle className="w-4 h-4 text-yellow-500 mt-0.5 shrink-0" />
                      <div className="flex-1">
                        <p className="text-sm">{item.message}</p>
                        <button className="text-xs text-primary hover:underline mt-0.5">{item.action}</button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-4">
                  <CheckCircle className="w-6 h-6 text-green-500/50 mx-auto mb-2" />
                  <p className="text-sm text-muted-foreground">All clear</p>
                  <p className="text-xs text-muted-foreground mt-1">Unmatched calls, failed jobs, and missing data will appear here.</p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* QUICK STATS */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-lg">
                <Users className="w-5 h-5" /> Pool Overview
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Total contacts</span>
                  <span className="font-medium">{poolSize.toLocaleString()}</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Available</span>
                  <span className="font-medium">{available.toLocaleString()}</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Dispatched</span>
                  <span className="font-medium">{(stats?.by_status?.dispatched || 0).toLocaleString()}</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Called</span>
                  <span className="font-medium">{(stats?.by_status?.called || 0).toLocaleString()}</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Qualified</span>
                  <span className="font-medium text-green-600">{(stats?.by_status?.qualified || 0).toLocaleString()}</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">In cool-off</span>
                  <span className="font-medium text-yellow-600">{(stats?.by_status?.archived || 0).toLocaleString()}</span>
                </div>
              </div>
              <div className="mt-3 pt-3 border-t">
                <Link href="/contacts/upload" className="flex items-center gap-1 text-xs text-primary hover:underline">
                  Upload more contacts <ArrowRight className="w-3 h-3" />
                </Link>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
