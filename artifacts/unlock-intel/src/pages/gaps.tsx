import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { useGetContentGaps, useGenerateBrief, useGenerateFromBrief } from "@workspace/api-client-react";
import {
  Loader2,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Grid3X3,
  FileWarning,
  Zap,
  ChevronRight,
  Wand2,
  ArrowLeft,
  ChevronDown,
  Download,
  Eye,
  History,
  Save,
} from "lucide-react";
import { useLocation } from "wouter";

const API_BASE = import.meta.env.VITE_API_URL || "/api";

type ReadinessLevel = "SUFFICIENT" | "PARTIAL" | "INSUFFICIENT";

type SnapshotSummary = {
  id: string;
  created_at: string;
  total_gaps: number;
  matrix_gap_count: number;
  type_gap_count: number;
  recommendation_failure_count: number;
  file_path: string;
  notes: string;
};

function ReadinessIndicator({ status }: { status: ReadinessLevel }) {
  if (status === "SUFFICIENT") return <span className="inline-block w-3 h-3 rounded-full bg-emerald-500" title="Ready" />;
  if (status === "PARTIAL") return <span className="inline-block w-3 h-3 rounded-full bg-amber-500" title="Caveats" />;
  return <span className="inline-block w-3 h-3 rounded-full bg-red-500" title="Insufficient" />;
}

function OverallReadiness({ overall }: { overall: string }) {
  if (overall === "READY_TO_GENERATE") return <Badge className="bg-emerald-600 text-white">Ready to Generate</Badge>;
  if (overall === "CAN_GENERATE_WITH_CAVEATS") return <Badge className="bg-amber-600 text-white">Generate with Caveats</Badge>;
  return <Badge variant="destructive">Insufficient to Generate</Badge>;
}

export default function GapAnalysis() {
  const { data, isLoading, error } = useGetContentGaps();
  const briefMutation = useGenerateBrief();
  const generateMutation = useGenerateFromBrief();
  const [, navigate] = useLocation();

  const [selectedGap, setSelectedGap] = useState<any>(null);
  const [briefResult, setBriefResult] = useState<any>(null);
  const [editableBrief, setEditableBrief] = useState<any>(null);
  const [overrideGaps, setOverrideGaps] = useState(false);
  const [view, setView] = useState<"gaps" | "brief" | "generating">("gaps");

  const [historyOpen, setHistoryOpen] = useState(false);
  const [snapshots, setSnapshots] = useState<SnapshotSummary[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [editingNotes, setEditingNotes] = useState<Record<string, string>>({});
  const [viewingSnapshot, setViewingSnapshot] = useState<any>(null);

  const fetchHistory = async () => {
    setHistoryLoading(true);
    try {
      const res = await fetch(`${API_BASE}/content/gaps/history`);
      const json = await res.json();
      setSnapshots(json.snapshots || []);
    } catch {}
    setHistoryLoading(false);
  };

  useEffect(() => {
    if (historyOpen && snapshots.length === 0) fetchHistory();
  }, [historyOpen]);

  useEffect(() => {
    if (data && (data as any).snapshot_id) fetchHistory();
  }, [data]);

  const handleSaveNotes = async (id: string) => {
    const notes = editingNotes[id];
    if (notes === undefined) return;
    try {
      await fetch(`${API_BASE}/content/gaps/history/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes }),
      });
      setSnapshots((prev) => prev.map((s) => (s.id === id ? { ...s, notes } : s)));
      setEditingNotes((prev) => { const n = { ...prev }; delete n[id]; return n; });
    } catch {}
  };

  const handleViewSnapshot = async (id: string) => {
    try {
      const res = await fetch(`${API_BASE}/content/gaps/history/${id}`);
      const json = await res.json();
      setViewingSnapshot(json);
    } catch {}
  };

  const handleGenerateBrief = (gap: any) => {
    setSelectedGap(gap);
    setBriefResult(null);
    setEditableBrief(null);
    setView("brief");
    briefMutation.mutate(
      { data: { gap, information_readiness: data?.information_readiness } },
      { onSuccess: (res: any) => { setBriefResult(res); setEditableBrief({ ...res.brief }); } }
    );
  };

  const handleGenerateFromBrief = () => {
    if (!editableBrief) return;
    setView("generating");
    generateMutation.mutate(
      { data: { brief: editableBrief, override_information_gaps: overrideGaps } },
      { onSuccess: (res: any) => { if (res?.document?.id) navigate(`/registry/${res.document.id}`); } }
    );
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
        <span className="ml-3 text-muted-foreground">Analysing content coverage...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-64 text-destructive">
        <AlertTriangle className="w-6 h-6 mr-2" />
        Failed to load gap analysis
      </div>
    );
  }

  if (viewingSnapshot) {
    const vs = viewingSnapshot;
    const summary = vs.summary as any;
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="sm" onClick={() => setViewingSnapshot(null)}>
            <ArrowLeft className="w-4 h-4 mr-1" /> Back to Current
          </Button>
          <Badge variant="secondary">Viewing snapshot from {new Date(vs.created_at).toLocaleString()}</Badge>
        </div>
        <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-md text-sm text-amber-400">
          This is a read-only view of a historical gap analysis snapshot ({vs.id}).
        </div>
        <div className="grid grid-cols-4 gap-4">
          <Card><CardContent className="pt-6 text-center"><div className="text-2xl font-bold">{summary?.total_gaps ?? 0}</div><div className="text-xs text-muted-foreground">Total Gaps</div></CardContent></Card>
          <Card><CardContent className="pt-6 text-center"><div className="text-2xl font-bold">{summary?.matrix_gap_count ?? 0}</div><div className="text-xs text-muted-foreground">Matrix</div></CardContent></Card>
          <Card><CardContent className="pt-6 text-center"><div className="text-2xl font-bold">{summary?.type_gap_count ?? 0}</div><div className="text-xs text-muted-foreground">Type</div></CardContent></Card>
          <Card><CardContent className="pt-6 text-center"><div className="text-2xl font-bold">{summary?.recommendation_failure_count ?? 0}</div><div className="text-xs text-muted-foreground">Rec. Failures</div></CardContent></Card>
        </div>
        {(vs.matrix_gaps as any[])?.length > 0 && (
          <Card>
            <CardHeader><CardTitle>Matrix Gaps</CardTitle></CardHeader>
            <CardContent>
              <div className="space-y-1">
                {(vs.matrix_gaps as any[]).map((g: any, i: number) => (
                  <div key={i} className="flex items-center gap-3 p-2 bg-muted/50 rounded text-sm">
                    <span className="font-medium">{g.archetype}</span>
                    <ChevronRight className="w-3 h-3 text-muted-foreground" />
                    <span>{g.stage}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    );
  }

  if (view === "brief" || view === "generating") {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="sm" onClick={() => { setView("gaps"); setSelectedGap(null); }}>
            <ArrowLeft className="w-4 h-4 mr-1" /> Back to Gaps
          </Button>
          <h1 className="text-2xl font-bold tracking-tight">Content Brief</h1>
        </div>
        {selectedGap && (
          <Card className="border-primary/30">
            <CardHeader className="pb-3"><CardTitle className="text-sm font-medium text-muted-foreground">Gap Being Addressed</CardTitle></CardHeader>
            <CardContent>
              <div className="flex items-center gap-3">
                <Badge variant="outline">{selectedGap.gap_type}</Badge>
                <span className="text-sm">
                  {selectedGap.gap_type === "matrix" && `${selectedGap.archetype} × ${selectedGap.stage}`}
                  {selectedGap.gap_type === "type" && selectedGap.document_type}
                  {selectedGap.gap_type === "recommendation_failure" && `${selectedGap.persona} at ${selectedGap.stage}`}
                </span>
              </div>
            </CardContent>
          </Card>
        )}
        {briefMutation.isPending && (
          <div className="flex items-center justify-center h-32">
            <Loader2 className="w-6 h-6 animate-spin text-primary" />
            <span className="ml-3 text-muted-foreground">Generating content brief...</span>
          </div>
        )}
        {briefMutation.isError && (
          <Card className="border-destructive"><CardContent className="pt-6"><div className="flex items-center gap-2 text-destructive"><XCircle className="w-5 h-5" /><span>Failed to generate brief</span></div></CardContent></Card>
        )}
        {editableBrief && (
          <div className="space-y-4">
            <Card>
              <CardHeader><CardTitle>Generated Brief</CardTitle><CardDescription>Review and edit before generating content</CardDescription></CardHeader>
              <CardContent className="space-y-4">
                <div><label className="text-sm font-medium text-muted-foreground">Title</label><Input value={editableBrief.title} onChange={(e) => setEditableBrief({ ...editableBrief, title: e.target.value })} /></div>
                <div className="grid grid-cols-2 gap-4">
                  <div><label className="text-sm font-medium text-muted-foreground">Document Type</label><Input value={editableBrief.document_type} onChange={(e) => setEditableBrief({ ...editableBrief, document_type: e.target.value })} /></div>
                  <div><label className="text-sm font-medium text-muted-foreground">Tone</label><Input value={editableBrief.tone} onChange={(e) => setEditableBrief({ ...editableBrief, tone: e.target.value })} /></div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div><label className="text-sm font-medium text-muted-foreground">Archetypes</label><Input value={(editableBrief.archetypes || []).join(", ")} onChange={(e) => setEditableBrief({ ...editableBrief, archetypes: e.target.value.split(",").map((s: string) => s.trim()) })} /></div>
                  <div><label className="text-sm font-medium text-muted-foreground">Stages</label><Input value={(editableBrief.stages || []).join(", ")} onChange={(e) => setEditableBrief({ ...editableBrief, stages: e.target.value.split(",").map((s: string) => s.trim()) })} /></div>
                </div>
                <div><label className="text-sm font-medium text-muted-foreground">Length Guidance</label><Input value={editableBrief.length_guidance} onChange={(e) => setEditableBrief({ ...editableBrief, length_guidance: e.target.value })} /></div>
                <div><label className="text-sm font-medium text-muted-foreground">Key Messages</label><Textarea rows={4} value={(editableBrief.key_messages || []).join("\n")} onChange={(e) => setEditableBrief({ ...editableBrief, key_messages: e.target.value.split("\n").filter(Boolean) })} /></div>
                <div><label className="text-sm font-medium text-muted-foreground">Compliance Considerations</label><Textarea rows={3} value={(editableBrief.compliance_considerations || []).join("\n")} onChange={(e) => setEditableBrief({ ...editableBrief, compliance_considerations: e.target.value.split("\n").filter(Boolean) })} /></div>
                <div><label className="text-sm font-medium text-muted-foreground">Source Material Pointers</label><Textarea rows={3} value={(editableBrief.source_material_pointers || []).join("\n")} onChange={(e) => setEditableBrief({ ...editableBrief, source_material_pointers: e.target.value.split("\n").filter(Boolean) })} /></div>
              </CardContent>
            </Card>
            {editableBrief.information_needed?.length > 0 && (
              <Card className="border-red-500/50">
                <CardHeader><CardTitle className="text-red-400 flex items-center gap-2"><AlertTriangle className="w-5 h-5" /> Information Gaps Detected</CardTitle></CardHeader>
                <CardContent className="space-y-3">
                  {editableBrief.information_needed.map((item: any, i: number) => (
                    <div key={i} className="flex items-start gap-3 p-3 bg-red-500/10 rounded-lg">
                      <XCircle className="w-4 h-4 text-red-500 mt-0.5 flex-shrink-0" />
                      <div><p className="text-sm font-medium">{item.field}</p><p className="text-sm text-muted-foreground">{item.description}</p><Badge variant="outline" className="mt-1 text-xs">{item.source}</Badge></div>
                    </div>
                  ))}
                  <div className="flex items-center gap-3 pt-2 border-t border-border">
                    <input type="checkbox" id="override-gaps" checked={overrideGaps} onChange={(e) => setOverrideGaps(e.target.checked)} className="rounded" />
                    <label htmlFor="override-gaps" className="text-sm text-muted-foreground">Override — generate anyway (caveats will be added to content)</label>
                  </div>
                </CardContent>
              </Card>
            )}
            <div className="flex justify-end gap-3">
              <Button variant="outline" onClick={() => { setView("gaps"); setSelectedGap(null); }}>Cancel</Button>
              <Button onClick={handleGenerateFromBrief} disabled={generateMutation.isPending || (editableBrief.information_needed?.length > 0 && !overrideGaps)}>
                {generateMutation.isPending ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Generating...</> : <><Wand2 className="w-4 h-4 mr-2" /> Generate Content</>}
              </Button>
            </div>
            {generateMutation.isError && (
              <Card className="border-destructive"><CardContent className="pt-6"><div className="flex items-center gap-2 text-destructive"><XCircle className="w-5 h-5" /><span>Generation failed</span></div></CardContent></Card>
            )}
          </div>
        )}
      </div>
    );
  }

  const gaps = data!;
  const gapsAny = data as any;
  const insufficient = gaps.information_readiness.overall === "INSUFFICIENT_TO_GENERATE";

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Content Gap Analysis</h1>
          <p className="text-muted-foreground mt-1">Identify missing content across archetypes, stages, and document types</p>
        </div>
        <div className="flex items-center gap-3">
          <OverallReadiness overall={gaps.information_readiness.overall} />
          <Badge variant="outline" className="text-lg px-4 py-1">{gaps.summary.total_gaps} gaps</Badge>
        </div>
      </div>

      {gapsAny.snapshot_id && (
        <div className={`p-3 rounded-md text-sm flex items-center justify-between ${gapsAny.save_warning ? "bg-amber-500/10 border border-amber-500/30 text-amber-400" : "bg-emerald-500/10 border border-emerald-500/30 text-emerald-400"}`}>
          <div className="flex items-center gap-2">
            {gapsAny.save_warning ? <AlertTriangle className="w-4 h-4" /> : <Save className="w-4 h-4" />}
            {gapsAny.save_warning
              ? `Results shown but snapshot could not be saved — ${gapsAny.save_warning}`
              : `Snapshot saved — ${gapsAny.snapshot_id} · ${gapsAny.snapshot_file}`}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        <div className="lg:col-span-3 space-y-6">
          <Card>
            <CardHeader className="flex flex-row items-center gap-3">
              <Grid3X3 className="w-5 h-5 text-primary" />
              <div><CardTitle>Matrix Gaps ({gaps.summary.matrix_gap_count})</CardTitle><CardDescription>Archetype × stage combinations missing CLEAN + CURRENT documents</CardDescription></div>
            </CardHeader>
            <CardContent>
              {gaps.matrix_gaps.length === 0 ? (
                <div className="flex items-center gap-2 text-emerald-500"><CheckCircle2 className="w-5 h-5" /> All matrix cells covered</div>
              ) : (
                <div className="space-y-2">
                  {gaps.matrix_gaps.map((g: any, i: number) => (
                    <div key={i} className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                      <div className="flex items-center gap-3">
                        <ReadinessIndicator status={insufficient ? "INSUFFICIENT" : gaps.information_readiness.content_bank.status} />
                        <span className="text-sm font-medium">{g.archetype}</span>
                        <ChevronRight className="w-4 h-4 text-muted-foreground" />
                        <span className="text-sm">{g.stage}</span>
                        {g.existing_documents.length > 0 && <Badge variant="outline" className="text-xs">{g.existing_documents.length} partial</Badge>}
                      </div>
                      <Button size="sm" variant="outline" onClick={() => handleGenerateBrief(g)} disabled={insufficient}>Generate Brief</Button>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center gap-3">
              <FileWarning className="w-5 h-5 text-amber-500" />
              <div><CardTitle>Document Type Gaps ({gaps.summary.type_gap_count})</CardTitle><CardDescription>Required document types not present in the registry</CardDescription></div>
            </CardHeader>
            <CardContent>
              {gaps.type_gaps.length === 0 ? (
                <div className="flex items-center gap-2 text-emerald-500"><CheckCircle2 className="w-5 h-5" /> All required types covered</div>
              ) : (
                <div className="space-y-2">
                  {gaps.type_gaps.map((g: any, i: number) => (
                    <div key={i} className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                      <div className="flex items-center gap-3">
                        <ReadinessIndicator status={insufficient ? "INSUFFICIENT" : gaps.information_readiness.content_bank.status} />
                        <span className="text-sm font-medium">{g.document_type}</span>
                        {g.existing_documents.length > 0 && <Badge variant="outline" className="text-xs">{g.existing_documents.length} partial</Badge>}
                      </div>
                      <Button size="sm" variant="outline" onClick={() => handleGenerateBrief(g)} disabled={insufficient}>Generate Brief</Button>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center gap-3">
              <Zap className="w-5 h-5 text-red-500" />
              <div><CardTitle>Recommendation Failures ({gaps.summary.recommendation_failure_count})</CardTitle><CardDescription>Valid persona + stage combos returning zero recommendations</CardDescription></div>
            </CardHeader>
            <CardContent>
              {gaps.recommendation_gaps.length === 0 ? (
                <div className="flex items-center gap-2 text-emerald-500"><CheckCircle2 className="w-5 h-5" /> All recommendation paths covered</div>
              ) : (
                <div className="space-y-2">
                  {gaps.recommendation_gaps.map((g: any, i: number) => (
                    <div key={i} className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                      <div className="flex items-center gap-3">
                        <ReadinessIndicator status={insufficient ? "INSUFFICIENT" : gaps.information_readiness.content_bank.status} />
                        <span className="text-sm font-medium">{g.persona}</span>
                        <ChevronRight className="w-4 h-4 text-muted-foreground" />
                        <span className="text-sm">{g.stage}</span>
                      </div>
                      <Button size="sm" variant="outline" onClick={() => handleGenerateBrief({ ...g, archetype: g.persona })} disabled={insufficient}>Generate Brief</Button>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader><CardTitle className="text-sm">Information Readiness</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div>
                <div className="flex items-center gap-2 mb-1"><ReadinessIndicator status={gaps.information_readiness.content_bank.status} /><span className="text-sm font-medium">Content Bank</span></div>
                <p className="text-xs text-muted-foreground">{gaps.information_readiness.content_bank.detail}</p>
              </div>
              <div>
                <div className="flex items-center gap-2 mb-1"><ReadinessIndicator status={gaps.information_readiness.compliance_constants.status} /><span className="text-sm font-medium">Compliance Constants</span></div>
                <p className="text-xs text-muted-foreground">{gaps.information_readiness.compliance_constants.detail}</p>
                {gaps.information_readiness.compliance_constants.missing_fields?.length > 0 && (
                  <div className="mt-2 space-y-1">
                    {gaps.information_readiness.compliance_constants.missing_fields.map((f: string, i: number) => (
                      <div key={i} className="flex items-center gap-1 text-xs text-red-400"><XCircle className="w-3 h-3" /> {f}</div>
                    ))}
                  </div>
                )}
              </div>
              <div className="pt-3 border-t"><OverallReadiness overall={gaps.information_readiness.overall} /></div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-sm">Gap Summary</CardTitle></CardHeader>
            <CardContent>
              <div className="space-y-2">
                <div className="flex justify-between text-sm"><span className="text-muted-foreground">Matrix gaps</span><span className="font-medium">{gaps.summary.matrix_gap_count}</span></div>
                <div className="flex justify-between text-sm"><span className="text-muted-foreground">Type gaps</span><span className="font-medium">{gaps.summary.type_gap_count}</span></div>
                <div className="flex justify-between text-sm"><span className="text-muted-foreground">Rec. failures</span><span className="font-medium">{gaps.summary.recommendation_failure_count}</span></div>
                <div className="flex justify-between text-sm pt-2 border-t font-bold"><span>Total</span><span>{gaps.summary.total_gaps}</span></div>
              </div>
            </CardContent>
          </Card>

          {insufficient && (
            <Card className="border-red-500/50 bg-red-500/5">
              <CardContent className="pt-6">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="w-5 h-5 text-red-500 flex-shrink-0" />
                  <div><p className="text-sm font-medium text-red-400">Generation Disabled</p><p className="text-xs text-muted-foreground mt-1">Content bank or compliance constants are insufficient.</p></div>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      <Card>
        <CardHeader>
          <button className="w-full flex items-center justify-between" onClick={() => setHistoryOpen(!historyOpen)}>
            <div className="flex items-center gap-2">
              <History className="w-5 h-5 text-muted-foreground" />
              <CardTitle className="text-base">Previous Runs</CardTitle>
            </div>
            {historyOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
          </button>
        </CardHeader>
        {historyOpen && (
          <CardContent>
            {historyLoading ? (
              <div className="flex items-center justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
            ) : snapshots.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">No previous runs found.</p>
            ) : (
              <div className="space-y-3">
                {snapshots.map((snap, i) => {
                  const prev = snapshots[i + 1];
                  const diff = prev ? snap.total_gaps - prev.total_gaps : 0;
                  return (
                    <div key={snap.id} className="flex items-center justify-between p-3 bg-muted/30 rounded-lg">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-3">
                          <span className="text-sm font-mono font-medium">{snap.id}</span>
                          <span className="text-xs text-muted-foreground">{new Date(snap.created_at).toLocaleString()}</span>
                          <Badge variant="outline" className="text-xs">{snap.total_gaps} gaps</Badge>
                          {prev && (
                            <span className={`text-xs font-medium ${diff < 0 ? "text-emerald-400" : diff > 0 ? "text-red-400" : "text-muted-foreground"}`}>
                              {diff < 0 ? `↓ ${Math.abs(diff)} fewer` : diff > 0 ? `↑ ${diff} more` : "= No change"}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2 mt-1">
                          {editingNotes[snap.id] !== undefined ? (
                            <div className="flex items-center gap-2 flex-1">
                              <Input className="h-7 text-xs flex-1" value={editingNotes[snap.id]} onChange={(e) => setEditingNotes((p) => ({ ...p, [snap.id]: e.target.value }))} placeholder="Add a note..." autoFocus />
                              <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => handleSaveNotes(snap.id)}>Save</Button>
                              <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setEditingNotes((p) => { const n = { ...p }; delete n[snap.id]; return n; })}>Cancel</Button>
                            </div>
                          ) : (
                            <button className="text-xs text-muted-foreground hover:text-foreground" onClick={() => setEditingNotes((p) => ({ ...p, [snap.id]: snap.notes || "" }))}>
                              {snap.notes || "Add note..."}
                            </button>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0 ml-4">
                        <Button size="sm" variant="ghost" className="h-7 gap-1 text-xs" onClick={() => handleViewSnapshot(snap.id)}>
                          <Eye className="w-3 h-3" /> View
                        </Button>
                        <a href={`${API_BASE}/content/gaps/history/${snap.id}/export?format=json`} download>
                          <Button size="sm" variant="ghost" className="h-7 gap-1 text-xs"><Download className="w-3 h-3" /> JSON</Button>
                        </a>
                        <a href={`${API_BASE}/content/gaps/history/${snap.id}/export?format=markdown`} download>
                          <Button size="sm" variant="ghost" className="h-7 gap-1 text-xs"><Download className="w-3 h-3" /> MD</Button>
                        </a>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        )}
      </Card>
    </div>
  );
}
