import { useState, useEffect, useRef, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Link } from "wouter";
import {
  Phone, PhoneCall, PhoneOff, PhoneMissed, CalendarClock, UserPlus,
  ArrowRight, Clock, AlertTriangle, CheckCircle, XCircle, Upload,
  ListPlus, TrendingUp, Users, Headphones, ExternalLink,
  Timer, BarChart3, ChevronRight, User, Building2, Mail, MailWarning
} from "lucide-react";

const API_BASE = (import.meta.env.BASE_URL?.replace(/\/$/, "") || "") + "/api";

export default function CallCommand() {
  const [stats, setStats] = useState<any>(null);
  const aircallRef = useRef<HTMLDivElement>(null);
  const [aircallReady, setAircallReady] = useState(false);
  const [aircallLoggedIn, setAircallLoggedIn] = useState(false);
  const [onCall, setOnCall] = useState(false);
  const [currentCallId, setCurrentCallId] = useState<string | null>(null);

  const agentName = "Tom"; // TODO: from auth/session
  const today = new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });

  useEffect(() => { fetchStats(); }, []);

  const fetchStats = async () => {
    try { const res = await fetch(`${API_BASE}/contacts/stats`); setStats(await res.json()); } catch {}
  };

  const poolSize = stats?.total || 0;
  const available = stats?.by_status?.pool || 0;

  // Placeholder data
  const queuedCalls = 0;
  const callbacksToday = 0;
  const followUps = 0;
  const retries = 0;
  const freshContacts = 0;

  // Current contact being called (placeholder)
  const currentContact: {
    first_name: string; last_name: string; company: string;
    phone: string; email: string | null; type: string;
  } | null = null;

  const recentCalls: Array<{
    name: string; time: string; duration: string;
    outcome: string; transcriptStatus: string;
  }> = [];

  const attentionItems: Array<{ type: string; message: string; action: string }> = [];

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* ===== GREETING ===== */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">
            Good {new Date().getHours() < 12 ? "morning" : new Date().getHours() < 17 ? "afternoon" : "evening"}, {agentName}.
          </h1>
          <p className="text-muted-foreground mt-1">{today}</p>
        </div>
        <div className="text-right">
          <p className="text-sm font-medium">{queuedCalls} calls queued</p>
          <p className="text-xs text-muted-foreground">{available.toLocaleString()} contacts in pool</p>
        </div>
      </div>

      {/* ===== QUEUE BREAKDOWN ===== */}
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

      {/* ===== MAIN CONTENT ===== */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* LEFT: Current Contact + Queue */}
        <div className="lg:col-span-2 space-y-4">

          {/* CURRENT CONTACT — the contact being called right now */}
          <Card className="border-2 border-primary/20">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center gap-2">
                  <Phone className="w-5 h-5" /> Next Call
                </CardTitle>
                {currentContact && (
                  <Badge variant="outline" className="text-xs">{currentContact.type}</Badge>
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
                        <span className="flex items-center gap-1"><Building2 className="w-3.5 h-3.5" /> {currentContact.company}</span>
                        <span className="flex items-center gap-1"><Phone className="w-3.5 h-3.5" /> {currentContact.phone}</span>
                        {currentContact.email ? (
                          <span className="flex items-center gap-1"><Mail className="w-3.5 h-3.5" /> {currentContact.email}</span>
                        ) : (
                          <span className="flex items-center gap-1 text-yellow-600"><MailWarning className="w-3.5 h-3.5" /> No email — ask on call</span>
                        )}
                      </div>
                    </div>
                  </div>
                  {/* Call prep context will go here — belief map, last conversation summary, etc. */}
                  <div className="rounded-lg bg-muted/50 p-3 text-sm text-muted-foreground">
                    <p className="font-medium text-foreground mb-1">Call Prep</p>
                    <p>Belief map, conversation history, and recommended talking points will appear here.</p>
                  </div>
                </div>
              ) : (
                <div className="text-center py-8 space-y-4">
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
                  <p className="text-xs text-muted-foreground pt-2">Use the Call List panel on the right to get started.</p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* QUEUE — remaining calls */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Headphones className="w-5 h-5" /> Queue ({queuedCalls} remaining)
              </CardTitle>
            </CardHeader>
            <CardContent>
              {queuedCalls > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-10">#</TableHead>
                      <TableHead>Contact</TableHead>
                      <TableHead>Company</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Last Outcome</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {/* Rows populate from campaign dispatch */}
                  </TableBody>
                </Table>
              ) : (
                <p className="text-sm text-muted-foreground text-center py-4">
                  No contacts in queue. Build your call list to load contacts here.
                </p>
              )}
            </CardContent>
          </Card>

          {/* RECENT CALLS */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Clock className="w-5 h-5" /> Today's Calls
              </CardTitle>
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
                        <TableCell><Badge variant="outline" className="text-xs">{call.outcome}</Badge></TableCell>
                        <TableCell><Badge variant={call.transcriptStatus === "processed" ? "default" : "secondary"} className="text-xs">{call.transcriptStatus}</Badge></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <div className="text-center py-6">
                  <Clock className="w-6 h-6 text-muted-foreground/30 mx-auto mb-2" />
                  <p className="text-sm text-muted-foreground">No calls yet today. Completed calls will appear here.</p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* RIGHT COLUMN — Aircall Widget + Stats */}
        <div className="space-y-4">

          {/* AIRCALL WIDGET — embedded phone */}
          <Card className="overflow-hidden">
            <div className="bg-[#00B388] px-4 py-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="white">
                  <path d="M20.01 15.38c-1.23 0-2.42-.2-3.53-.56a.977.977 0 0 0-1.01.24l-1.57 1.97c-2.83-1.35-5.48-3.9-6.89-6.83l1.95-1.66c.27-.28.35-.67.24-1.02-.37-1.11-.56-2.3-.56-3.53 0-.54-.45-.99-.99-.99H4.19C3.65 3 3 3.24 3 3.99 3 13.28 10.73 21 20.01 21c.71 0 .99-.63.99-1.18v-3.45c0-.54-.45-.99-.99-.99z"/>
                </svg>
                <span className="text-white font-semibold text-sm">Aircall</span>
              </div>
              <div className="flex items-center gap-2">
                <Badge className="bg-white/20 text-white border-0 text-xs">
                  {aircallLoggedIn ? "Connected" : "Not connected"}
                </Badge>
              </div>
            </div>

            {/* Embedded Aircall Workspace */}
            <div ref={aircallRef} className="bg-slate-50 dark:bg-slate-900" style={{ minHeight: "500px" }}>
              {/* The Aircall Everywhere SDK will load the iframe here */}
              {/* For now, show a placeholder that represents the embedded phone */}
              <div className="flex flex-col items-center justify-center h-full py-8 space-y-4">
                <div className="w-full max-w-[280px] mx-auto space-y-4 px-4">
                  {/* Phone display */}
                  <div className="rounded-xl bg-white dark:bg-slate-800 shadow-lg p-5 space-y-4">
                    <div className="text-center">
                      <div className="w-16 h-16 rounded-full bg-[#00B388]/10 mx-auto flex items-center justify-center mb-3">
                        <PhoneCall className="w-8 h-8 text-[#00B388]" />
                      </div>
                      {currentContact ? (
                        <>
                          <p className="font-bold text-lg">{currentContact.first_name} {currentContact.last_name}</p>
                          <p className="text-sm text-muted-foreground">{currentContact.phone}</p>
                          <p className="text-xs text-muted-foreground">{currentContact.company}</p>
                        </>
                      ) : (
                        <>
                          <p className="font-medium text-muted-foreground">Ready to call</p>
                          <p className="text-xs text-muted-foreground">Load a contact from your queue</p>
                        </>
                      )}
                    </div>

                    {/* Call button */}
                    {!onCall ? (
                      <Button
                        className="w-full bg-[#00B388] hover:bg-[#009B76] text-white h-12 text-base"
                        disabled={!currentContact}
                      >
                        <PhoneCall className="w-5 h-5 mr-2" />
                        {currentContact ? "Call Now" : "No Contact Loaded"}
                      </Button>
                    ) : (
                      <div className="space-y-2">
                        <div className="text-center">
                          <Badge className="bg-green-100 text-green-700 border-green-200 animate-pulse">
                            <Timer className="w-3 h-3 mr-1" /> On Call
                          </Badge>
                        </div>
                        <Button variant="destructive" className="w-full h-10">
                          <PhoneOff className="w-4 h-4 mr-2" /> End Call
                        </Button>
                      </div>
                    )}

                    {/* Status bar */}
                    <div className="border-t pt-3 space-y-1.5">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-muted-foreground">Status</span>
                        <span className="font-medium text-[#00B388]">Available</span>
                      </div>
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-muted-foreground">Calls today</span>
                        <span className="font-medium">{recentCalls.length}</span>
                      </div>
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-muted-foreground">Queue</span>
                        <span className="font-medium">{queuedCalls} remaining</span>
                      </div>
                    </div>
                  </div>

                  <p className="text-[10px] text-center text-muted-foreground">
                    Aircall Everywhere widget will replace this placeholder.
                    <br />Tags and notes are captured directly in the Aircall widget.
                  </p>
                </div>
              </div>
            </div>

            <div className="border-t px-4 py-2 bg-slate-50 dark:bg-slate-900">
              <a href="https://app.aircall.io" target="_blank" rel="noopener noreferrer"
                className="flex items-center justify-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors">
                Open Aircall Dashboard <ExternalLink className="w-3 h-3" />
              </a>
            </div>
          </Card>

          {/* CALL LIST BUILDER */}
          <Card className={queuedCalls === 0 ? "border-primary/30 shadow-md" : ""}>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-lg">
                <ListPlus className="w-5 h-5" /> Your Call List
              </CardTitle>
            </CardHeader>
            <CardContent>
              {queuedCalls > 0 ? (
                <div className="space-y-4">
                  {/* Progress */}
                  <div>
                    <div className="flex justify-between text-sm mb-1.5">
                      <span className="font-medium">{queuedCalls} remaining</span>
                      <span className="text-muted-foreground">of 50 target</span>
                    </div>
                    <div className="w-full bg-muted rounded-full h-2.5">
                      <div className="bg-[#00B388] rounded-full h-2.5 transition-all" style={{ width: `${Math.min(100, ((50 - queuedCalls) / 50) * 100)}%` }}></div>
                    </div>
                  </div>

                  {/* Today's stats */}
                  <div className="grid grid-cols-3 gap-2 text-center">
                    <div className="rounded-lg bg-green-50 dark:bg-green-950/20 p-2">
                      <p className="text-lg font-bold text-green-700 dark:text-green-400">0</p>
                      <p className="text-[10px] text-green-600 dark:text-green-500">Connected</p>
                    </div>
                    <div className="rounded-lg bg-blue-50 dark:bg-blue-950/20 p-2">
                      <p className="text-lg font-bold text-blue-700 dark:text-blue-400">0</p>
                      <p className="text-[10px] text-blue-600 dark:text-blue-500">Interested</p>
                    </div>
                    <div className="rounded-lg bg-slate-50 dark:bg-slate-950/20 p-2">
                      <p className="text-lg font-bold text-slate-600 dark:text-slate-400">0</p>
                      <p className="text-[10px] text-slate-500">No Answer</p>
                    </div>
                  </div>

                  <Button variant="outline" className="w-full gap-2" disabled>
                    <ListPlus className="w-4 h-4" /> Top Up Call List
                  </Button>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="text-center py-2">
                    <div className="w-12 h-12 rounded-full bg-primary/10 mx-auto flex items-center justify-center mb-3">
                      <ListPlus className="w-6 h-6 text-primary" />
                    </div>
                    <p className="font-medium">No call list for today</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {available > 0
                        ? `${available.toLocaleString()} contacts available in your pool`
                        : "Upload contacts first to build a call list"}
                    </p>
                  </div>

                  {available > 0 ? (
                    <div className="space-y-3">
                      {/* Quick build — just pick a number */}
                      <div className="space-y-1.5">
                        <label className="text-xs font-medium text-muted-foreground">How many calls today?</label>
                        <div className="flex gap-2">
                          {[25, 50, 75, 100].map(n => (
                            <Button key={n} variant="outline" size="sm" className="flex-1 text-xs" disabled>
                              {n}
                            </Button>
                          ))}
                        </div>
                      </div>

                      <Button className="w-full gap-2 h-11" disabled>
                        <ListPlus className="w-4 h-4" /> Build Call List
                      </Button>

                      <p className="text-[10px] text-center text-muted-foreground">
                        Selects contacts from your pool and loads them into your queue.
                        Callbacks and follow-ups are added automatically.
                      </p>
                    </div>
                  ) : (
                    <Link href="/contacts/upload">
                      <Button className="w-full gap-2 h-11">
                        <Upload className="w-4 h-4" /> Upload Contacts
                      </Button>
                    </Link>
                  )}
                </div>
              )}
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
                  <p className="text-xs text-muted-foreground mt-1">Unmatched calls and errors will appear here.</p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* POOL OVERVIEW */}
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
