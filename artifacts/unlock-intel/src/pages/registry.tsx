import { useListDocuments } from "@workspace/api-client-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { useState, useMemo, useRef } from "react";
import { Search, FileText, Upload, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Link } from "wouter";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

const ARCHETYPES = ["Growth Seeker", "Preserver", "Legacy Builder"];
const PIPELINE_STAGES = ["Outreach", "Called", "Demo Booked", "Demo Complete", "Decision"];

export default function Registry() {
  const [lifecycleStatus, setLifecycleStatus] = useState<string>("all");
  const [reviewState, setReviewState] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [showImportModal, setShowImportModal] = useState(false);

  const queryParams: any = {};
  if (lifecycleStatus !== "all") queryParams.lifecycle_status = lifecycleStatus;
  if (reviewState !== "all") queryParams.review_state = reviewState;

  const { data: documents, isLoading, refetch } = useListDocuments(queryParams);

  const filtered = useMemo(() => {
    if (!documents) return [];
    if (!search.trim()) return documents;
    const q = search.toLowerCase();
    return documents.filter(d =>
      d.name.toLowerCase().includes(q) ||
      d.file_code.toLowerCase().includes(q) ||
      d.category.toLowerCase().includes(q) ||
      (d.description || "").toLowerCase().includes(q)
    );
  }, [documents, search]);

  const groupedByTier = useMemo(() => {
    const tiers: Record<number, typeof filtered> = { 1: [], 2: [], 3: [] };
    filtered.forEach(d => {
      if (!tiers[d.tier]) tiers[d.tier] = [];
      tiers[d.tier].push(d);
    });
    return tiers;
  }, [filtered]);

  const tierLabels: Record<number, { label: string; desc: string; color: string }> = {
    1: { label: "Tier 1 — Core", desc: "Foundational documents. Updates cascade to Tier 2 and Tier 3.", color: "bg-red-500" },
    2: { label: "Tier 2 — Derived", desc: "Built from Tier 1. Updates cascade to Tier 3.", color: "bg-amber-500" },
    3: { label: "Tier 3 — Output", desc: "Final deliverables derived from upstream tiers.", color: "bg-blue-500" },
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "CURRENT": return <Badge variant="outline" className="border-green-200 text-green-700 bg-green-50">Current</Badge>;
      case "DRAFT": return <Badge variant="outline" className="border-amber-200 text-amber-700 bg-amber-50">Draft</Badge>;
      case "SUPERSEDED": return <Badge variant="outline" className="border-gray-200 text-gray-500 bg-gray-50">Superseded</Badge>;
      default: return null;
    }
  };

  const getReviewBadge = (state: string) => {
    switch (state) {
      case "CLEAN": return <Badge variant="outline" className="border-green-200 text-green-700 bg-green-50">Clean</Badge>;
      case "REQUIRES_REVIEW": return <Badge variant="destructive" className="bg-orange-500 hover:bg-orange-600">Needs Review</Badge>;
      case "REVIEWED": return <Badge variant="outline" className="border-blue-200 text-blue-700 bg-blue-50">Reviewed</Badge>;
      default: return null;
    }
  };

  const stats = useMemo(() => {
    if (!documents) return { total: 0, current: 0, draft: 0, needsReview: 0 };
    return {
      total: documents.length,
      current: documents.filter(d => d.lifecycle_status === "CURRENT").length,
      draft: documents.filter(d => d.lifecycle_status === "DRAFT").length,
      needsReview: documents.filter(d => d.review_state === "REQUIRES_REVIEW").length,
    };
  }, [documents]);

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-12">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Document Registry</h1>
          <p className="text-muted-foreground mt-1">Master index of all approved and draft collateral, organised by dependency tier.</p>
        </div>
        <Button onClick={() => setShowImportModal(true)} className="gap-2">
          <Upload className="w-4 h-4" />
          Import PDF
        </Button>
      </div>

      <div className="grid grid-cols-4 gap-4">
        <Card className="bg-card">
          <CardContent className="pt-4 pb-3">
            <div className="text-2xl font-bold">{stats.total}</div>
            <div className="text-xs text-muted-foreground">Total Documents</div>
          </CardContent>
        </Card>
        <Card className="bg-card">
          <CardContent className="pt-4 pb-3">
            <div className="text-2xl font-bold text-green-600">{stats.current}</div>
            <div className="text-xs text-muted-foreground">Current</div>
          </CardContent>
        </Card>
        <Card className="bg-card">
          <CardContent className="pt-4 pb-3">
            <div className="text-2xl font-bold text-amber-500">{stats.draft}</div>
            <div className="text-xs text-muted-foreground">Draft</div>
          </CardContent>
        </Card>
        <Card className="bg-card">
          <CardContent className="pt-4 pb-3">
            <div className="text-2xl font-bold text-orange-500">{stats.needsReview}</div>
            <div className="text-xs text-muted-foreground">Needs Review</div>
          </CardContent>
        </Card>
      </div>

      <div className="flex flex-col sm:flex-row items-center gap-4 bg-card p-4 rounded-lg border shadow-sm">
        <div className="relative flex-1 w-full">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search by name, file code, or category..."
            className="pl-9"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto">
          <Select value={lifecycleStatus} onValueChange={setLifecycleStatus}>
            <SelectTrigger className="w-[160px]">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              <SelectItem value="CURRENT">Current</SelectItem>
              <SelectItem value="DRAFT">Draft</SelectItem>
              <SelectItem value="SUPERSEDED">Superseded</SelectItem>
            </SelectContent>
          </Select>

          <Select value={reviewState} onValueChange={setReviewState}>
            <SelectTrigger className="w-[160px]">
              <SelectValue placeholder="Review State" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All States</SelectItem>
              <SelectItem value="CLEAN">Clean</SelectItem>
              <SelectItem value="REQUIRES_REVIEW">Requires Review</SelectItem>
              <SelectItem value="REVIEWED">Reviewed</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {isLoading ? (
        <div className="text-center py-12 text-muted-foreground">Loading documents...</div>
      ) : (
        <div className="space-y-8">
          {[1, 2, 3].map(tier => {
            const docs = groupedByTier[tier] || [];
            if (docs.length === 0) return null;
            const info = tierLabels[tier];
            return (
              <div key={tier} className="space-y-3">
                <div className="flex items-center gap-3">
                  <div className={`w-2 h-2 rounded-full ${info.color}`} />
                  <h2 className="text-lg font-semibold">{info.label}</h2>
                  <span className="text-xs text-muted-foreground">{info.desc}</span>
                  <Badge variant="secondary" className="ml-auto text-xs">{docs.length} docs</Badge>
                </div>
                <div className="border rounded-lg bg-card overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-[100px]">File Code</TableHead>
                        <TableHead className="w-[300px]">Name</TableHead>
                        <TableHead>Category</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Review</TableHead>
                        <TableHead>Version</TableHead>
                        <TableHead className="w-[50px]"></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {docs.map((doc) => (
                        <TableRow key={doc.id}>
                          <TableCell className="font-mono text-xs">{doc.file_code}</TableCell>
                          <TableCell>
                            <Link href={`/registry/${doc.id}`} className="font-medium hover:underline text-primary/90 flex items-center gap-1.5">
                              <FileText className="w-3.5 h-3.5 text-muted-foreground" />
                              {doc.name}
                            </Link>
                            {doc.description && (
                              <p className="text-xs text-muted-foreground mt-0.5 truncate max-w-[280px]">{doc.description}</p>
                            )}
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">{doc.category}</TableCell>
                          <TableCell>{getStatusBadge(doc.lifecycle_status)}</TableCell>
                          <TableCell>{getReviewBadge(doc.review_state)}</TableCell>
                          <TableCell className="text-muted-foreground text-sm">v{doc.version}</TableCell>
                          <TableCell>
                            <Link href={`/registry/${doc.id}`} className="text-xs text-muted-foreground hover:text-foreground">
                              View
                            </Link>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {showImportModal && (
        <ImportPdfModal
          onClose={() => setShowImportModal(false)}
          onSuccess={() => { setShowImportModal(false); refetch(); }}
        />
      )}
    </div>
  );
}

function ImportPdfModal({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState("");
  const [tier, setTier] = useState("3");
  const [personaRelevance, setPersonaRelevance] = useState<string[]>([]);
  const [stageRelevance, setStageRelevance] = useState<string[]>([]);
  const [notes, setNotes] = useState("");
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<any>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) {
      if (f.size > 10 * 1024 * 1024) {
        setError("File must be under 10MB");
        return;
      }
      setFile(f);
      if (!name) setName(f.name.replace(/\.pdf$/i, "").replace(/[_-]/g, " "));
      setError(null);
    }
  };

  const toggleItem = (list: string[], item: string, setter: (v: string[]) => void) => {
    setter(list.includes(item) ? list.filter(x => x !== item) : [...list, item]);
  };

  const handleSubmit = async () => {
    if (!file || !name.trim()) {
      setError("File and name are required");
      return;
    }
    setImporting(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("name", name.trim());
      formData.append("tier", tier);
      formData.append("persona_relevance", JSON.stringify(personaRelevance));
      formData.append("stage_relevance", JSON.stringify(stageRelevance));
      if (notes.trim()) formData.append("notes", notes.trim());

      const baseUrl = import.meta.env.VITE_API_URL || `${window.location.origin}/api`;
      const resp = await fetch(`${baseUrl}/documents/import-pdf`, {
        method: "POST",
        body: formData,
      });

      if (!resp.ok) {
        const err = await resp.json();
        throw new Error(err.message || err.error || "Import failed");
      }

      const data = await resp.json();
      setResult(data);
      setTimeout(onSuccess, 1500);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-background rounded-lg shadow-xl max-w-lg w-full mx-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-4 border-b">
          <h2 className="text-lg font-semibold">Import PDF</h2>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="w-4 h-4" />
          </Button>
        </div>

        <div className="p-4 space-y-4">
          {result ? (
            <div className="space-y-3">
              <div className="bg-green-50 border border-green-200 text-green-800 p-4 rounded-lg text-sm">
                <strong>Imported successfully!</strong>
                <div className="mt-2 space-y-1">
                  <div>Document ID: <code className="bg-green-100 px-1 rounded">{result.document_id}</code></div>
                  <div>Content extracted: {result.content_length.toLocaleString()} characters</div>
                  <div>Status: {result.review_state}</div>
                </div>
                <p className="mt-2 text-xs">{result.message}</p>
              </div>
            </div>
          ) : (
            <>
              <div>
                <label className="text-sm font-medium block mb-1.5">PDF File</label>
                <div
                  className="border-2 border-dashed rounded-lg p-6 text-center cursor-pointer hover:border-primary/50 transition-colors"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <input ref={fileInputRef} type="file" accept=".pdf" className="hidden" onChange={handleFileChange} />
                  {file ? (
                    <div className="text-sm">
                      <FileText className="w-8 h-8 mx-auto mb-2 text-primary" />
                      <div className="font-medium">{file.name}</div>
                      <div className="text-xs text-muted-foreground">{(file.size / 1024).toFixed(0)} KB</div>
                    </div>
                  ) : (
                    <div>
                      <Upload className="w-8 h-8 mx-auto mb-2 text-muted-foreground" />
                      <p className="text-sm text-muted-foreground">Click to select a PDF (max 10MB)</p>
                    </div>
                  )}
                </div>
              </div>

              <div>
                <label className="text-sm font-medium block mb-1.5">Document Name</label>
                <Input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Decumulation Planner — Investor Explainer" />
              </div>

              <div>
                <label className="text-sm font-medium block mb-1.5">Tier</label>
                <Select value={tier} onValueChange={setTier}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1">Tier 1 — Core</SelectItem>
                    <SelectItem value="2">Tier 2 — Derived</SelectItem>
                    <SelectItem value="3">Tier 3 — Output</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <label className="text-sm font-medium block mb-1.5">Persona Relevance</label>
                <div className="flex flex-wrap gap-2">
                  {ARCHETYPES.map(a => (
                    <Button
                      key={a}
                      variant={personaRelevance.includes(a) ? "default" : "outline"}
                      size="sm"
                      onClick={() => toggleItem(personaRelevance, a, setPersonaRelevance)}
                    >
                      {a}
                    </Button>
                  ))}
                </div>
              </div>

              <div>
                <label className="text-sm font-medium block mb-1.5">Stage Relevance</label>
                <div className="flex flex-wrap gap-2">
                  {PIPELINE_STAGES.map(s => (
                    <Button
                      key={s}
                      variant={stageRelevance.includes(s) ? "default" : "outline"}
                      size="sm"
                      onClick={() => toggleItem(stageRelevance, s, setStageRelevance)}
                    >
                      {s}
                    </Button>
                  ))}
                </div>
              </div>

              <div>
                <label className="text-sm font-medium block mb-1.5">Notes (optional)</label>
                <Textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="Source or context notes..." rows={2} />
              </div>

              {error && (
                <div className="bg-red-50 border border-red-200 text-red-800 p-3 rounded text-sm">{error}</div>
              )}

              <Button className="w-full" onClick={handleSubmit} disabled={importing || !file || !name.trim()}>
                {importing ? "Importing..." : "Import PDF"}
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
