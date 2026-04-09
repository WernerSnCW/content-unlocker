import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, Upload, CheckCircle, AlertTriangle, XCircle, Users } from "lucide-react";

const API_BASE = (import.meta.env.BASE_URL?.replace(/\/$/, "") || "") + "/api";

type PreviewData = {
  needs_mapping: boolean;
  mapping?: { name: string; email?: string; phone?: string; company?: string };
  headers?: string[];
  preview?: {
    total_rows: number;
    new_contacts: number;
    exact_duplicates: number;
    possible_matches: number;
    invalid: number;
  };
  new_contacts?: any[];
  exact_duplicates?: any[];
  possible_matches?: any[];
  invalid?: Array<{ row_number: number; reason: string }>;
  row_count?: number;
  message?: string;
};

type PoolStats = {
  total: number;
  by_status: Record<string, number>;
};

export default function ContactIngestion() {
  const [csvText, setCsvText] = useState("");
  const [sourceList, setSourceList] = useState("");
  const [previewing, setPreviewing] = useState(false);
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<any>(null);
  const [stats, setStats] = useState<PoolStats | null>(null);

  // Column mapping (when auto-detect fails)
  const [manualMapping, setManualMapping] = useState<{ name: string; email: string; phone: string; company: string }>({ name: "", email: "", phone: "", company: "" });

  // Decisions for possible matches
  const [decisions, setDecisions] = useState<Record<number, "skip" | "update" | "merge">>({});

  useEffect(() => { fetchStats(); }, []);

  const fetchStats = async () => {
    try {
      const res = await fetch(`${API_BASE}/contacts/stats`);
      const data = await res.json();
      setStats(data);
    } catch { /* ignore */ }
  };

  const handlePreview = async (mapping?: any) => {
    setPreviewing(true);
    setPreview(null);
    setImportResult(null);
    setDecisions({});
    try {
      const res = await fetch(`${API_BASE}/contacts/upload/preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          csv_text: csvText,
          source_list: sourceList,
          column_mapping: mapping || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setPreview(data);

      // Default all possible matches to "skip"
      if (data.possible_matches) {
        const defaults: Record<number, "skip" | "update" | "merge"> = {};
        for (const pm of data.possible_matches) {
          defaults[pm.row_number] = "skip";
        }
        setDecisions(defaults);
      }
    } catch (err: any) {
      setPreview({ needs_mapping: false, message: err.message } as any);
    } finally {
      setPreviewing(false);
    }
  };

  const handleImport = async () => {
    if (!preview?.mapping) return;
    setImporting(true);
    try {
      const res = await fetch(`${API_BASE}/contacts/upload/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          csv_text: csvText,
          column_mapping: preview.mapping,
          source_list: sourceList,
          decisions,
        }),
      });
      const data = await res.json();
      setImportResult(data);
      await fetchStats();
    } catch (err: any) {
      setImportResult({ error: err.message });
    } finally {
      setImporting(false);
    }
  };

  const handleMappingSubmit = () => {
    if (!manualMapping.name) return;
    handlePreview({
      name: manualMapping.name,
      email: manualMapping.email || undefined,
      phone: manualMapping.phone || undefined,
      company: manualMapping.company || undefined,
    });
  };

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Contact Ingestion</h1>
          <p className="text-muted-foreground mt-1">Upload contact lists to build your outreach pool.</p>
        </div>
        {stats && (
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 text-sm">
              <Users className="w-4 h-4 text-muted-foreground" />
              <span className="font-medium">{stats.total.toLocaleString()}</span>
              <span className="text-muted-foreground">contacts in pool</span>
            </div>
            {stats.by_status.pool !== undefined && (
              <Badge variant="outline">{stats.by_status.pool || 0} available</Badge>
            )}
          </div>
        )}
      </div>

      {/* Upload Section */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Upload className="w-5 h-5" /> Upload Contact List
          </CardTitle>
          <CardDescription>
            Paste CSV data with columns for name, email, phone, and company. The first row must be headers.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1">
            <label className="text-sm font-medium">Source List Name <span className="text-destructive">*</span></label>
            <Input
              value={sourceList}
              onChange={e => setSourceList(e.target.value)}
              placeholder="e.g. London HNW List March 2026"
            />
          </div>

          <div className="space-y-1">
            <label className="text-sm font-medium">CSV Data <span className="text-destructive">*</span></label>
            <Textarea
              value={csvText}
              onChange={e => setCsvText(e.target.value)}
              placeholder={"name,email,phone,company\nJohn Smith,john@example.com,07700900123,Acme Corp\nJane Doe,jane@example.com,07700900456,Beta Ltd"}
              rows={10}
              className="font-mono text-sm"
            />
          </div>

          <div className="flex gap-2">
            <Button onClick={() => handlePreview()} disabled={previewing || !csvText.trim() || !sourceList.trim()}>
              {previewing && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Preview & Check Duplicates
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Column Mapping (if auto-detect fails) */}
      {preview?.needs_mapping && (
        <Card>
          <CardHeader>
            <CardTitle>Column Mapping Required</CardTitle>
            <CardDescription>
              {preview.message || "Could not auto-detect columns."} Found {preview.row_count} data rows.
              Map your CSV columns below.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <label className="text-sm font-medium">Name column <span className="text-destructive">*</span></label>
                <Select value={manualMapping.name} onValueChange={v => setManualMapping(m => ({ ...m, name: v }))}>
                  <SelectTrigger><SelectValue placeholder="Select..." /></SelectTrigger>
                  <SelectContent>
                    {preview.headers?.map(h => <SelectItem key={h} value={h}>{h}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium">Email column</label>
                <Select value={manualMapping.email} onValueChange={v => setManualMapping(m => ({ ...m, email: v }))}>
                  <SelectTrigger><SelectValue placeholder="Select..." /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">None</SelectItem>
                    {preview.headers?.map(h => <SelectItem key={h} value={h}>{h}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium">Phone column</label>
                <Select value={manualMapping.phone} onValueChange={v => setManualMapping(m => ({ ...m, phone: v }))}>
                  <SelectTrigger><SelectValue placeholder="Select..." /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">None</SelectItem>
                    {preview.headers?.map(h => <SelectItem key={h} value={h}>{h}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium">Company column</label>
                <Select value={manualMapping.company} onValueChange={v => setManualMapping(m => ({ ...m, company: v }))}>
                  <SelectTrigger><SelectValue placeholder="Select..." /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">None</SelectItem>
                    {preview.headers?.map(h => <SelectItem key={h} value={h}>{h}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <Button onClick={handleMappingSubmit} disabled={!manualMapping.name}>
              Apply Mapping & Preview
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Preview Results */}
      {preview && !preview.needs_mapping && preview.preview && (
        <Card>
          <CardHeader>
            <CardTitle>Import Preview</CardTitle>
            <CardDescription>Review before importing. {preview.preview.total_rows} rows parsed.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Summary badges */}
            <div className="flex gap-3">
              <Badge variant="default" className="text-sm py-1 px-3">
                <CheckCircle className="w-3.5 h-3.5 mr-1" /> {preview.preview.new_contacts} new
              </Badge>
              <Badge variant="secondary" className="text-sm py-1 px-3">
                {preview.preview.exact_duplicates} duplicates (auto-skip)
              </Badge>
              {preview.preview.possible_matches > 0 && (
                <Badge variant="outline" className="text-sm py-1 px-3 border-yellow-500">
                  <AlertTriangle className="w-3.5 h-3.5 mr-1 text-yellow-500" /> {preview.preview.possible_matches} possible matches
                </Badge>
              )}
              {preview.preview.invalid > 0 && (
                <Badge variant="destructive" className="text-sm py-1 px-3">
                  <XCircle className="w-3.5 h-3.5 mr-1" /> {preview.preview.invalid} invalid
                </Badge>
              )}
            </div>

            {/* Possible matches — user decides */}
            {preview.possible_matches && preview.possible_matches.length > 0 && (
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
                    {preview.possible_matches.map((pm: any) => (
                      <TableRow key={pm.row_number}>
                        <TableCell className="font-medium">{pm.name}{pm.company ? ` (${pm.company})` : ""}</TableCell>
                        <TableCell>{pm.matched_name}</TableCell>
                        <TableCell className="text-muted-foreground text-sm">{pm.match_reason}</TableCell>
                        <TableCell>
                          <Select
                            value={decisions[pm.row_number] || "skip"}
                            onValueChange={(v: "skip" | "update" | "merge") => setDecisions(d => ({ ...d, [pm.row_number]: v }))}
                          >
                            <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="skip">Skip</SelectItem>
                              <SelectItem value="update">Update existing</SelectItem>
                              <SelectItem value="merge">Add as new</SelectItem>
                            </SelectContent>
                          </Select>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}

            {/* Invalid rows */}
            {preview.invalid && preview.invalid.length > 0 && (
              <div className="space-y-2">
                <h4 className="text-sm font-medium text-destructive">Invalid Rows (will be skipped)</h4>
                <div className="text-sm space-y-1">
                  {preview.invalid.map((inv: any) => (
                    <div key={inv.row_number} className="text-muted-foreground">
                      Row {inv.row_number}: {inv.reason}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Import button */}
            <div className="flex gap-2 pt-2">
              <Button onClick={handleImport} disabled={importing}>
                {importing && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                Import {preview.preview.new_contacts + Object.values(decisions).filter(d => d === "update" || d === "merge").length} Contacts
              </Button>
              <Button variant="outline" onClick={() => { setPreview(null); setImportResult(null); }}>
                Cancel
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Import Result */}
      {importResult && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              {importResult.error ? (
                <><XCircle className="w-5 h-5 text-destructive" /> Import Failed</>
              ) : (
                <><CheckCircle className="w-5 h-5 text-green-600" /> Import Complete</>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {importResult.error ? (
              <p className="text-destructive">{importResult.error}</p>
            ) : (
              <div className="flex gap-4 text-sm">
                <span><strong>{importResult.created}</strong> created</span>
                <span><strong>{importResult.updated}</strong> updated</span>
                <span><strong>{importResult.skipped}</strong> skipped</span>
                {importResult.errors > 0 && <span className="text-destructive"><strong>{importResult.errors}</strong> errors</span>}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
