import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, Upload, CheckCircle, AlertTriangle, XCircle, Users, History, Database, ArrowRight, FileSpreadsheet, ShieldCheck, UserCheck, UserX, HelpCircle } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const API_BASE = (import.meta.env.BASE_URL?.replace(/\/$/, "") || "") + "/api";

type Session = {
  id: string; source_list: string; status: string; total_rows: number;
  new_count: number; duplicate_count: number; possible_match_count: number;
  invalid_count: number; committed_count: number; created_at: string;
};

type StagedContact = {
  id: string; row_number: number; first_name: string; last_name: string;
  email: string | null; phone: string | null; company: string | null;
  dedup_status: string; match_reason: string | null; matched_contact_id: string | null;
  matched_details: any; decision: string | null; invalid_reason: string | null;
};

type PoolStats = { total: number; by_status: Record<string, number> };

export default function ContactIngestion() {
  const [csvText, setCsvText] = useState("");
  const [sourceList, setSourceList] = useState("");
  const [uploading, setUploading] = useState(false);
  const [needsMapping, setNeedsMapping] = useState(false);
  const [headers, setHeaders] = useState<string[]>([]);
  const [manualMapping, setManualMapping] = useState({ first_name: "", last_name: "", name: "", email: "", phone: "", company: "" });

  const [session, setSession] = useState<Session | null>(null);
  const [staged, setStaged] = useState<StagedContact[]>([]);
  const [decisions, setDecisions] = useState<Record<string, string>>({});
  const [committing, setCommitting] = useState(false);
  const [commitResult, setCommitResult] = useState<any>(null);

  const [sessions, setSessions] = useState<Session[]>([]);
  const [stats, setStats] = useState<PoolStats | null>(null);
  const [activeTab, setActiveTab] = useState("upload");

  useEffect(() => { fetchStats(); fetchSessions(); }, []);

  const fetchStats = async () => {
    try { const res = await fetch(`${API_BASE}/contacts/stats`); setStats(await res.json()); } catch {}
  };
  const fetchSessions = async () => {
    try { const res = await fetch(`${API_BASE}/contacts/uploads`); const data = await res.json(); setSessions(data.sessions || []); } catch {}
  };

  const handleUpload = async (mapping?: any) => {
    setUploading(true); setNeedsMapping(false); setSession(null); setStaged([]); setCommitResult(null);
    try {
      const res = await fetch(`${API_BASE}/contacts/uploads`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ csv_text: csvText, source_list: sourceList, column_mapping: mapping || undefined }),
      });
      const data = await res.json();
      if (data.needs_mapping) { setNeedsMapping(true); setHeaders(data.headers || []); return; }
      setSession(data.session); setStaged(data.staged || []); setActiveTab("review");
      const defaults: Record<string, string> = {};
      for (const s of data.staged || []) { if (s.dedup_status === "possible_match") defaults[s.id] = "skip"; }
      setDecisions(defaults);
    } catch {} finally { setUploading(false); }
  };

  const handleMappingSubmit = () => {
    const mapping: any = {};
    if (manualMapping.first_name && manualMapping.last_name) {
      mapping.first_name = manualMapping.first_name; mapping.last_name = manualMapping.last_name;
    } else if (manualMapping.name) { mapping.name = manualMapping.name; mapping.first_name = ""; mapping.last_name = ""; }
    else return;
    if (manualMapping.email) mapping.email = manualMapping.email;
    if (manualMapping.phone) mapping.phone = manualMapping.phone;
    if (manualMapping.company) mapping.company = manualMapping.company;
    handleUpload(mapping);
  };

  const saveDecisions = async () => {
    if (!session) return;
    await fetch(`${API_BASE}/contacts/uploads/${session.id}/decisions`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decisions }),
    });
  };

  const handleCommit = async () => {
    if (!session) return; setCommitting(true);
    try {
      await saveDecisions();
      const res = await fetch(`${API_BASE}/contacts/uploads/${session.id}/commit`, { method: "POST" });
      setCommitResult(await res.json()); await fetchStats(); await fetchSessions();
    } catch (err: any) { setCommitResult({ error: err.message }); }
    finally { setCommitting(false); }
  };

  const loadSession = async (sessionId: string) => {
    try {
      const res = await fetch(`${API_BASE}/contacts/uploads/${sessionId}`); const data = await res.json();
      setSession(data.session); setStaged(data.staged || []); setActiveTab("review"); setCommitResult(null);
      const defaults: Record<string, string> = {};
      for (const s of data.staged || []) { if (s.dedup_status === "possible_match") defaults[s.id] = s.decision || "skip"; }
      setDecisions(defaults);
    } catch {}
  };

  const resetUpload = () => {
    setSession(null); setStaged([]); setCommitResult(null); setCsvText(""); setSourceList("");
    setNeedsMapping(false); setActiveTab("upload");
  };

  const newContacts = staged.filter(s => s.dedup_status === "new");
  const duplicates = staged.filter(s => s.dedup_status === "exact_duplicate");
  const possibleMatches = staged.filter(s => s.dedup_status === "possible_match");
  const invalidRows = staged.filter(s => s.dedup_status === "invalid");
  const pendingSessions = sessions.filter(s => s.status === "ready_for_review");
  const rowCount = csvText.trim().split("\n").filter(l => l.trim()).length - 1;

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      {/* Header with stats */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Contact Ingestion</h1>
          <p className="text-muted-foreground mt-1">Upload and manage your outreach contact pool.</p>
        </div>
      </div>

      {/* Stats cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-1"><Database className="w-3.5 h-3.5" /> Total Pool</CardDescription>
            <CardTitle className="text-3xl">{stats?.total?.toLocaleString() || 0}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">All contacts across all lists</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-1"><UserCheck className="w-3.5 h-3.5" /> Available</CardDescription>
            <CardTitle className="text-3xl">{(stats?.by_status?.pool || 0).toLocaleString()}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">Ready for campaign dispatch</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-1"><FileSpreadsheet className="w-3.5 h-3.5" /> Lists Uploaded</CardDescription>
            <CardTitle className="text-3xl">{sessions.filter(s => s.status === "committed").length}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">Successfully imported</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-1"><AlertTriangle className="w-3.5 h-3.5" /> Pending Review</CardDescription>
            <CardTitle className="text-3xl">{pendingSessions.length}</CardTitle>
          </CardHeader>
          <CardContent>
            {pendingSessions.length > 0 ? (
              <button onClick={() => setActiveTab("history")} className="text-xs text-primary hover:underline flex items-center gap-1">
                Review now <ArrowRight className="w-3 h-3" />
              </button>
            ) : (
              <p className="text-xs text-muted-foreground">No uploads waiting</p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Main tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="upload" className="gap-1"><Upload className="w-4 h-4" /> Upload</TabsTrigger>
          <TabsTrigger value="review" className="gap-1" disabled={!session}>
            <ShieldCheck className="w-4 h-4" /> Review
            {session && session.status === "ready_for_review" && (
              <Badge variant="secondary" className="ml-1 text-xs px-1.5 py-0">{session.possible_match_count}</Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="history" className="gap-1">
            <History className="w-4 h-4" /> History
            {pendingSessions.length > 0 && (
              <Badge variant="destructive" className="ml-1 text-xs px-1.5 py-0">{pendingSessions.length}</Badge>
            )}
          </TabsTrigger>
        </TabsList>

        {/* ===== UPLOAD TAB ===== */}
        <TabsContent value="upload" className="space-y-4">
          {commitResult && (
            <Card className={commitResult.error ? "border-destructive" : "border-green-500"}>
              <CardContent className="pt-6">
                <div className="flex items-center gap-3">
                  {commitResult.error ? (
                    <><XCircle className="w-6 h-6 text-destructive" /><div><p className="font-medium">Import Failed</p><p className="text-sm text-destructive">{commitResult.error}</p></div></>
                  ) : (
                    <><CheckCircle className="w-6 h-6 text-green-600" /><div>
                      <p className="font-medium">Import Complete</p>
                      <p className="text-sm text-muted-foreground">
                        {commitResult.created} created, {commitResult.updated} updated, {commitResult.skipped} skipped
                        {commitResult.errors > 0 && <span className="text-destructive">, {commitResult.errors} errors</span>}
                      </p>
                    </div></>
                  )}
                </div>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle>Upload Contact List</CardTitle>
              <CardDescription>
                Paste CSV data below. Supports both separate "first_name, last_name" columns and a single "name" column (auto-split).
                Every row needs at least a name and either an email or phone number.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-sm font-medium">Source List Name <span className="text-destructive">*</span></label>
                  <Input value={sourceList} onChange={e => setSourceList(e.target.value)} placeholder="e.g. London HNW List March 2026" />
                  <p className="text-xs text-muted-foreground">A label to identify this batch of contacts.</p>
                </div>
                <div className="flex items-end">
                  <div className="rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground space-y-1 w-full">
                    <p className="font-medium text-foreground">Accepted formats:</p>
                    <p>first_name, last_name, email, phone, company</p>
                    <p>name, email, phone, company</p>
                    <p>Custom headers (you'll map them)</p>
                  </div>
                </div>
              </div>

              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-medium">CSV Data <span className="text-destructive">*</span></label>
                  {csvText.trim() && rowCount > 0 && (
                    <span className="text-xs text-muted-foreground">{rowCount} data row{rowCount !== 1 ? "s" : ""} detected</span>
                  )}
                </div>
                <Textarea value={csvText} onChange={e => setCsvText(e.target.value)}
                  placeholder={"first_name,last_name,email,phone,company\nJohn,Smith,john@example.com,07700900123,Acme Corp\nJane,Doe,jane@example.com,07700900456,Beta Ltd\nBob,Wilson,bob@wilson.co.uk,02079460123,Wilson Capital"}
                  rows={12} className="font-mono text-sm" />
              </div>

              <div className="flex items-center gap-3">
                <Button size="lg" onClick={() => handleUpload()} disabled={uploading || !csvText.trim() || !sourceList.trim()}>
                  {uploading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Upload className="w-4 h-4 mr-2" />}
                  Upload & Analyse
                </Button>
                {uploading && <span className="text-sm text-muted-foreground">Parsing, normalising, and checking for duplicates...</span>}
              </div>
            </CardContent>
          </Card>

          {/* Column Mapping */}
          {needsMapping && (
            <Card className="border-yellow-500">
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><HelpCircle className="w-5 h-5 text-yellow-500" /> Column Mapping Required</CardTitle>
                <CardDescription>We couldn't auto-detect your columns. Please map them manually.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                  {[
                    { key: "first_name", label: "First Name" },
                    { key: "last_name", label: "Last Name" },
                    { key: "name", label: "Full Name (if single column)" },
                    { key: "email", label: "Email" },
                    { key: "phone", label: "Phone" },
                    { key: "company", label: "Company" },
                  ].map(field => (
                    <div key={field.key} className="space-y-1">
                      <label className="text-sm font-medium">{field.label}</label>
                      <Select value={(manualMapping as any)[field.key]} onValueChange={v => setManualMapping(m => ({ ...m, [field.key]: v === "__none__" ? "" : v }))}>
                        <SelectTrigger><SelectValue placeholder="Select column..." /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none__">-- Not mapped --</SelectItem>
                          {headers.map(h => <SelectItem key={h} value={h}>{h}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">Map either First Name + Last Name, or a single Full Name column. Email or Phone is required.</p>
                <Button onClick={handleMappingSubmit} disabled={!manualMapping.first_name && !manualMapping.name}>
                  Apply Mapping & Continue
                </Button>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* ===== REVIEW TAB ===== */}
        <TabsContent value="review" className="space-y-4">
          {session && session.status === "ready_for_review" && !commitResult && (
            <>
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle>Reviewing: {session.source_list}</CardTitle>
                      <CardDescription>{session.total_rows} rows parsed and analysed against your existing pool.</CardDescription>
                    </div>
                    <div className="flex gap-2">
                      <Button onClick={handleCommit} disabled={committing}>
                        {committing ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <CheckCircle className="w-4 h-4 mr-2" />}
                        Commit {session.new_count + Object.values(decisions).filter(d => d === "update" || d === "create").length} Contacts
                      </Button>
                      <Button variant="outline" onClick={resetUpload}>Cancel</Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-4 gap-3">
                    <div className="rounded-lg bg-green-50 dark:bg-green-950/20 p-3 text-center">
                      <p className="text-2xl font-bold text-green-700 dark:text-green-400">{session.new_count}</p>
                      <p className="text-xs text-green-600 dark:text-green-500">New contacts</p>
                    </div>
                    <div className="rounded-lg bg-slate-50 dark:bg-slate-950/20 p-3 text-center">
                      <p className="text-2xl font-bold text-slate-600 dark:text-slate-400">{session.duplicate_count}</p>
                      <p className="text-xs text-slate-500">Duplicates (skip)</p>
                    </div>
                    <div className="rounded-lg bg-yellow-50 dark:bg-yellow-950/20 p-3 text-center">
                      <p className="text-2xl font-bold text-yellow-700 dark:text-yellow-400">{session.possible_match_count}</p>
                      <p className="text-xs text-yellow-600 dark:text-yellow-500">Need your decision</p>
                    </div>
                    <div className="rounded-lg bg-red-50 dark:bg-red-950/20 p-3 text-center">
                      <p className="text-2xl font-bold text-red-600 dark:text-red-400">{session.invalid_count}</p>
                      <p className="text-xs text-red-500">Invalid (skip)</p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Possible Matches — user decides */}
              {possibleMatches.length > 0 && (
                <Card className="border-yellow-200 dark:border-yellow-800">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-lg">
                      <AlertTriangle className="w-5 h-5 text-yellow-500" /> Possible Matches ({possibleMatches.length})
                    </CardTitle>
                    <CardDescription>These contacts look similar to existing records. Choose what to do with each one.</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>From CSV</TableHead>
                          <TableHead>Existing Contact</TableHead>
                          <TableHead>Why Matched</TableHead>
                          <TableHead className="w-40">Action</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {possibleMatches.map(pm => (
                          <TableRow key={pm.id}>
                            <TableCell>
                              <div className="font-medium">{pm.first_name} {pm.last_name}</div>
                              <div className="text-xs text-muted-foreground">{[pm.email, pm.phone, pm.company].filter(Boolean).join(" | ")}</div>
                            </TableCell>
                            <TableCell>
                              <div className="font-medium">{pm.matched_details?.first_name} {pm.matched_details?.last_name}</div>
                              <div className="text-xs text-muted-foreground">
                                {[pm.matched_details?.email, pm.matched_details?.phone, pm.matched_details?.company].filter(Boolean).join(" | ")}
                              </div>
                            </TableCell>
                            <TableCell><Badge variant="outline" className="text-xs">{pm.match_reason}</Badge></TableCell>
                            <TableCell>
                              <Select value={decisions[pm.id] || "skip"} onValueChange={v => setDecisions(d => ({ ...d, [pm.id]: v }))}>
                                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="skip">Skip</SelectItem>
                                  <SelectItem value="update">Update existing</SelectItem>
                                  <SelectItem value="create">Add as new</SelectItem>
                                </SelectContent>
                              </Select>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
              )}

              {/* Duplicates */}
              {duplicates.length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-lg">
                      <UserX className="w-5 h-5 text-muted-foreground" /> Exact Duplicates ({duplicates.length})
                    </CardTitle>
                    <CardDescription>These contacts already exist in your pool and will be skipped automatically.</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>From CSV</TableHead>
                          <TableHead>Existing Contact</TableHead>
                          <TableHead>Match Type</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {duplicates.map(d => (
                          <TableRow key={d.id} className="text-muted-foreground">
                            <TableCell>{d.first_name} {d.last_name}{d.company ? ` (${d.company})` : ""}</TableCell>
                            <TableCell>
                              <div>{d.matched_details?.first_name} {d.matched_details?.last_name}
                                {d.matched_details?.company && <span className="ml-1">({d.matched_details.company})</span>}
                              </div>
                              <div className="text-xs">{[d.matched_details?.email, d.matched_details?.phone].filter(Boolean).join(" | ")}</div>
                            </TableCell>
                            <TableCell><Badge variant="secondary" className="text-xs">{d.match_reason}</Badge></TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
              )}

              {/* New contacts preview */}
              {newContacts.length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-lg">
                      <UserCheck className="w-5 h-5 text-green-600" /> New Contacts ({newContacts.length})
                    </CardTitle>
                    <CardDescription>These will be added to your contact pool.</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>First Name</TableHead>
                          <TableHead>Last Name</TableHead>
                          <TableHead>Email</TableHead>
                          <TableHead>Phone</TableHead>
                          <TableHead>Company</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {newContacts.slice(0, 50).map(c => (
                          <TableRow key={c.id}>
                            <TableCell className="font-medium">{c.first_name}</TableCell>
                            <TableCell className="font-medium">{c.last_name}</TableCell>
                            <TableCell className="text-sm">{c.email || "—"}</TableCell>
                            <TableCell className="text-sm">{c.phone || "—"}</TableCell>
                            <TableCell className="text-sm">{c.company || "—"}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                    {newContacts.length > 50 && (
                      <p className="text-sm text-muted-foreground mt-2 text-center">Showing first 50 of {newContacts.length} new contacts.</p>
                    )}
                  </CardContent>
                </Card>
              )}

              {/* Invalid */}
              {invalidRows.length > 0 && (
                <Card className="border-destructive/30">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-lg">
                      <XCircle className="w-5 h-5 text-destructive" /> Invalid Rows ({invalidRows.length})
                    </CardTitle>
                    <CardDescription>These rows have missing or invalid data and will be skipped.</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-1 text-sm">
                      {invalidRows.map(inv => (
                        <div key={inv.id} className="flex items-center gap-2 text-muted-foreground">
                          <Badge variant="outline" className="text-xs shrink-0">Row {inv.row_number}</Badge>
                          {inv.invalid_reason}
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}
            </>
          )}

          {session && session.status === "committed" && (
            <Card className="border-green-500">
              <CardContent className="pt-6 text-center space-y-3">
                <CheckCircle className="w-12 h-12 text-green-600 mx-auto" />
                <p className="text-lg font-medium">Upload Committed</p>
                <p className="text-muted-foreground">{session.committed_count} contacts imported from "{session.source_list}".</p>
                <Button onClick={resetUpload}>Upload Another List</Button>
              </CardContent>
            </Card>
          )}

          {!session && (
            <Card>
              <CardContent className="pt-6 text-center text-muted-foreground py-12">
                <Upload className="w-8 h-8 mx-auto mb-3 opacity-50" />
                <p>Upload a CSV file from the Upload tab to review it here.</p>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* ===== HISTORY TAB ===== */}
        <TabsContent value="history">
          <Card>
            <CardHeader>
              <CardTitle>Upload History</CardTitle>
              <CardDescription>All previous contact list uploads and their status.</CardDescription>
            </CardHeader>
            <CardContent>
              {sessions.length === 0 ? (
                <div className="text-center text-muted-foreground py-8">
                  <FileSpreadsheet className="w-8 h-8 mx-auto mb-3 opacity-50" />
                  <p>No uploads yet. Upload your first contact list to get started.</p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Source List</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Total Rows</TableHead>
                      <TableHead className="text-right">Imported</TableHead>
                      <TableHead className="text-right">Duplicates</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sessions.map(s => (
                      <TableRow key={s.id}>
                        <TableCell className="font-medium">{s.source_list}</TableCell>
                        <TableCell>
                          <Badge variant={
                            s.status === "committed" ? "default" :
                            s.status === "ready_for_review" ? "outline" :
                            s.status === "cancelled" ? "secondary" : "secondary"
                          }>
                            {s.status === "ready_for_review" ? "Pending Review" : s.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">{s.total_rows}</TableCell>
                        <TableCell className="text-right font-medium">{s.committed_count}</TableCell>
                        <TableCell className="text-right text-muted-foreground">{s.duplicate_count}</TableCell>
                        <TableCell className="text-muted-foreground text-sm">{new Date(s.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</TableCell>
                        <TableCell>
                          {s.status === "ready_for_review" && (
                            <Button variant="outline" size="sm" onClick={() => loadSession(s.id)}>
                              Review <ArrowRight className="w-3 h-3 ml-1" />
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
