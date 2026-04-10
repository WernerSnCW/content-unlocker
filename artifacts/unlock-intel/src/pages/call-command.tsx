import { useState, useEffect, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Link } from "wouter";
import {
  Phone, PhoneCall, PhoneOff, PhoneMissed, CalendarClock, UserPlus,
  ArrowRight, Clock, AlertTriangle, CheckCircle, Upload,
  ListPlus, TrendingUp, Users, Headphones, ExternalLink,
  Timer, ChevronRight, User, Building2, Mail, MailWarning,
  Database
} from "lucide-react";

const API_BASE = (import.meta.env.BASE_URL?.replace(/\/$/, "") || "") + "/api";

export default function CallCommand() {
  const [stats, setStats] = useState<any>(null);
  const [selectedCount, setSelectedCount] = useState<number | null>(null);
  const aircallRef = useRef<HTMLDivElement>(null);
  const [onCall, setOnCall] = useState(false);

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
  const callsCompleted = 0;

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
    <div className="space-y-5 max-w-7xl mx-auto">
      {/* ===== HEADER BAR ===== */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            Good {new Date().getHours() < 12 ? "morning" : new Date().getHours() < 17 ? "afternoon" : "evening"}, {agentName}
          </h1>
          <p className="text-sm text-muted-foreground">{today}</p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/contacts/upload">
            <Button variant="outline" size="sm" className="gap-1.5">
              <Upload className="w-3.5 h-3.5" /> Upload Contacts
            </Button>
          </Link>
          <Link href="/settings">
            <Button variant="ghost" size="sm">Settings</Button>
          </Link>
        </div>
      </div>

      {/* ===== NEEDS ATTENTION (only when items exist) ===== */}
      {attentionItems.length > 0 && (
        <div className="rounded-lg border border-yellow-300 dark:border-yellow-700 bg-yellow-50 dark:bg-yellow-950/20 px-4 py-3">
          <div className="flex items-center gap-3">
            <AlertTriangle className="w-4 h-4 text-yellow-600 shrink-0" />
            <div className="flex-1 flex items-center gap-4 text-sm">
              {attentionItems.map((item, i) => (
                <span key={i}>{item.message} <button className="text-primary hover:underline ml-1">{item.action}</button></span>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ===== QUEUE BREAKDOWN — compact row ===== */}
      <div className="grid grid-cols-5 gap-3">
        <Card className={callbacksToday > 0 ? "border-orange-300 dark:border-orange-700" : ""}>
          <CardContent className="pt-4 pb-3 px-4">
            <div className="flex items-center gap-3">
              <CalendarClock className="w-5 h-5 text-orange-500 shrink-0" />
              <div>
                <p className="text-2xl font-bold leading-none">{callbacksToday}</p>
                <p className="text-xs text-muted-foreground mt-0.5">Callbacks</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className={followUps > 0 ? "border-blue-300 dark:border-blue-700" : ""}>
          <CardContent className="pt-4 pb-3 px-4">
            <div className="flex items-center gap-3">
              <TrendingUp className="w-5 h-5 text-blue-500 shrink-0" />
              <div>
                <p className="text-2xl font-bold leading-none">{followUps}</p>
                <p className="text-xs text-muted-foreground mt-0.5">Follow-ups</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3 px-4">
            <div className="flex items-center gap-3">
              <PhoneMissed className="w-5 h-5 text-slate-400 shrink-0" />
              <div>
                <p className="text-2xl font-bold leading-none">{retries}</p>
                <p className="text-xs text-muted-foreground mt-0.5">Retries</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3 px-4">
            <div className="flex items-center gap-3">
              <UserPlus className="w-5 h-5 text-green-500 shrink-0" />
              <div>
                <p className="text-2xl font-bold leading-none">{freshContacts}</p>
                <p className="text-xs text-muted-foreground mt-0.5">Fresh</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3 px-4">
            <div className="flex items-center gap-3">
              <Database className="w-5 h-5 text-muted-foreground shrink-0" />
              <div>
                <p className="text-2xl font-bold leading-none">{available}</p>
                <p className="text-xs text-muted-foreground mt-0.5">In Pool</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ===== CALL LIST BUILDER (full width, prominent) ===== */}
      {queuedCalls === 0 && (
        <Card className="border-primary/30 bg-primary/[0.02]">
          <CardContent className="py-5">
            {available > 0 ? (
              <div className="flex items-center justify-between gap-6">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                    <ListPlus className="w-5 h-5 text-primary" />
                  </div>
                  <div>
                    <p className="font-semibold">Build your call list</p>
                    <p className="text-sm text-muted-foreground">{available} contacts available. Callbacks and follow-ups are included automatically.</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {[25, 50, 75, 100].map(n => (
                    <Button key={n} variant={selectedCount === n ? "default" : "outline"} size="sm"
                      className="w-12" onClick={() => setSelectedCount(n)} disabled>
                      {n}
                    </Button>
                  ))}
                  <Button className="ml-2 gap-1.5 bg-[#00B388] hover:bg-[#009B76] text-white" disabled>
                    <ListPlus className="w-4 h-4" /> Build List
                  </Button>
                </div>
              </div>
            ) : (
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
                <Link href="/contacts/upload">
                  <Button className="gap-1.5 shrink-0"><Upload className="w-4 h-4" /> Upload Contacts</Button>
                </Link>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Active call list progress (when queue has items) */}
      {queuedCalls > 0 && (
        <Card>
          <CardContent className="py-4">
            <div className="flex items-center justify-between gap-6">
              <div className="flex items-center gap-6 flex-1">
                <div>
                  <p className="text-sm font-medium">{queuedCalls} calls remaining</p>
                  <p className="text-xs text-muted-foreground">of 50 target</p>
                </div>
                <div className="flex-1 max-w-md">
                  <div className="w-full bg-muted rounded-full h-2">
                    <div className="bg-[#00B388] rounded-full h-2 transition-all" style={{ width: `${Math.min(100, ((50 - queuedCalls) / 50) * 100)}%` }}></div>
                  </div>
                </div>
                <div className="flex gap-4 text-center">
                  <div><p className="text-lg font-bold text-green-600">0</p><p className="text-[10px] text-muted-foreground">Connected</p></div>
                  <div><p className="text-lg font-bold text-blue-600">0</p><p className="text-[10px] text-muted-foreground">Interested</p></div>
                  <div><p className="text-lg font-bold text-slate-500">0</p><p className="text-[10px] text-muted-foreground">No Answer</p></div>
                </div>
              </div>
              <Button variant="outline" size="sm" className="gap-1.5 shrink-0" disabled>
                <ListPlus className="w-3.5 h-3.5" /> Top Up
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ===== NEXT CALL + AIRCALL WIDGET ===== */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">

        {/* NEXT CALL — 3 columns */}
        <div className="lg:col-span-3">
          <Card className="h-full">
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
                          <span className="flex items-center gap-1 text-yellow-600"><MailWarning className="w-3.5 h-3.5" /> No email - ask on call</span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="rounded-lg bg-muted/50 p-3 text-sm text-muted-foreground">
                    <p className="font-medium text-foreground mb-1">Call Prep</p>
                    <p>Belief map, conversation history, and recommended talking points will appear here.</p>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-3">
                    <Phone className="w-8 h-8 text-muted-foreground/40" />
                  </div>
                  <p className="font-medium">No contact loaded</p>
                  <p className="text-sm text-muted-foreground mt-1">
                    {queuedCalls > 0
                      ? "The next contact will appear here when you're ready."
                      : "Build your call list to load contacts."}
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* AIRCALL WIDGET — 2 columns */}
        <div className="lg:col-span-2">
          <Card className="overflow-hidden h-full flex flex-col">
            <div className="bg-[#00B388] px-4 py-2.5 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="white">
                  <path d="M20.01 15.38c-1.23 0-2.42-.2-3.53-.56a.977.977 0 0 0-1.01.24l-1.57 1.97c-2.83-1.35-5.48-3.9-6.89-6.83l1.95-1.66c.27-.28.35-.67.24-1.02-.37-1.11-.56-2.3-.56-3.53 0-.54-.45-.99-.99-.99H4.19C3.65 3 3 3.24 3 3.99 3 13.28 10.73 21 20.01 21c.71 0 .99-.63.99-1.18v-3.45c0-.54-.45-.99-.99-.99z"/>
                </svg>
                <span className="text-white font-semibold text-sm">Aircall</span>
              </div>
              <Badge className="bg-white/20 text-white border-0 text-[10px]">Available</Badge>
            </div>

            <div ref={aircallRef} className="flex-1 flex flex-col items-center justify-center p-6 bg-slate-50 dark:bg-slate-900">
              {/* Aircall Everywhere SDK loads here — placeholder for now */}
              <div className="w-full max-w-[260px] space-y-5">
                <div className="text-center">
                  <div className="w-16 h-16 rounded-full bg-[#00B388]/10 mx-auto flex items-center justify-center mb-3">
                    <PhoneCall className="w-8 h-8 text-[#00B388]" />
                  </div>
                  {currentContact ? (
                    <>
                      <p className="font-bold text-lg">{currentContact.first_name} {currentContact.last_name}</p>
                      <p className="text-sm text-muted-foreground font-mono">{currentContact.phone}</p>
                    </>
                  ) : (
                    <p className="text-sm text-muted-foreground">Waiting for contact</p>
                  )}
                </div>

                {!onCall ? (
                  <Button
                    className="w-full bg-[#00B388] hover:bg-[#009B76] text-white h-12 text-base rounded-full shadow-lg"
                    disabled={!currentContact}
                  >
                    <PhoneCall className="w-5 h-5 mr-2" />
                    {currentContact ? "Call" : "No Contact"}
                  </Button>
                ) : (
                  <div className="space-y-3">
                    <div className="text-center">
                      <Badge className="bg-[#00B388]/10 text-[#00B388] border-[#00B388]/30 animate-pulse px-4 py-1">
                        <Timer className="w-3.5 h-3.5 mr-1.5" /> On Call - 02:34
                      </Badge>
                    </div>
                    <Button variant="destructive" className="w-full h-10 rounded-full">
                      <PhoneOff className="w-4 h-4 mr-2" /> End Call
                    </Button>
                  </div>
                )}

                <div className="space-y-1.5 text-xs">
                  <div className="flex justify-between"><span className="text-muted-foreground">Calls today</span><span className="font-medium">{callsCompleted}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Queue</span><span className="font-medium">{queuedCalls} remaining</span></div>
                </div>
              </div>
            </div>

            <div className="border-t px-3 py-1.5 bg-slate-50 dark:bg-slate-900">
              <a href="https://app.aircall.io" target="_blank" rel="noopener noreferrer"
                className="flex items-center justify-center gap-1 text-[10px] text-muted-foreground hover:text-foreground">
                Aircall Dashboard <ExternalLink className="w-2.5 h-2.5" />
              </a>
            </div>
          </Card>
        </div>
      </div>

      {/* ===== QUEUE + TODAY'S CALLS — side by side ===== */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">

        {/* QUEUE */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Headphones className="w-4 h-4" /> Up Next ({queuedCalls})
            </CardTitle>
          </CardHeader>
          <CardContent>
            {queuedCalls > 0 ? (
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
                  {/* Rows from campaign dispatch */}
                </TableBody>
              </Table>
            ) : (
              <div className="text-center py-6">
                <Headphones className="w-6 h-6 text-muted-foreground/30 mx-auto mb-2" />
                <p className="text-sm text-muted-foreground">Queue is empty.</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* TODAY'S CALLS */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Clock className="w-4 h-4" /> Completed Today ({callsCompleted})
            </CardTitle>
          </CardHeader>
          <CardContent>
            {recentCalls.length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Contact</TableHead>
                    <TableHead>Duration</TableHead>
                    <TableHead>Outcome</TableHead>
                    <TableHead>Transcript</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {recentCalls.map((call, i) => (
                    <TableRow key={i}>
                      <TableCell className="font-medium text-sm">{call.name}</TableCell>
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
                <p className="text-sm text-muted-foreground">No calls completed yet today.</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
