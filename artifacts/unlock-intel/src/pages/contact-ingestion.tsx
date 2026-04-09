import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, Upload, CheckCircle, AlertTriangle, XCircle, Users, Clock, History } from "lucide-react";

const API_BASE = (import.meta.env.BASE_URL?.replace(/\/$/, "") || "") + "/api";

type Session = {
  id: string;
  source_list: string;
  status: string;
  total_rows: number;
  new_count: number;
  duplicate_count: number;
  possible_match_count: number;
  invalid_count: number;
  committed_count: number;
  created_at: string;
};

type StagedContact = {
  id: string;
  row_number: number;
  first_name: string;
  last_name: string;
  email: string | null;
  phone: string | null;
  company: string | null;
  dedup_status: string;
  match_reason: string | null;
  matched_contact_id: string | null;
  matched_details: any;
  decision: string | null;
  invalid_reason: string | null;
};

type PoolStats = { total: number; by_status: Record<string, number> };

export default function ContactIngestion() {
  const [csvText, setCsvText] = useState("");
  const [sourceList, setSourceList] = useState("");
  const [uploading, setUploading] = useState(false);
  const [needsMapping, setNeedsMapping] = useState(false);
  const [headers, setHeaders] = useState<string[]>([]);
  const [manualMapping, setManualMapping] = useState({ first_name: "", last_name: "", name: "", email: "", phone: "", company: "" });

  // Active session
  const [session, setSession] = useState<Session | null>(null);
  const [staged, setStaged] = useState<StagedContact[]>([]);
  const [decisions, setDecisions] = useState<Record<string, string>>({});
  const [committing, setCommitting] = useState(false);
  const [commitResult, setCommitResult] = useState<any>(null);

  // History & stats
  const [sessions, setSessions] = useState<Session[]>([]);
  const [stats, setStats] = useState<PoolStats | null>(null);
  const [showHistory, setShowHistory] = useState(false);

  useEffect(() => { fetchStats(); fetchSessions(); }, []);

  const fetchStats = async () => {
    try { const res = await fetch(`${API_BASE}/contacts/stats`); setStats(await res.json()); } catch {}
  };

  const fetchSessions = async () => {
    try { const res = await fetch(`${API_BASE}/contacts/uploads`); const data = await res.json(); setSessions(data.sessions || []); } catch {}
  };

  const handleUpload = async (mapping?: any) => {
    setUploading(true);
    setNeedsMapping(false);
    setSession(null);
    setStaged([]);
    setCommitResult(null);
    try {
      const res = await fetch(`${API_BASE}/contacts/uploads`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ csv_text: csvText, source_list: sourceList, column_mapping: mapping || undefined }),
      });
      const data = await res.json();
      if (data.needs_mapping) {
        setNeedsMapping(true);
        setHeaders(data.headers || []);
        return;
      }
      setSession(data.session);
      setStaged(data.staged || []);
      // Default decisions for possible matches
      const defaults: Record<string, string> = {};
      for (const s of data.staged || []) {
        if (s.dedup_status === "possible_match") defaults[s.id] = "skip";
      }
      setDecisions(defaults);
    } catch (err: any) {
      setSession(null);
    } finally {
      setUploading(false);
    }
  };

  const handleMappingSubmit = () => {
    const mapping: any = {};
    if (manualMapping.first_name && manualMapping.last_name) {
      mapping.first_name = manualMapping.first_name;
      mapping.last_name = manualMapping.last_name;
    } else if (manualMapping.name) {
      mapping.name = manualMapping.name;
      mapping.first_name = "";
      mapping.last_name = "";
    } else return;
    if (manualMapping.email) mapping.email = manualMapping.email;
    if (manualMapping.phone) mapping.phone = manualMapping.phone;
    if (manualMapping.company) mapping.company = manualMapping.company;
    handleUpload(mapping);
  };

  const saveDecisions = async () => {
    if (!session) return;
    await fetch(`${API_BASE}/contacts/uploads/${session.id}/decisions`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decisions }),
    });
  };

  const handleCommit = async () => {
    if (!session) return;
    setCommitting(true);
    try {
      await saveDecisions();
      const res = await fetch(`${API_BASE}/contacts/uploads/${session.id}/commit`, { method: "POST" });
      const data = await res.json();
      setCommitResult(data);
      await fetchStats();
      await fetchSessions();
    } catch (err: any) {
      setCommitResult({ error: err.message });
    } finally {
      setCommitting(false);
    }
  };

  const loadSession = async (sessionId: string) => {
    try {
      const res = await fetch(`${API_BASE}/contacts/uploads/${sessionId}`);
      const data = await res.json();
      setSession(data.session);
      setStaged(data.staged || []);
      setShowHistory(false);
      const defaults: Record<string, string> = {};
      for (const s of data.staged || []) {
        if (s.dedup_status === "possible_match") defaults[s.id] = s.decision || "skip";
      }
      setDecisions(defaults);
      setCommitResult(null);
    } catch {}
  };

  const newContacts = staged.filter(s => s.dedup_status === "new");
  const duplicates = staged.filter(s => s.dedup_status === "exact_duplicate");
  const possibleMatches = staged.filter(s => s.dedup_status === "possible_match");
  const invalidRows = staged.filter(s => s.dedup_status === "invalid");

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Contact Ingestion</h1>
          <p className="text-muted-foreground mt-1">Upload contact lists to build your outreach pool.</p>
        </div>
        <div className="flex items-center gap-3">
          {stats && (
            <div className="flex items-center gap-2 text-sm">
              <Users className="w-4 h-4 text-muted-foreground" />
              <span className="font-medium">{stats.total.toLocaleString()}</span>
              <span className="text-muted-foreground">in pool</span>
            </div>
          )}
          <Button variant="outline" size="sm" onClick={() => setShowHistory(!showHistory)}>
            <History className="w-4 h-4 mr-1" /> Upload History
          </Button>
        </div>
      </div>

      {/* Upload History */}
      {showHistory && (
        <Card>
          <CardHeader><CardTitle>Upload History</CardTitle></CardHeader>
          <CardContent>
            {sessions.length === 0 ? (
              <p className="text-muted-foreground text-center py-4">No uploads yet.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Source List</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Rows</TableHead>
                    <TableHead>Imported</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sessions.map(s => (
                    <TableRow key={s.id}>
                      <TableCell className="font-medium">{s.source_list}</TableCell>
                      <TableCell>
                        <Badge variant={s.status === "committed" ? "default" : s.status === "ready_for_review" ? "outline" : "secondary"}>
                          {s.status}
                        </Badge>
                      </TableCell>
                      <TableCell>{s.total_rows}</TableCell>
                      <TableCell>{s.committed_count}</TableCell>
                      <TableCell className="text-muted-foreground text-sm">{new Date(s.created_at).toLocaleDateString()}</TableCell>
                      <TableCell>
                        {s.status === "ready_for_review" && (
                          <Button variant="outline" size="sm" onClick={() => loadSession(s.id)}>Review</Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}

      {/* Upload Form */}
      {!session && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Upload className="w-5 h-5" /> Upload Contact List</CardTitle>
            <CardDescription>Paste CSV data. First row must be headers. Supports both "first_name, last_name" and single "name" column formats.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1">
              <label className="text-sm font-medium">Source List Name <span className="text-destructive">*</span></label>
              <Input value={sourceList} onChange={e => setSourceList(e.target.value)} placeholder="e.g. London HNW List March 2026" />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">CSV Data <span className="text-destructive">*</span></label>
              <Textarea value={csvText} onChange={e => setCsvText(e.target.value)}
                placeholder={"first_name,last_name,email,phone,company\nJohn,Smith,john@example.com,07700900123,Acme Corp\nJane,Doe,jane@example.com,07700900456,Beta Ltd"}
                rows={10} className="font-mono text-sm" />
            </div>
            <Button onClick={() => handleUpload()} disabled={uploading || !csvText.trim() || !sourceList.trim()}>
              {uploading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Upload & Analyse
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Column Mapping */}
      {needsMapping && (
        <Card>
          <CardHeader>
            <CardTitle>Column Mapping Required</CardTitle>
            <CardDescription>Select which CSV columns map to contact fields.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-4">
              {["first_name", "last_name", "name", "email", "phone", "company"].map(field => (
                <div key={field} className="space-y-1">
                  <label className="text-sm font-medium capitalize">{field.replace("_", " ")} {field === "first_name" || field === "last_name" ? "" : "(optional)"}</label>
                  <Select value={(manualMapping as any)[field]} onValueChange={v => setManualMapping(m => ({ ...m, [field]: v === "__none__" ? "" : v }))}>
                    <SelectTrigger><SelectValue placeholder="Select..." /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">None</SelectItem>
                      {headers.map(h => <SelectItem key={h} value={h}>{h}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">Use either first_name + last_name, or a single "name" column (will be auto-split).</p>
            <Button onClick={handleMappingSubmit} disabled={!manualMapping.first_name && !manualMapping.name}>Apply Mapping</Button>
          </CardContent>
        </Card>
      )}

      {/* Review Staged Data */}
      {session && session.status === "ready_for_review" && !commitResult && (
        <Card>
          <CardHeader>
            <CardTitle>Review: {session.source_list}</CardTitle>
            <CardDescription>{session.total_rows} rows parsed. Review and commit when ready.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex gap-3 flex-wrap">
              <Badge variant="default" className="py-1 px-3"><CheckCircle className="w-3.5 h-3.5 mr-1" /> {session.new_count} new</Badge>
              {session.duplicate_count > 0 && <Badge variant="secondary" className="py-1 px-3">{session.duplicate_count} duplicates</Badge>}
              {session.possible_match_count > 0 && <Badge variant="outline" className="py-1 px-3 border-yellow-500"><AlertTriangle className="w-3.5 h-3.5 mr-1 text-yellow-500" /> {session.possible_match_count} possible matches</Badge>}
              {session.invalid_count > 0 && <Badge variant="destructive" className="py-1 px-3"><XCircle className="w-3.5 h-3.5 mr-1" /> {session.invalid_count} invalid</Badge>}
            </div>

            {/* Duplicates */}
            {duplicates.length > 0 && (
              <div className="space-y-2">
                <h4 className="text-sm font-medium">Exact Duplicates (will be skipped)</h4>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>CSV Contact</TableHead>
                      <TableHead>Existing Match</TableHead>
                      <TableHead>Reason</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {duplicates.map(d => (
                      <TableRow key={d.id}>
                        <TableCell>{d.first_name} {d.last_name}{d.company ? ` (${d.company})` : ""}</TableCell>
                        <TableCell>
                          <div className="font-medium">{d.matched_details?.first_name} {d.matched_details?.last_name}
                            {d.matched_details?.company && <span className="text-muted-foreground ml-1">({d.matched_details.company})</span>}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {d.matched_details?.email}{d.matched_details?.email && d.matched_details?.phone ? " | " : ""}{d.matched_details?.phone}
                          </div>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">{d.match_reason}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}

            {/* Possible Matches */}
            {possibleMatches.length > 0 && (
              <div className="space-y-2">
                <h4 className="text-sm font-medium">Possible Matches — Choose Action</h4>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>CSV Contact</TableHead>
                      <TableHead>Existing Match</TableHead>
                      <TableHead>Reason</TableHead>
                      <TableHead>Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {possibleMatches.map(pm => (
                      <TableRow key={pm.id}>
                        <TableCell>{pm.first_name} {pm.last_name}{pm.company ? ` (${pm.company})` : ""}</TableCell>
                        <TableCell>
                          <div className="font-medium">{pm.matched_details?.first_name} {pm.matched_details?.last_name}
                            {pm.matched_details?.company && <span className="text-muted-foreground ml-1">({pm.matched_details.company})</span>}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {pm.matched_details?.email}{pm.matched_details?.email && pm.matched_details?.phone ? " | " : ""}{pm.matched_details?.phone}
                          </div>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">{pm.match_reason}</TableCell>
                        <TableCell>
                          <Select value={decisions[pm.id] || "skip"} onValueChange={v => setDecisions(d => ({ ...d, [pm.id]: v }))}>
                            <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
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
              </div>
            )}

            {/* Invalid */}
            {invalidRows.length > 0 && (
              <div className="space-y-2">
                <h4 className="text-sm font-medium text-destructive">Invalid Rows (skipped)</h4>
                <div className="text-sm space-y-1">
                  {invalidRows.map(inv => (
                    <div key={inv.id} className="text-muted-foreground">Row {inv.row_number}: {inv.invalid_reason}</div>
                  ))}
                </div>
              </div>
            )}

            {/* Commit */}
            <div className="flex gap-2 pt-2">
              <Button onClick={handleCommit} disabled={committing}>
                {committing && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                Commit {session.new_count + Object.values(decisions).filter(d => d === "update" || d === "create").length} Contacts
              </Button>
              <Button variant="outline" onClick={() => { setSession(null); setStaged([]); setCommitResult(null); }}>
                Cancel
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Commit Result */}
      {commitResult && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              {commitResult.error ? <><XCircle className="w-5 h-5 text-destructive" /> Import Failed</> : <><CheckCircle className="w-5 h-5 text-green-600" /> Import Complete</>}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {commitResult.error ? (
              <p className="text-destructive">{commitResult.error}</p>
            ) : (
              <div className="flex gap-4 text-sm">
                <span><strong>{commitResult.created}</strong> created</span>
                <span><strong>{commitResult.updated}</strong> updated</span>
                <span><strong>{commitResult.skipped}</strong> skipped</span>
                {commitResult.errors > 0 && <span className="text-destructive"><strong>{commitResult.errors}</strong> errors</span>}
              </div>
            )}
            <Button variant="outline" className="mt-4" onClick={() => { setSession(null); setStaged([]); setCommitResult(null); setCsvText(""); setSourceList(""); }}>
              Upload Another List
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
