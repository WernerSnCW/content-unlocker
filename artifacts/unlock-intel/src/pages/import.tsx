import { useState, useRef, useEffect, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Loader2, Upload, CheckCircle, XCircle, AlertTriangle, FileText, ArrowLeft, Sheet, RefreshCw, BookOpen, Info, Search, Copy, Check } from "lucide-react";

const API_BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";

const QUICK_UPDATE_RULES_TEXT = `QUICK VERSION UPDATE RULES — Unlock Content Intelligence Platform

When uploading a new version of an existing document:

- The uploaded file's entire content replaces the document's existing content.
- Version number is automatically incremented (v1 → v2, etc.).
- Review state is set to REQUIRES_REVIEW so it appears in the Work Queue for compliance checking.
- Word count is recalculated from the new content.
- Only CURRENT lifecycle documents can be updated.
- Accepted formats: .md and .txt (plain text, max 10MB).
- A changelog entry is created for audit tracking.

The file should contain the full document content in plain text or markdown. No special tags or headers are needed — just the content itself.`;

const BULK_IMPORT_RULES_TEXT = `BULK IMPORT PARSE RULES — Unlock Content Intelligence Platform

Files must be .md format with structured IMPORT_BLOCK tags. Each block defines one document to create or update.

FILE HEADER (optional):
<!-- IMPORT_FILE
title: My Import Batch
author: J. Smith
date: 2026-04-06
description: Q2 content refresh
-->

BLOCK FORMAT:
<!-- IMPORT_BLOCK
destination: document
action: create | update
key: Content_Bank          (for update: match by file_code or name)
id: uuid-here              (for update: match by exact ID)
title: My Document Title
tier: 1 | 2 | 3
category: core | campaign | operational
output_type: whitepaper | email | script
lifecycle_status: DRAFT | CURRENT
-->

Your document content goes here in markdown...

<!-- /IMPORT_BLOCK -->

RULES:
- "destination: document" is required on every block.
- "action: create" creates a new document in DRAFT status.
- "action: update" requires either "key" (matches file_code then name) or "id" (exact UUID match).
- Content is scanned for prohibited compliance values (22p, 7.8x, "safe", "series a", "£99/month", "£249/month", "advanced subscription agreement") — violations are rejected.
- Duplicate file uploads are detected via SHA-256 hash and blocked.
- Multiple blocks per file are supported — each is validated independently.`;

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }
  return (
    <Button variant="outline" size="sm" onClick={handleCopy} className="gap-1.5 text-xs">
      {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
      {copied ? "Copied" : "Copy Rules"}
    </Button>
  );
}

type Step = "upload" | "preview" | "summary";

interface BlockResult {
  index: number;
  destination: string;
  action: string;
  title?: string;
  status: string;
  error?: string;
  id?: string;
  key?: string;
  content?: string;
}

interface FileHeader {
  title?: string;
  author?: string;
  date?: string;
  description?: string;
}

interface ParseResponse {
  session_id: string;
  file_name: string;
  file_hash: string;
  file_header: FileHeader | null;
  total_blocks: number;
  valid_blocks: number;
  rejected_blocks: number;
  blocks: BlockResult[];
}

interface ExecuteResponse {
  session_id: string;
  status: string;
  executed_blocks: number;
  failed_blocks: number;
  block_results: BlockResult[];
}

interface ImportSession {
  id: string;
  file_name: string;
  status: string;
  total_blocks: number;
  valid_blocks: number;
  rejected_blocks: number;
  executed_blocks: number;
  failed_blocks: number;
  created_at: string;
}

interface SyncResult {
  session_id: string;
  status: string;
  rows_found: number;
  leads_created: number;
  leads_updated: number;
  leads_skipped: number;
  rows_failed: number;
}

interface SheetSyncSession extends SyncResult {
  id: string;
  sheet_url: string;
  error_message: string | null;
  created_at: string;
  completed_at: string | null;
}

function getStatusBadge(status: string) {
  switch (status) {
    case "VALID":
    case "EXECUTED":
    case "COMPLETE":
      return <Badge className="bg-emerald-600 text-white">{status}</Badge>;
    case "REJECTED":
    case "FAILED":
      return <Badge className="bg-red-600 text-white">{status}</Badge>;
    case "PARSED":
      return <Badge className="bg-blue-600 text-white">{status}</Badge>;
    case "PARTIAL":
      return <Badge className="bg-amber-500 text-white">{status}</Badge>;
    case "PENDING":
    case "EXECUTING":
    case "RUNNING":
      return <Badge className="bg-slate-500 text-white">{status}</Badge>;
    default:
      return <Badge>{status}</Badge>;
  }
}

function getActionBadge(action: string) {
  return action === "create" ? (
    <Badge className="bg-blue-600 text-white">create</Badge>
  ) : (
    <Badge className="bg-amber-500 text-white">update</Badge>
  );
}

interface DocOption {
  id: string;
  file_code: string;
  name: string;
  tier: number;
  version: number;
  lifecycle_status: string;
}

function QuickUpdateTab() {
  const [documents, setDocuments] = useState<DocOption[]>([]);
  const [docsLoading, setDocsLoading] = useState(true);
  const [selectedDocId, setSelectedDocId] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<{
    name: string;
    previous_version: number;
    new_version: number;
    word_count: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch(`${API_BASE}api/import/documents-list`)
      .then((r) => r.json())
      .then((data) => setDocuments(data.documents || []))
      .catch(() => {})
      .finally(() => setDocsLoading(false));
  }, []);

  const filteredDocs = useMemo(() => {
    if (!searchQuery.trim()) return documents;
    const q = searchQuery.toLowerCase();
    return documents.filter(
      (d) =>
        d.name.toLowerCase().includes(q) ||
        d.file_code.toLowerCase().includes(q)
    );
  }, [documents, searchQuery]);

  const selectedDoc = documents.find((d) => d.id === selectedDocId);

  async function handleUpload() {
    if (!selectedDocId || !selectedFile) return;
    setUploading(true);
    setError(null);
    setResult(null);
    try {
      const formData = new FormData();
      formData.append("file", selectedFile);
      formData.append("document_id", selectedDocId);
      const r = await fetch(`${API_BASE}api/import/quick-update`, {
        method: "POST",
        body: formData,
      });
      const data = await r.json();
      if (!r.ok) {
        setError(data.error || "Upload failed");
        return;
      }
      setResult(data);
    } catch (err: any) {
      setError(err.message || "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  function resetForm() {
    setSelectedDocId("");
    setSelectedFile(null);
    setResult(null);
    setError(null);
    setSearchQuery("");
    if (fileRef.current) fileRef.current.value = "";
  }

  if (result) {
    return (
      <div className="space-y-6">
        <Card className="border-emerald-800/50 bg-emerald-950/20">
          <CardContent className="py-6">
            <div className="flex items-center gap-3 mb-4">
              <CheckCircle className="w-6 h-6 text-emerald-400" />
              <span className="text-lg font-medium text-emerald-300">Version Updated</span>
            </div>
            <div className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm">
              <div><span className="text-muted-foreground">Document:</span> <span className="font-medium">{result.name}</span></div>
              <div><span className="text-muted-foreground">Version:</span> <span className="font-medium">v{result.previous_version} &rarr; v{result.new_version}</span></div>
              <div><span className="text-muted-foreground">Word count:</span> <span className="font-medium">{result.word_count.toLocaleString()}</span></div>
              <div><span className="text-muted-foreground">Review state:</span> <Badge className="bg-amber-500 text-white text-xs">REQUIRES_REVIEW</Badge></div>
            </div>
          </CardContent>
        </Card>
        <div className="flex gap-3">
          <Button variant="outline" onClick={resetForm}>
            <RefreshCw className="w-4 h-4 mr-2" />
            Update Another
          </Button>
          <Button variant="outline" asChild>
            <a href={`${import.meta.env.BASE_URL?.replace(/\/$/, "") || ""}/registry`}>View Registry</a>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="py-6 space-y-5">
          <div className="space-y-2">
            <label className="text-sm font-medium">1. Select document to update</label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search by name or file code..."
                className="w-full pl-10 pr-3 py-2 rounded border border-border bg-background text-sm"
              />
            </div>
            {docsLoading ? (
              <div className="flex items-center justify-center py-4">
                <Loader2 className="w-4 h-4 animate-spin" />
              </div>
            ) : (
              <div className="max-h-48 overflow-y-auto border border-border rounded">
                {filteredDocs.length === 0 ? (
                  <p className="text-xs text-muted-foreground px-3 py-2">No matching documents</p>
                ) : (
                  filteredDocs.map((d) => (
                    <div
                      key={d.id}
                      onClick={() => setSelectedDocId(d.id)}
                      className={`px-3 py-2 cursor-pointer text-sm flex items-center justify-between border-b border-border last:border-b-0 transition-colors ${
                        selectedDocId === d.id
                          ? "bg-blue-950/40 border-l-2 border-l-blue-500"
                          : "hover:bg-muted/30"
                      }`}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="font-mono text-xs text-muted-foreground shrink-0">{d.file_code}</span>
                        <span className="truncate">{d.name}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="text-xs">T{d.tier}</Badge>
                        <span className="text-xs text-muted-foreground">v{d.version}</span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}
            {selectedDoc && (
              <div className="flex items-center gap-2 text-sm bg-blue-950/20 border border-blue-800/30 rounded px-3 py-2">
                <FileText className="w-4 h-4 text-blue-400" />
                <span>Selected: <strong>{selectedDoc.name}</strong> (v{selectedDoc.version}, T{selectedDoc.tier})</span>
              </div>
            )}
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">2. Upload new version</label>
            <p className="text-xs text-muted-foreground">Upload a .md or .txt file. Its content will replace the document's current content.</p>
            <input
              ref={fileRef}
              type="file"
              accept=".md,.txt"
              className="hidden"
              onChange={(e) => {
                setSelectedFile(e.target.files?.[0] || null);
                setError(null);
              }}
            />
            <div className="flex items-center gap-3">
              <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
                Choose File
              </Button>
              {selectedFile && (
                <span className="text-sm flex items-center gap-1">
                  <FileText className="w-3 h-3" />
                  {selectedFile.name} ({(selectedFile.size / 1024).toFixed(1)} KB)
                </span>
              )}
            </div>
          </div>

          {error && (
            <div className="flex items-center gap-2 text-red-500 text-sm bg-red-950/30 p-3 rounded">
              <XCircle className="w-4 h-4 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div className="flex items-center gap-3 pt-2">
            <Button
              disabled={!selectedDocId || !selectedFile || uploading}
              onClick={handleUpload}
              className="bg-emerald-600 hover:bg-emerald-700"
            >
              {uploading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Update Document
            </Button>
            {selectedDoc && selectedFile && (
              <p className="text-xs text-muted-foreground">
                This will update <strong>{selectedDoc.name}</strong> from v{selectedDoc.version} to v{selectedDoc.version + 1} and set review state to REQUIRES_REVIEW.
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm flex items-center gap-2">
              <Info className="w-4 h-4" />
              Quick Update Rules
            </CardTitle>
            <CopyButton text={QUICK_UPDATE_RULES_TEXT} />
          </div>
        </CardHeader>
        <CardContent className="space-y-2 text-xs text-muted-foreground">
          <ul className="space-y-1.5 list-disc list-inside">
            <li>The uploaded file's entire content replaces the document's existing content</li>
            <li>Version number is automatically incremented (v1 &rarr; v2, etc.)</li>
            <li>Review state is set to <span className="font-mono text-amber-400">REQUIRES_REVIEW</span> so it appears in the Work Queue</li>
            <li>Word count is recalculated from the new content</li>
            <li>Only <span className="font-mono text-emerald-400">CURRENT</span> lifecycle documents are shown</li>
            <li>Accepted formats: <span className="font-mono">.md</span> and <span className="font-mono">.txt</span> (plain text, max 10MB)</li>
            <li>A changelog entry is created for audit tracking</li>
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}

function SheetSyncTab() {
  const [sheetUrl, setSheetUrl] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [sessions, setSessions] = useState<SheetSyncSession[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(true);

  async function fetchSessions() {
    try {
      const r = await fetch(`${API_BASE}api/sheet-sync/sessions`);
      if (r.ok) {
        const data = await r.json();
        setSessions(data.sessions || []);
      }
    } catch {
    } finally {
      setSessionsLoading(false);
    }
  }

  useEffect(() => {
    fetchSessions();
  }, []);

  async function handleSync() {
    setSyncing(true);
    setSyncResult(null);
    setSyncError(null);
    try {
      const r = await fetch(`${API_BASE}api/sheet-sync/sync`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sheet_url: sheetUrl }),
      });
      const data = await r.json();
      if (!r.ok) {
        setSyncError(data.error || "Sync failed");
        return;
      }
      setSyncResult(data);
      fetchSessions();
    } catch (err: any) {
      setSyncError(err.message || "Sync failed");
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="py-8">
          <div className="flex flex-col items-center justify-center gap-4">
            <div className="w-16 h-16 rounded-full bg-muted/50 flex items-center justify-center">
              <Sheet className="w-8 h-8 text-muted-foreground" />
            </div>
            <div className="text-center">
              <p className="font-medium">Sync from Google Sheet</p>
              <p className="text-sm text-muted-foreground mt-1">Paste a Google Sheet URL to import leads and transcripts.</p>
            </div>
            <input
              type="text"
              value={sheetUrl}
              onChange={(e) => setSheetUrl(e.target.value)}
              placeholder="https://docs.google.com/spreadsheets/d/..."
              className="w-full max-w-lg px-3 py-2 rounded border border-border bg-background text-sm"
            />
            <Button
              disabled={!sheetUrl.trim() || syncing}
              onClick={handleSync}
              className="bg-[#00C853] hover:bg-[#00B848] text-white"
            >
              {syncing && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Sync Now
            </Button>

            {syncError && (
              <div className="flex items-center gap-2 text-red-500 text-sm bg-red-950/30 p-3 rounded max-w-lg w-full">
                <XCircle className="w-4 h-4 flex-shrink-0" />
                <span>{syncError}</span>
              </div>
            )}

            {syncResult && (
              <Card className="w-full max-w-lg border-emerald-800/50 bg-emerald-950/20">
                <CardContent className="py-4">
                  <div className="flex items-center gap-2 mb-3">
                    <CheckCircle className="w-5 h-5 text-emerald-400" />
                    <span className="font-medium text-emerald-300">Sync Complete</span>
                    {getStatusBadge(syncResult.status)}
                  </div>
                  <div className="grid grid-cols-2 gap-x-8 gap-y-1 text-sm">
                    <div><span className="text-muted-foreground">Rows found:</span> <span className="font-medium">{syncResult.rows_found}</span></div>
                    <div><span className="text-muted-foreground">Leads created:</span> <span className="font-medium text-emerald-400">{syncResult.leads_created}</span></div>
                    <div><span className="text-muted-foreground">Leads updated:</span> <span className="font-medium text-blue-400">{syncResult.leads_updated}</span></div>
                    <div><span className="text-muted-foreground">Leads skipped:</span> <span className="font-medium">{syncResult.leads_skipped}</span></div>
                    <div><span className="text-muted-foreground">Rows failed:</span> <span className="font-medium text-red-400">{syncResult.rows_failed}</span></div>
                    <div><span className="text-muted-foreground">Session:</span> <span className="font-mono text-xs">{syncResult.session_id.substring(0, 8)}...</span></div>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Sync History</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {sessionsLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-5 h-5 animate-spin" />
            </div>
          ) : sessions.length === 0 ? (
            <p className="text-sm text-muted-foreground px-6 py-4">No sync sessions yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Sheet URL</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead>Updated</TableHead>
                  <TableHead>Skipped</TableHead>
                  <TableHead>Failed</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sessions.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell className="text-sm">{new Date(s.created_at).toLocaleDateString()}</TableCell>
                    <TableCell className="text-sm max-w-[200px] truncate" title={s.sheet_url}>{s.sheet_url.substring(0, 40)}...</TableCell>
                    <TableCell>{getStatusBadge(s.status)}</TableCell>
                    <TableCell className="text-sm text-emerald-400">{s.leads_created}</TableCell>
                    <TableCell className="text-sm text-blue-400">{s.leads_updated}</TableCell>
                    <TableCell className="text-sm">{s.leads_skipped}</TableCell>
                    <TableCell className="text-sm text-red-400">{s.rows_failed}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default function ImportPage() {
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<Step>("upload");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [parseResult, setParsResult] = useState<ParseResponse | null>(null);
  const [executeResult, setExecuteResult] = useState<ExecuteResponse | null>(null);
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const [duplicateSessionId, setDuplicateSessionId] = useState<string | null>(null);

  const { data: recentSessions, isLoading: sessionsLoading } = useQuery({
    queryKey: ["import-sessions"],
    queryFn: () =>
      fetch(`${API_BASE}api/import`).then((r) => {
        if (!r.ok) throw new Error("Failed to load sessions");
        return r.json();
      }),
  });

  const parseMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append("file", file);
      const r = await fetch(`${API_BASE}api/import/parse`, {
        method: "POST",
        body: formData,
      });
      const data = await r.json();
      if (r.status === 409) {
        setDuplicateSessionId(data.existing_session_id);
        throw new Error("This file has already been imported.");
      }
      if (!r.ok) throw new Error(data.error || "Parse failed");
      return data as ParseResponse;
    },
    onSuccess: (data) => {
      setParsResult(data);
      setParseError(null);
      setDuplicateSessionId(null);
      setStep("preview");
      queryClient.invalidateQueries({ queryKey: ["import-sessions"] });
    },
    onError: (err: any) => {
      setParseError(err.message);
    },
  });

  const executeMutation = useMutation({
    mutationFn: async (sessionId: string) => {
      const r = await fetch(`${API_BASE}api/import/${sessionId}/execute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmed: true }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "Execute failed");
      return data as ExecuteResponse;
    },
    onSuccess: (data) => {
      setExecuteResult(data);
      setStep("summary");
      queryClient.invalidateQueries({ queryKey: ["import-sessions"] });
    },
    onError: (err: any) => {
      setParseError(err.message);
    },
  });

  async function loadExistingSession(sessionId: string) {
    try {
      const r = await fetch(`${API_BASE}api/import/${sessionId}`);
      if (!r.ok) return;
      const session = await r.json();
      const blocks = (session.block_results || []) as BlockResult[];
      const validCount = blocks.filter((b: BlockResult) => b.status === "VALID").length;
      const rejectedCount = blocks.filter((b: BlockResult) => b.status === "REJECTED").length;

      if (session.status === "COMPLETE" || session.status === "PARTIAL" || session.status === "FAILED") {
        setExecuteResult({
          session_id: session.id,
          status: session.status,
          executed_blocks: session.executed_blocks,
          failed_blocks: session.failed_blocks,
          block_results: blocks,
        });
        setStep("summary");
      } else {
        setParsResult({
          session_id: session.id,
          file_name: session.file_name,
          file_hash: session.file_hash,
          file_header: null,
          total_blocks: session.total_blocks,
          valid_blocks: validCount,
          rejected_blocks: rejectedCount,
          blocks,
        });
        setStep("preview");
      }
      setParseError(null);
      setDuplicateSessionId(null);
    } catch {
    }
  }

  function resetToUpload() {
    setStep("upload");
    setSelectedFile(null);
    setParsResult(null);
    setExecuteResult(null);
    setParseError(null);
    setDuplicateSessionId(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  if (step === "summary" && executeResult) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Import Complete</h1>
          <p className="text-muted-foreground mt-1">
            {executeResult.executed_blocks} document(s) created/updated. {executeResult.failed_blocks} block(s) failed.
          </p>
        </div>

        <div className="flex items-center gap-3">
          {getStatusBadge(executeResult.status)}
          <span className="text-sm text-muted-foreground">Session: {executeResult.session_id.substring(0, 8)}…</span>
        </div>

        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-16">#</TableHead>
                  <TableHead>Title</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Error</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {executeResult.block_results.map((b) => (
                  <TableRow key={b.index} className={b.status === "FAILED" ? "bg-red-950/20" : ""}>
                    <TableCell className="font-mono text-xs">{b.index}</TableCell>
                    <TableCell className="font-medium">{b.title || "Untitled"}</TableCell>
                    <TableCell>{getActionBadge(b.action)}</TableCell>
                    <TableCell>{getStatusBadge(b.status)}</TableCell>
                    <TableCell className="text-sm text-red-400 max-w-[300px] truncate">{b.error || "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <div className="flex items-center gap-4">
          <Button variant="outline" onClick={resetToUpload}>
            Import another file
          </Button>
          <Button variant="outline" asChild>
            <a href={`${import.meta.env.BASE_URL?.replace(/\/$/, "") || ""}/registry`}>View Document Registry</a>
          </Button>
        </div>
      </div>
    );
  }

  if (step === "preview" && parseResult) {
    const validCount = parseResult.valid_blocks;
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="sm" onClick={resetToUpload}>
            <ArrowLeft className="w-4 h-4 mr-2" />
            Upload a different file
          </Button>
        </div>

        <div>
          <h1 className="text-2xl font-bold tracking-tight">Parse Preview</h1>
          <p className="text-muted-foreground mt-1">
            {parseResult.total_blocks} blocks found — {parseResult.valid_blocks} valid, {parseResult.rejected_blocks} rejected
          </p>
        </div>

        {parseResult.file_header && (
          <Card>
            <CardContent className="py-4">
              <div className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm">
                {parseResult.file_header.title && (
                  <div><span className="text-muted-foreground">Title:</span> <span className="font-medium">{parseResult.file_header.title}</span></div>
                )}
                {parseResult.file_header.author && (
                  <div><span className="text-muted-foreground">Author:</span> <span className="font-medium">{parseResult.file_header.author}</span></div>
                )}
                {parseResult.file_header.date && (
                  <div><span className="text-muted-foreground">Date:</span> <span className="font-medium">{parseResult.file_header.date}</span></div>
                )}
                {parseResult.file_header.description && (
                  <div className="col-span-2"><span className="text-muted-foreground">Description:</span> <span className="font-medium">{parseResult.file_header.description}</span></div>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {parseResult.blocks.length > 0 && parseResult.blocks.every((b) => b.status === "REJECTED") && (
          <div className="flex items-center gap-2 text-amber-400 bg-amber-950/30 border border-amber-800/50 rounded p-3">
            <AlertTriangle className="w-4 h-4 flex-shrink-0" />
            <span className="text-sm">No valid blocks to execute. All blocks were rejected.</span>
          </div>
        )}

        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-16">#</TableHead>
                  <TableHead>Title</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Error</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {parseResult.blocks.map((b) => (
                  <TableRow key={b.index} className={b.status === "REJECTED" ? "bg-red-950/20" : ""}>
                    <TableCell className="font-mono text-xs">{b.index}</TableCell>
                    <TableCell className="font-medium">{b.title || "Untitled"}</TableCell>
                    <TableCell>{getActionBadge(b.action)}</TableCell>
                    <TableCell>{getStatusBadge(b.status)}</TableCell>
                    <TableCell className="text-sm text-red-400 max-w-[300px] truncate">{b.error || "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Button
          disabled={validCount === 0 || executeMutation.isPending}
          onClick={() => setShowConfirmDialog(true)}
          className="bg-emerald-600 hover:bg-emerald-700"
        >
          Execute {validCount} block{validCount !== 1 ? "s" : ""}
        </Button>

        <Dialog open={showConfirmDialog} onOpenChange={setShowConfirmDialog}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Confirm Execution</DialogTitle>
              <DialogDescription>
                This will create/update {validCount} document{validCount !== 1 ? "s" : ""}. Continue?
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowConfirmDialog(false)}>Cancel</Button>
              <Button
                disabled={executeMutation.isPending}
                onClick={() => {
                  setShowConfirmDialog(false);
                  executeMutation.mutate(parseResult.session_id);
                }}
                className="bg-emerald-600 hover:bg-emerald-700"
              >
                {executeMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                Confirm
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Import Content</h1>
        <p className="text-muted-foreground mt-1">
          Import documents or sync leads from external sources.
        </p>
      </div>

      <Tabs defaultValue="quick-update">
        <TabsList>
          <TabsTrigger value="quick-update">Quick Version Update</TabsTrigger>
          <TabsTrigger value="import-document">Bulk Import</TabsTrigger>
          <TabsTrigger value="sheet-sync">Sync from Google Sheet</TabsTrigger>
        </TabsList>

        <TabsContent value="quick-update">
          <QuickUpdateTab />
        </TabsContent>

        <TabsContent value="import-document">
          <div className="space-y-6">
            <Card>
              <CardContent className="py-8">
                <div className="flex flex-col items-center justify-center gap-4">
                  <div className="w-16 h-16 rounded-full bg-muted/50 flex items-center justify-center">
                    <Upload className="w-8 h-8 text-muted-foreground" />
                  </div>
                  <div className="text-center">
                    <p className="font-medium">Upload .md file</p>
                    <p className="text-sm text-muted-foreground mt-1">Max 10MB. Must contain IMPORT_BLOCK sections.</p>
                  </div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".md"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0] || null;
                      setSelectedFile(file);
                      setParseError(null);
                      setDuplicateSessionId(null);
                    }}
                  />
                  <Button variant="outline" onClick={() => fileInputRef.current?.click()}>
                    Choose File
                  </Button>
                  {selectedFile && (
                    <div className="flex items-center gap-2 text-sm">
                      <FileText className="w-4 h-4" />
                      <span>{selectedFile.name}</span>
                      <span className="text-muted-foreground">({(selectedFile.size / 1024).toFixed(1)} KB)</span>
                    </div>
                  )}
                  {parseError && (
                    <div className="flex items-center gap-2 text-red-500 text-sm bg-red-950/30 p-3 rounded max-w-md">
                      <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                      <span>
                        {parseError}
                        {duplicateSessionId && (
                          <a
                            href="#"
                            className="block mt-1 text-xs text-blue-400 underline cursor-pointer"
                            onClick={(e) => {
                              e.preventDefault();
                              loadExistingSession(duplicateSessionId);
                            }}
                          >
                            View previous import session ({duplicateSessionId.substring(0, 8)}…)
                          </a>
                        )}
                      </span>
                    </div>
                  )}
                  <Button
                    disabled={!selectedFile || parseMutation.isPending}
                    onClick={() => selectedFile && parseMutation.mutate(selectedFile)}
                    className="bg-emerald-600 hover:bg-emerald-700"
                  >
                    {parseMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                    Parse File
                  </Button>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Recent Imports</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                {sessionsLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="w-5 h-5 animate-spin" />
                  </div>
                ) : (recentSessions?.sessions?.length ?? 0) === 0 ? (
                  <p className="text-sm text-muted-foreground px-6 py-4">No import sessions yet.</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Session</TableHead>
                        <TableHead>File</TableHead>
                        <TableHead>Date</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Blocks</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(recentSessions?.sessions || []).map((s: ImportSession) => (
                        <TableRow
                          key={s.id}
                          className="cursor-pointer hover:bg-muted/30"
                          onClick={() => loadExistingSession(s.id)}
                        >
                          <TableCell className="font-mono text-xs">{s.id.substring(0, 8)}…</TableCell>
                          <TableCell>{s.file_name}</TableCell>
                          <TableCell className="text-sm">{new Date(s.created_at).toLocaleDateString()}</TableCell>
                          <TableCell>{getStatusBadge(s.status)}</TableCell>
                          <TableCell className="text-sm">
                            {s.valid_blocks}/{s.total_blocks} valid
                            {s.executed_blocks > 0 && `, ${s.executed_blocks} executed`}
                            {s.failed_blocks > 0 && `, ${s.failed_blocks} failed`}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <BookOpen className="w-4 h-4" />
                    Bulk Import Parse Rules
                  </CardTitle>
                  <CopyButton text={BULK_IMPORT_RULES_TEXT} />
                </div>
              </CardHeader>
              <CardContent className="space-y-4 text-xs">
                <div>
                  <p className="text-muted-foreground mb-2">Files must be <span className="font-mono">.md</span> format with structured IMPORT_BLOCK tags. Each block defines one document to create or update.</p>
                </div>
                <div>
                  <p className="font-medium text-sm mb-1">File Header (optional)</p>
                  <pre className="bg-muted/30 rounded p-3 text-xs font-mono overflow-x-auto whitespace-pre">{`<!-- IMPORT_FILE
title: My Import Batch
author: J. Smith
date: 2026-04-06
description: Q2 content refresh
-->`}</pre>
                </div>
                <div>
                  <p className="font-medium text-sm mb-1">Block Format</p>
                  <pre className="bg-muted/30 rounded p-3 text-xs font-mono overflow-x-auto whitespace-pre">{`<!-- IMPORT_BLOCK
destination: document
action: create | update
key: Content_Bank          (for update: match by file_code or name)
id: uuid-here              (for update: match by exact ID)
title: My Document Title
tier: 1 | 2 | 3
category: core | campaign | operational
output_type: whitepaper | email | script
lifecycle_status: DRAFT | CURRENT
-->

Your document content goes here in markdown...

<!-- /IMPORT_BLOCK -->`}</pre>
                </div>
                <div>
                  <p className="font-medium text-sm mb-1">Rules</p>
                  <ul className="text-muted-foreground space-y-1 list-disc list-inside">
                    <li><span className="font-mono text-blue-400">destination: document</span> is required on every block</li>
                    <li><span className="font-mono text-blue-400">action: create</span> creates a new document in DRAFT status</li>
                    <li><span className="font-mono text-blue-400">action: update</span> requires either <span className="font-mono">key</span> (matches file_code then name) or <span className="font-mono">id</span></li>
                    <li>Content is scanned for prohibited compliance values (22p, 7.8x, "safe", series a, etc.) — violations are rejected</li>
                    <li>Duplicate file uploads are detected via SHA-256 hash and blocked</li>
                    <li>Multiple blocks per file are supported — each is validated independently</li>
                  </ul>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="sheet-sync">
          <SheetSyncTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
