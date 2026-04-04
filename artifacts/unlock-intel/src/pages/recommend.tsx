import { useState, useCallback, useRef, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useListLeads, useAnalyzeTranscript, useRankDocuments, useConfirmSend, useGenerateEmailDraft } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Search, Loader2, User, FileText, Send, AlertTriangle, Upload, X, CheckCircle, XCircle, ChevronDown, ChevronRight, Circle, Plus, Link2, UserPlus } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";

const API_BASE = import.meta.env.VITE_API_URL || "/api";

const NOISE_WORDS = new Set(["call", "recording", "transcript", "aircall", "call-recording", "rec", "audio", "voicemail", "vm"]);
const DATE_RX = [/\b\d{4}-\d{2}-\d{2}\b/g, /\b\d{2}-\d{2}-\d{4}\b/g, /\b\d{2}\/\d{2}\/\d{4}\b/g, /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*\s*\d{1,2}(?:\s*,?\s*\d{4})?\b/gi, /\b\d{1,2}\s*(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*(?:\s*\d{4})?\b/gi];

function extractNameFromFilename(filename: string): string | null {
  let name = filename.replace(/\.(txt|docx)$/i, "");
  name = name.replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();
  for (const rx of DATE_RX) name = name.replace(rx, " ");
  name = name.replace(/\s+/g, " ").trim();
  const words = name.split(" ").filter((w) => !NOISE_WORDS.has(w.toLowerCase()) && !/^\d+$/.test(w));
  if (words.length < 2 || words.length > 4) return null;
  if (words.some((w) => /\d/.test(w))) return null;
  const result = words.map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(" ");
  return result.length >= 3 ? result : null;
}

type BatchAnalysis = {
  persona: string;
  persona_confidence: number;
  stage: string;
  stage_confidence: number;
  objections: Array<{ objection: string; severity: string; suggested_response: string }> | string[];
  blocking_objections?: string[];
  evidence: string[];
  readiness_score?: number;
  primary_issue?: string;
  recommended_next_action?: string;
  information_gaps?: Array<{ gap: string; impact: string; suggested_document_type: string }>;
  questions_answered?: { Q1: boolean; Q2: boolean; Q3: boolean; Q4: boolean };
  call_completeness?: { questions_covered: number; questions_total: number; missing_signals: string[]; confidence_impact: string };
  transcript_summary?: string;
  pipeline_stage_suggestion?: string | null;
  matrix_context?: {
    eis_familiar: boolean;
    iht_confirmed: boolean;
    adviser_mentioned: boolean;
    derivation_notes?: { eis_familiar: string; iht_confirmed: string; adviser_mentioned: string };
  };
};

type LeadMatch = {
  lead_id: string;
  name: string;
  company: string;
  pipeline_stage: string;
  detected_persona: string;
  confidence: number;
};

type BatchResult = {
  filename: string;
  investor_name?: string | null;
  status: "success" | "error";
  analysis?: BatchAnalysis;
  error?: string;
  lead_match?: { matches: LeadMatch[]; status: "matched" | "partial" | "none" };
  linked_lead_id?: string;
  created_lead_id?: string;
};

const PRIMARY_ISSUE_CONFIG: Record<string, { label: string; color: string; bg: string; border: string; icon: string }> = {
  READY_TO_CLOSE: { label: "READY TO CLOSE", color: "text-green-400", bg: "bg-green-500/10", border: "border-green-500/30", icon: "\u{1F7E2}" },
  OBJECTION_TO_RESOLVE: { label: "OBJECTION TO RESOLVE", color: "text-amber-400", bg: "bg-amber-500/10", border: "border-amber-500/30", icon: "\u{1F7E1}" },
  INFORMATION_GAP: { label: "INFORMATION GAP", color: "text-red-400", bg: "bg-red-500/10", border: "border-red-500/30", icon: "\u{1F534}" },
  NEEDS_NURTURING: { label: "NEEDS NURTURING", color: "text-gray-400", bg: "bg-gray-500/10", border: "border-gray-500/30", icon: "\u26AA" },
};

export default function Recommend() {
  const [mode, setMode] = useState<"single" | "batch">("single");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null);
  const [transcript, setTranscript] = useState("");

  const [questionsChecked, setQuestionsChecked] = useState<Record<string, boolean>>({
    Q1: false, Q2: false, Q3: false, Q4: false,
  });
  const [checklistOpen, setChecklistOpen] = useState(false);

  const [batchFiles, setBatchFiles] = useState<File[]>([]);
  const [batchProcessing, setBatchProcessing] = useState(false);
  const [batchProgress, setBatchProgress] = useState({ current: 0, total: 0 });
  const [batchResults, setBatchResults] = useState<BatchResult[] | null>(null);
  const [batchError, setBatchError] = useState<string | null>(null);
  const [linkingIndex, setLinkingIndex] = useState<number | null>(null);
  const [linkSearch, setLinkSearch] = useState("");
  const [parsedNames, setParsedNames] = useState<Record<string, string>>({});
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [creatingLeadIndex, setCreatingLeadIndex] = useState<number | null>(null);

  const [detailPanels, setDetailPanels] = useState<Record<string, boolean>>({});
  const [batchDetailPanels, setBatchDetailPanels] = useState<Record<string, boolean>>({});
  const [gapBrief, setGapBrief] = useState<any>(null);
  const [gapBriefLoading, setGapBriefLoading] = useState(false);
  const [gapBriefError, setGapBriefError] = useState<string | null>(null);
  const [gapDocGenerating, setGapDocGenerating] = useState(false);
  const [gapDocResult, setGapDocResult] = useState<any>(null);
  const [matrixFlags, setMatrixFlags] = useState<{
    eis_familiar: boolean;
    iht_confirmed: boolean;
    adviser_mentioned: boolean;
    derivation_notes?: { eis_familiar: string; iht_confirmed: string; adviser_mentioned: string };
  } | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const q1 = params.get("Q1") === "1";
    const q2 = params.get("Q2") === "1";
    const q3 = params.get("Q3") === "1";
    const q4 = params.get("Q4") === "1";
    if (q1 || q2 || q3 || q4) {
      setQuestionsChecked({ Q1: q1, Q2: q2, Q3: q3, Q4: q4 });
      setChecklistOpen(true);
    }
  }, []);

  const { data: leads, isLoading: isLeadsLoading } = useListLeads({ search: searchQuery }, { query: { enabled: searchQuery.length > 0 } });
  const { data: linkLeads } = useListLeads({ search: linkSearch }, { query: { enabled: linkSearch.length > 0 } });

  const analyzeMutation = useAnalyzeTranscript();
  const rankMutation = useRankDocuments();
  const emailMutation = useGenerateEmailDraft();
  const confirmMutation = useConfirmSend();

  const coveredCount = Object.values(questionsChecked).filter(Boolean).length;

  const handleAnalyze = async () => {
    if (!transcript) return;

    const analysis = await analyzeMutation.mutateAsync({
      data: {
        transcript,
        lead_id: selectedLeadId,
        questions_answered: questionsChecked,
      } as any,
    });

    const mc = (analysis as any).matrix_context;
    const flags = mc ? {
      eis_familiar: mc.eis_familiar ?? false,
      iht_confirmed: mc.iht_confirmed ?? false,
      adviser_mentioned: mc.adviser_mentioned ?? false,
      derivation_notes: mc.derivation_notes,
    } : { eis_familiar: false, iht_confirmed: false, adviser_mentioned: false };
    setMatrixFlags(flags);

    const ranking = await rankMutation.mutateAsync({
      data: {
        lead_id: selectedLeadId,
        detected_persona: analysis.detected_persona.name,
        pipeline_stage: analysis.pipeline_stage.stage,
        transcript_summary: analysis.transcript_summary,
        objections: (analysis.objections || []).map((o: any) => o.objection),
        eis_familiar: flags.eis_familiar,
        iht_confirmed: flags.iht_confirmed,
        adviser_mentioned: flags.adviser_mentioned,
      },
    });

    const selectedLead = leads?.find((l) => l.id === selectedLeadId);
    if (selectedLead && ranking.ranked_documents.length > 0) {
      await emailMutation.mutateAsync({
        data: {
          lead_name: selectedLead.name,
          detected_persona: analysis.detected_persona.name,
          pipeline_stage: analysis.pipeline_stage.stage,
          transcript_summary: analysis.transcript_summary,
          document_names: ranking.ranked_documents.slice(0, 3).map((d) => d.name),
        },
      });
    }
  };

  const handleFlagToggle = async (flag: "eis_familiar" | "iht_confirmed" | "adviser_mentioned") => {
    if (!matrixFlags || !analyzeMutation.data) return;
    const updated = { ...matrixFlags, [flag]: !matrixFlags[flag] };
    setMatrixFlags(updated);
    const analysis = analyzeMutation.data;
    await rankMutation.mutateAsync({
      data: {
        lead_id: selectedLeadId,
        detected_persona: analysis.detected_persona.name,
        pipeline_stage: analysis.pipeline_stage.stage,
        transcript_summary: analysis.transcript_summary,
        objections: (analysis.objections || []).map((o: any) => o.objection),
        eis_familiar: updated.eis_familiar,
        iht_confirmed: updated.iht_confirmed,
        adviser_mentioned: updated.adviser_mentioned,
      },
    });
  };

  const handleConfirm = () => {
    if (!selectedLeadId || !analyzeMutation.data || !rankMutation.data) return;
    confirmMutation.mutate({
      data: {
        lead_id: selectedLeadId,
        document_ids: rankMutation.data.ranked_documents.map((d) => d.document_id),
        transcript_summary: analyzeMutation.data.transcript_summary,
        detected_persona: analyzeMutation.data.detected_persona.name,
        pipeline_stage: analyzeMutation.data.pipeline_stage.stage,
        analysis_confidence: {
          persona: analyzeMutation.data.detected_persona.confidence_score,
          stage: analyzeMutation.data.pipeline_stage.confidence_score,
        },
        email_sent: true,
      },
    });
  };

  const handleFilesSelected = useCallback((newFiles: FileList | File[]) => {
    const fileArray = Array.from(newFiles);
    setBatchError(null);
    const combined = [...batchFiles, ...fileArray];
    if (combined.length > 20) {
      setBatchError(`Maximum 20 files allowed. You selected ${combined.length}.`);
      return;
    }
    const oversized = fileArray.filter((f) => f.size > 500 * 1024);
    if (oversized.length > 0) {
      setBatchError(`${oversized.length} file(s) exceed 500KB: ${oversized.map((f) => f.name).join(", ")}`);
    }
    setBatchFiles(combined);
    setParsedNames((prev) => {
      const next = { ...prev };
      for (const f of fileArray) {
        if (!(f.name in next)) {
          const extracted = extractNameFromFilename(f.name);
          if (extracted) next[f.name] = extracted;
        }
      }
      return next;
    });
  }, [batchFiles]);

  const removeFile = (index: number) => {
    setBatchFiles((prev) => prev.filter((_, i) => i !== index));
    setBatchError(null);
  };

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files) handleFilesSelected(e.dataTransfer.files);
  }, [handleFilesSelected]);

  const handleBatchSubmit = async () => {
    if (batchFiles.length === 0) return;
    setBatchProcessing(true);
    setBatchResults(null);
    setBatchError(null);
    setBatchProgress({ current: 0, total: batchFiles.length });
    try {
      const formData = new FormData();
      for (const file of batchFiles) formData.append("files", file);
      const parseRes = await fetch(`${API_BASE}/recommendation/parse-transcripts`, { method: "POST", body: formData });
      if (!parseRes.ok) { setBatchError((await parseRes.json()).error || "Parse failed"); setBatchProcessing(false); return; }
      const { parsed } = await parseRes.json();
      const nameMap: Record<string, string> = {};
      for (const p of parsed) {
        const editedName = parsedNames[p.filename];
        nameMap[p.filename] = editedName !== undefined ? editedName : (p.investor_name || "");
      }
      setParsedNames((prev) => {
        const next = { ...prev };
        for (const p of parsed) {
          if (!(p.filename in next) && p.investor_name) next[p.filename] = p.investor_name;
        }
        return next;
      });
      const validTranscripts = parsed.filter((p: any) => !p.error && p.content);
      const errorResults: BatchResult[] = parsed.filter((p: any) => p.error).map((p: any) => ({ filename: p.filename, investor_name: p.investor_name, status: "error" as const, error: p.error }));
      if (validTranscripts.length === 0) { setBatchResults(errorResults); setBatchProcessing(false); return; }
      setBatchProgress({ current: 0, total: validTranscripts.length });
      const analyzeRes = await fetch(`${API_BASE}/recommendation/analyze-batch`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transcripts: validTranscripts.map((p: any) => ({ filename: p.filename, content: p.content, investor_name: nameMap[p.filename] || p.investor_name || null })) }),
      });
      if (!analyzeRes.ok) { setBatchError((await analyzeRes.json()).error || "Analysis failed"); setBatchProcessing(false); return; }
      const { results } = await analyzeRes.json();

      const enrichedResults: BatchResult[] = results.map((r: any) => {
        const enriched: BatchResult = { ...r };
        if (r.lead_match) {
          enriched.lead_match = r.lead_match;
          if (r.lead_match.status === "matched" && r.lead_match.matches.length > 0) {
            enriched.linked_lead_id = r.lead_match.matches[0].lead_id;
          }
        }
        return enriched;
      });

      setBatchResults([...enrichedResults, ...errorResults]);
      setBatchProgress({ current: validTranscripts.length, total: validTranscripts.length });
    } catch (err: any) { setBatchError(err.message || "Batch processing failed"); } finally { setBatchProcessing(false); }
  };

  const handleCreateLeadFromBatch = async (index: number) => {
    const result = batchResults?.[index];
    if (!result || result.status !== "success" || !result.analysis) return;
    setCreatingLeadIndex(index);
    try {
      const res = await fetch(`${API_BASE}/leads`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: result.investor_name || "Unknown",
          detected_persona: result.analysis.persona,
          pipeline_stage: result.analysis.stage,
          source: "batch_transcript",
          transcript_filename: result.filename,
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Failed to create lead");
      const lead = await res.json();
      setBatchResults((prev) => {
        if (!prev) return prev;
        const updated = [...prev];
        updated[index] = { ...updated[index], created_lead_id: lead.id, linked_lead_id: lead.id };
        return updated;
      });
    } catch (err: any) {
      setBatchError(err.message);
    } finally {
      setCreatingLeadIndex(null);
    }
  };

  const handleLinkToLead = (resultIndex: number, leadId: string) => {
    setBatchResults((prev) => {
      if (!prev) return prev;
      const updated = [...prev];
      updated[resultIndex] = { ...updated[resultIndex], linked_lead_id: leadId };
      return updated;
    });
    setLinkingIndex(null);
    setLinkSearch("");
  };

  const togglePanel = (key: string) => setDetailPanels((p) => ({ ...p, [key]: !p[key] }));
  const toggleBatchPanel = (key: string) => setBatchDetailPanels((p) => ({ ...p, [key]: !p[key] }));

  const selectedLead = leads?.find((l) => l.id === selectedLeadId);
  const analysisData = analyzeMutation.data as any;
  const rankData = rankMutation.data as any;

  const QUESTION_LABELS: Record<string, string> = {
    Q1: "Investment goals and time horizon",
    Q2: "Prior EIS/startup investing experience",
    Q3: "Hesitations or deal-breakers",
    Q4: "Other decision-makers involved",
  };

  return (
    <div className="flex flex-col gap-4 h-[calc(100vh-8rem)]">
      <div className="flex items-center gap-2 shrink-0">
        <Button variant={mode === "single" ? "default" : "outline"} size="sm" onClick={() => setMode("single")}>
          Single Transcript
        </Button>
        <Button variant={mode === "batch" ? "default" : "outline"} size="sm" onClick={() => setMode("batch")}>
          <Upload className="w-4 h-4 mr-1" />
          Batch Upload
        </Button>
      </div>

      {mode === "single" ? (
        <div className="flex-1 flex flex-col lg:flex-row gap-6 min-h-0">
          <div className="w-full lg:w-80 flex flex-col gap-4 border-r pr-6 overflow-y-auto">
            <h2 className="font-semibold text-lg">Lead Context</h2>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input placeholder="Search leads..." className="pl-9" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} />
            </div>
            {searchQuery.length > 0 && !selectedLeadId && (
              <Card className="mt-2">
                <CardContent className="p-2 flex flex-col gap-1">
                  {isLeadsLoading && <div className="p-4 text-center text-sm text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin mx-auto" /></div>}
                  {leads?.map((lead) => (
                    <button key={lead.id} onClick={() => setSelectedLeadId(lead.id)} className="text-left px-3 py-2 text-sm hover:bg-muted rounded-md transition-colors">
                      <div className="font-medium">{lead.name}</div>
                      <div className="text-muted-foreground text-xs">{lead.company}</div>
                    </button>
                  ))}
                </CardContent>
              </Card>
            )}
            {selectedLeadId && selectedLead && (
              <Card>
                <CardHeader className="pb-3">
                  <div className="flex justify-between items-start">
                    <CardTitle className="text-base">{selectedLead.name}</CardTitle>
                    <button onClick={() => setSelectedLeadId(null)} className="text-xs text-muted-foreground hover:text-foreground">Clear</button>
                  </div>
                  <CardDescription>{selectedLead.company || "No company specified"}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <div className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Current Stage</div>
                    <Badge variant="outline">{selectedLead.pipeline_stage}</Badge>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Total Sends</div>
                    <div className="text-sm font-medium">{selectedLead.send_count}</div>
                  </div>
                  {selectedLead.detected_persona && (
                    <div>
                      <div className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Known Persona</div>
                      <div className="text-sm">{selectedLead.detected_persona}</div>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}
          </div>

          <div className="flex-1 flex flex-col gap-4 overflow-y-auto">
            <h2 className="font-semibold text-lg">Input & Analysis</h2>

            <div className="border rounded-md">
              <button className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium hover:bg-muted/50 transition-colors" onClick={() => setChecklistOpen(!checklistOpen)}>
                <div className="flex items-center gap-2">
                  {checklistOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                  Call Checklist
                </div>
                <Badge variant={coveredCount === 4 ? "default" : coveredCount >= 3 ? "secondary" : "destructive"}>
                  {coveredCount === 4 ? "\u{1F7E2}" : coveredCount >= 3 ? "\u{1F7E1}" : "\u{1F534}"} {coveredCount}/4
                </Badge>
              </button>
              {checklistOpen && (
                <div className="px-4 pb-4 space-y-2 border-t pt-3">
                  {Object.entries(QUESTION_LABELS).map(([key, label]) => (
                    <label key={key} className="flex items-center gap-3 text-sm cursor-pointer py-1">
                      <button onClick={() => setQuestionsChecked((p) => ({ ...p, [key]: !p[key] }))}>
                        {questionsChecked[key] ? <CheckCircle className="w-4 h-4 text-primary" /> : <Circle className="w-4 h-4 text-muted-foreground" />}
                      </button>
                      <span className={questionsChecked[key] ? "" : "text-muted-foreground"}>{label}</span>
                    </label>
                  ))}
                  <div className="text-xs text-muted-foreground mt-2">
                    {coveredCount === 4 ? "Full coverage" : coveredCount >= 3 ? `Good coverage — missing: ${Object.entries(questionsChecked).filter(([, v]) => !v).map(([k]) => QUESTION_LABELS[k]).join(", ")}` : "Low coverage — analysis confidence may be reduced"}
                  </div>
                </div>
              )}
            </div>

            <Card className="flex-1 flex flex-col">
              <CardContent className="p-0 flex-1 flex flex-col">
                <Textarea className="flex-1 resize-none border-0 focus-visible:ring-0 rounded-none p-6 text-base" placeholder="Paste call transcript, meeting notes, or email thread here..." value={transcript} onChange={(e) => setTranscript(e.target.value)} />
                <div className="p-4 border-t bg-muted/30 flex justify-between items-center">
                  <span className="text-sm text-muted-foreground">{transcript.length} characters</span>
                  <Button onClick={handleAnalyze} disabled={!transcript || analyzeMutation.isPending} className="gap-2">
                    {analyzeMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                    Analyze & Recommend
                  </Button>
                </div>
              </CardContent>
            </Card>

            {analysisData && (
              <div className="space-y-4">
                {analysisData.primary_issue && (
                  <div className={`p-4 rounded-lg border ${PRIMARY_ISSUE_CONFIG[analysisData.primary_issue]?.bg || ""} ${PRIMARY_ISSUE_CONFIG[analysisData.primary_issue]?.border || ""}`}>
                    <div className="flex items-center gap-3 mb-2">
                      <span className="text-xl">{PRIMARY_ISSUE_CONFIG[analysisData.primary_issue]?.icon}</span>
                      <span className={`text-lg font-bold ${PRIMARY_ISSUE_CONFIG[analysisData.primary_issue]?.color || ""}`}>
                        {PRIMARY_ISSUE_CONFIG[analysisData.primary_issue]?.label}
                      </span>
                    </div>
                    {analysisData.recommended_next_action && (
                      <p className="font-semibold text-sm">{analysisData.recommended_next_action}</p>
                    )}
                  </div>
                )}

                <div className="grid grid-cols-3 gap-3">
                  <div className="p-3 border rounded-md">
                    <div className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Persona</div>
                    <div className="text-sm font-medium">{analysisData.detected_persona.name}</div>
                    <Badge variant={analysisData.detected_persona.confidence_score > 0.8 ? "default" : "destructive"} className="mt-1 text-xs">
                      {Math.round(analysisData.detected_persona.confidence_score * 100)}%
                    </Badge>
                  </div>
                  <div className="p-3 border rounded-md">
                    <div className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Stage</div>
                    <div className="text-sm font-medium">{analysisData.pipeline_stage.stage}</div>
                    <Badge variant={analysisData.pipeline_stage.confidence_score > 0.8 ? "default" : "destructive"} className="mt-1 text-xs">
                      {Math.round(analysisData.pipeline_stage.confidence_score * 100)}%
                    </Badge>
                  </div>
                  <div className="p-3 border rounded-md">
                    <div className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Readiness</div>
                    <div className="text-sm font-medium">{analysisData.readiness_score != null ? `${Math.round(analysisData.readiness_score * 100)}%` : "N/A"}</div>
                  </div>
                </div>

                {analysisData.blocking_objections?.length > 0 && (
                  <div className="border rounded-md">
                    <button className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium hover:bg-muted/50" onClick={() => togglePanel("objections")}>
                      <div className="flex items-center gap-2">
                        <AlertTriangle className="w-4 h-4 text-amber-400" />
                        Blocking Objections ({analysisData.blocking_objections.length})
                      </div>
                      {detailPanels.objections ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                    </button>
                    {detailPanels.objections && (
                      <div className="px-4 pb-4 border-t pt-3 space-y-2">
                        {(analysisData.objections || []).map((obj: any, i: number) => (
                          <div key={i} className="text-sm flex items-start gap-2">
                            <Badge variant={obj.severity === "blocking" ? "destructive" : obj.severity === "significant" ? "secondary" : "outline"} className="shrink-0 text-xs mt-0.5">
                              {obj.severity}
                            </Badge>
                            <div>
                              <span className="font-medium">{obj.objection}</span>
                              {obj.suggested_response && <p className="text-muted-foreground text-xs mt-0.5">{obj.suggested_response}</p>}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {analysisData.information_gaps?.length > 0 && (
                  <div className="border rounded-md">
                    <button className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium hover:bg-muted/50" onClick={() => togglePanel("gaps")}>
                      <div className="flex items-center gap-2">
                        <FileText className="w-4 h-4 text-red-400" />
                        Information Gaps ({analysisData.information_gaps.length})
                      </div>
                      {detailPanels.gaps ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                    </button>
                    {detailPanels.gaps && (
                      <div className="px-4 pb-4 border-t pt-3 space-y-2">
                        {analysisData.information_gaps.map((gap: any, i: number) => (
                          <div key={i} className="text-sm">
                            <div className="font-medium">{gap.gap}</div>
                            <div className="text-muted-foreground text-xs">{gap.impact}</div>
                            {gap.suggested_document_type && <Badge variant="outline" className="text-xs mt-1">{gap.suggested_document_type}</Badge>}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {analysisData.call_completeness && (
                  <div className="border rounded-md">
                    <button className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium hover:bg-muted/50" onClick={() => togglePanel("completeness")}>
                      <div className="flex items-center gap-2">
                        Call Completeness
                      </div>
                      <Badge variant={analysisData.call_completeness.questions_covered === 4 ? "default" : "secondary"}>
                        {analysisData.call_completeness.questions_covered}/{analysisData.call_completeness.questions_total}
                      </Badge>
                    </button>
                    {detailPanels.completeness && (
                      <div className="px-4 pb-4 border-t pt-3 space-y-2">
                        <p className="text-sm text-muted-foreground">{analysisData.call_completeness.confidence_impact}</p>
                        {analysisData.call_completeness.missing_signals?.length > 0 && (
                          <div>
                            <p className="text-xs font-medium text-muted-foreground mb-1">Missing signals:</p>
                            <ul className="text-xs text-muted-foreground space-y-0.5">
                              {analysisData.call_completeness.missing_signals.map((s: string, i: number) => (
                                <li key={i}>• {s}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {analysisData.detected_persona?.evidence?.length > 0 && (
                  <div className="border rounded-md">
                    <button className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium hover:bg-muted/50" onClick={() => togglePanel("evidence")}>
                      Evidence from Transcript
                      {detailPanels.evidence ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                    </button>
                    {detailPanels.evidence && (
                      <div className="px-4 pb-4 border-t pt-3">
                        <ul className="text-sm text-muted-foreground space-y-1">
                          {analysisData.detected_persona.evidence.map((e: string, i: number) => (
                            <li key={i}>• {e}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                )}

                {matrixFlags && (
                  <div className="border rounded-md">
                    <div className="px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider border-b">
                      Context Signals
                    </div>
                    <div className="px-4 py-3 space-y-2.5">
                      {([
                        { key: "eis_familiar" as const, label: "Investor is EIS-familiar", icon: matrixFlags.eis_familiar ? "on" : "off" },
                        { key: "iht_confirmed" as const, label: "IHT concern confirmed", icon: matrixFlags.iht_confirmed ? "on" : "off" },
                        { key: "adviser_mentioned" as const, label: "Adviser/accountant mentioned", icon: matrixFlags.adviser_mentioned ? "on" : "off" },
                      ]).map(({ key, label, icon }) => (
                        <div key={key} className="flex items-start gap-3">
                          <button
                            onClick={() => handleFlagToggle(key)}
                            disabled={rankMutation.isPending}
                            className={`mt-0.5 w-4 h-4 rounded border flex-shrink-0 flex items-center justify-center text-xs transition-colors ${
                              matrixFlags[key]
                                ? "bg-primary border-primary text-primary-foreground"
                                : "border-muted-foreground/40 hover:border-muted-foreground"
                            }`}
                          >
                            {matrixFlags[key] && <CheckCircle className="w-3 h-3" />}
                          </button>
                          <div className="flex-1 min-w-0">
                            <div className={`text-sm ${matrixFlags[key] ? "font-medium" : "text-muted-foreground"}`}>
                              {label}
                            </div>
                            {matrixFlags.derivation_notes?.[key] && (
                              <div className="text-xs text-muted-foreground mt-0.5 truncate">
                                {matrixFlags.derivation_notes[key]}
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                    {rankMutation.isPending && (
                      <div className="px-4 pb-3">
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <Loader2 className="w-3 h-3 animate-spin" />
                          Re-ranking documents...
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="w-full lg:w-[400px] flex flex-col gap-4 border-l pl-6 overflow-y-auto">
            <h2 className="font-semibold text-lg">Recommendations</h2>
            {!rankData && !rankMutation.isPending && (
              <div className="flex-1 flex flex-col items-center justify-center text-center p-8 border border-dashed rounded-lg text-muted-foreground">
                <FileText className="w-8 h-8 mb-4 opacity-50" />
                <p className="text-sm">Run analysis to see recommended documents and draft an email.</p>
              </div>
            )}
            {rankMutation.isPending && (
              <div className="flex-1 flex flex-col items-center justify-center">
                <Loader2 className="w-8 h-8 animate-spin text-primary mb-4" />
                <p className="text-sm text-muted-foreground">Ranking repository...</p>
              </div>
            )}
            {rankData && (
              <div className="space-y-6 flex-1 overflow-y-auto pr-2">
                {rankData.recommendation_gap && (
                  <div className="p-4 rounded-lg border border-amber-500/30 bg-amber-500/10 space-y-3">
                    <div className="flex items-center gap-2">
                      <AlertTriangle className="w-5 h-5 text-amber-400" />
                      <span className="font-semibold text-amber-400">Content Coverage Gap</span>
                    </div>
                    <ul className="text-sm space-y-1">
                      {rankData.recommendation_gap.gap_reasons.map((r: string, i: number) => (
                        <li key={i} className="text-muted-foreground">• {r}</li>
                      ))}
                    </ul>
                    {rankData.recommendation_gap.content_needed?.length > 0 && (
                      <div>
                        <div className="text-xs text-muted-foreground uppercase tracking-wider mb-1 mt-2">Content Needed</div>
                        {rankData.recommendation_gap.content_needed.map((c: string, i: number) => (
                          <Badge key={i} variant="outline" className="mr-1 mb-1 text-xs">{c}</Badge>
                        ))}
                      </div>
                    )}

                    {!gapBrief && !gapBriefLoading && (
                      <Button variant="default" size="sm" className="w-full mt-2 gap-1" onClick={async () => {
                        setGapBriefLoading(true);
                        setGapBriefError(null);
                        setGapBrief(null);
                        setGapDocResult(null);
                        try {
                          const res = await fetch(`${API_BASE}/recommendation/gap-brief`, {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({
                              archetype: rankData.recommendation_gap.archetype || rankData.recommendation_gap.persona,
                              stage: rankData.recommendation_gap.pipeline_stage,
                              persona: rankData.recommendation_gap.persona,
                              transcript_summary: analysisData?.transcript_summary || "",
                            }),
                          });
                          if (!res.ok) throw new Error((await res.json()).error || "Brief generation failed");
                          const data = await res.json();
                          setGapBrief(data);
                        } catch (err: any) {
                          setGapBriefError(err.message);
                        } finally {
                          setGapBriefLoading(false);
                        }
                      }}>
                        <FileText className="w-3 h-3" />
                        Generate Brief
                      </Button>
                    )}

                    {gapBriefLoading && (
                      <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Generating brief...
                      </div>
                    )}

                    {gapBriefError && (
                      <div className="text-sm text-red-400 py-1">Error: {gapBriefError}</div>
                    )}

                    {gapBrief && (
                      <div className="mt-3 space-y-3 border-t border-amber-500/20 pt-3">
                        <div className="flex items-center justify-between">
                          <span className="font-semibold text-sm">{gapBrief.brief.title}</span>
                          <Badge variant="outline" className="text-xs">{gapBrief.brief.document_type}</Badge>
                        </div>

                        <div>
                          <div className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Key Messages</div>
                          <ul className="text-sm space-y-1">
                            {gapBrief.brief.key_messages?.map((m: string, i: number) => (
                              <li key={i} className="text-muted-foreground">• {m}</li>
                            ))}
                          </ul>
                        </div>

                        <div className="flex gap-2 flex-wrap">
                          {gapBrief.brief.archetypes?.map((a: string, i: number) => (
                            <Badge key={i} variant="secondary" className="text-xs">{a}</Badge>
                          ))}
                          {gapBrief.brief.stages?.map((s: string, i: number) => (
                            <Badge key={i} variant="outline" className="text-xs">{s}</Badge>
                          ))}
                        </div>

                        <div>
                          <div className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Tone & Length</div>
                          <p className="text-xs text-muted-foreground">{gapBrief.brief.tone} — {gapBrief.brief.length_guidance}</p>
                        </div>

                        {gapBrief.brief.compliance_considerations?.length > 0 && (
                          <div>
                            <div className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Compliance</div>
                            <ul className="text-xs space-y-0.5">
                              {gapBrief.brief.compliance_considerations.map((c: string, i: number) => (
                                <li key={i} className="text-muted-foreground">• {c}</li>
                              ))}
                            </ul>
                          </div>
                        )}

                        {gapBrief.brief.source_material_pointers?.length > 0 && (
                          <div>
                            <div className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Source Material</div>
                            <ul className="text-xs space-y-0.5">
                              {gapBrief.brief.source_material_pointers.map((s: string, i: number) => (
                                <li key={i} className="text-muted-foreground">• {s}</li>
                              ))}
                            </ul>
                          </div>
                        )}

                        {gapBrief.brief.information_needed?.length > 0 && (
                          <div>
                            <div className="text-xs text-red-400 uppercase tracking-wider mb-1">Information Needed</div>
                            {gapBrief.brief.information_needed.map((info: any, i: number) => (
                              <div key={i} className="text-xs border border-red-500/30 rounded p-2 mb-1 bg-red-500/5">
                                <span className="font-medium text-red-400">{info.field}</span>
                                <span className="text-muted-foreground"> — {info.description}</span>
                                <span className="text-muted-foreground italic"> (source: {info.source})</span>
                              </div>
                            ))}
                          </div>
                        )}

                        {!gapDocResult && (
                          <Button
                            variant="default"
                            size="sm"
                            className="w-full gap-1"
                            disabled={gapDocGenerating}
                            onClick={async () => {
                              setGapDocGenerating(true);
                              try {
                                const res = await fetch(`${API_BASE}/content/generate-from-brief`, {
                                  method: "POST",
                                  headers: { "Content-Type": "application/json" },
                                  body: JSON.stringify({ brief: gapBrief.brief, override_information_gaps: true }),
                                });
                                if (!res.ok) throw new Error((await res.json()).error || "Generation failed");
                                const data = await res.json();
                                setGapDocResult(data);
                              } catch (err: any) {
                                setGapBriefError(err.message);
                              } finally {
                                setGapDocGenerating(false);
                              }
                            }}
                          >
                            {gapDocGenerating ? <><Loader2 className="w-3 h-3 animate-spin" /> Generating Document...</> : <><FileText className="w-3 h-3" /> Generate Document</>}
                          </Button>
                        )}

                        {gapDocResult && (
                          <div className="p-3 rounded border border-emerald-500/30 bg-emerald-500/10">
                            <div className="flex items-center gap-2 text-emerald-400 text-sm font-medium">
                              <CheckCircle className="w-4 h-4" />
                              Document generated — {gapDocResult.qc_result?.overall || "QC pending"}
                            </div>
                            {gapDocResult.document_id && (
                              <Button variant="link" size="sm" className="p-0 h-auto mt-1 text-xs" onClick={() => window.location.href = `${import.meta.env.BASE_URL}registry/${gapDocResult.document_id}`}>
                                View in Document Registry →
                              </Button>
                            )}
                          </div>
                        )}
                      </div>
                    )}

                    <Button variant="outline" size="sm" className="w-full gap-1 text-xs" onClick={() => window.location.href = `${import.meta.env.BASE_URL}gaps`}>
                      <FileText className="w-3 h-3" />
                      View Content Gap Analysis
                    </Button>
                  </div>
                )}

                {rankData.ranked_documents.length > 0 ? (
                  <div className="space-y-3">
                    <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Suggested Documents</h3>
                    {rankData.ranked_documents.slice(0, 3).map((doc: any, i: number) => (
                      <Card key={doc.document_id} className={`bg-card ${i === 0 ? "border-primary shadow-sm" : ""}`}>
                        <CardContent className="p-4">
                          <div className="flex items-start justify-between gap-2">
                            <div className="font-medium text-sm">{doc.name}</div>
                            <Badge variant="secondary" className="text-xs shrink-0">{doc.file_code}</Badge>
                          </div>
                          <p className="text-xs text-muted-foreground mt-2 line-clamp-2">{doc.rationale}</p>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                ) : !rankData.recommendation_gap ? (
                  <div className="p-4 bg-muted/50 rounded-lg text-center text-sm">
                    {rankData.all_sent_message || "No suitable documents found."}
                  </div>
                ) : null}

                {rankData.excluded_documents?.length > 0 && (
                  <div className="border rounded-md">
                    <button className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium hover:bg-muted/50" onClick={() => togglePanel("excluded")}>
                      <div className="flex items-center gap-2">
                        <XCircle className="w-4 h-4 text-muted-foreground" />
                        <span>Filtered by Matrix ({rankData.excluded_documents.length})</span>
                      </div>
                      {detailPanels.excluded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                    </button>
                    {detailPanels.excluded && (
                      <div className="px-4 pb-4 border-t pt-3 space-y-2">
                        {rankData.excluded_documents.map((doc: any, i: number) => (
                          <div key={i} className="text-xs flex items-start gap-2">
                            <Badge variant="outline" className="shrink-0 text-xs mt-0.5">{doc.file_code || doc.document_id}</Badge>
                            <span className="text-muted-foreground">{doc.reason}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {rankData.recommended_videos && rankData.recommended_videos.length > 0 && (
                  <div className="space-y-3">
                    <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Recommended Videos</h3>
                    {rankData.recommended_videos.map((video: any) => (
                      <Card key={video.video_id} className="bg-card border-violet-200/50">
                        <CardContent className="p-4">
                          <div className="flex items-start justify-between gap-2">
                            <div className="font-medium text-sm">{video.title}</div>
                            <Badge variant="secondary" className="text-xs shrink-0 bg-violet-100 text-violet-800">
                              {video.send_method === "whatsapp" ? "Send via WhatsApp" : video.send_method}
                            </Badge>
                          </div>
                          <p className="text-xs text-muted-foreground mt-1">{video.description}</p>
                          {video.duration_seconds && (
                            <span className="text-xs text-muted-foreground">{Math.floor(video.duration_seconds / 60)}:{String(video.duration_seconds % 60).padStart(2, "0")}</span>
                          )}
                          <p className="text-xs text-violet-600 mt-1">{video.relevance_reason}</p>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                )}

                {emailMutation.data && (
                  <div className="space-y-3">
                    <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Draft Email</h3>
                    <Card>
                      <CardContent className="p-4 space-y-4">
                        <div>
                          <div className="text-xs text-muted-foreground mb-1">Subject</div>
                          <div className="text-sm font-medium">{emailMutation.data.subject}</div>
                        </div>
                        <div>
                          <div className="text-xs text-muted-foreground mb-1">Body</div>
                          <div className="text-sm whitespace-pre-wrap">{emailMutation.data.body}</div>
                        </div>
                      </CardContent>
                    </Card>
                  </div>
                )}
                <Button className="w-full gap-2" size="lg" onClick={handleConfirm} disabled={confirmMutation.isPending || !selectedLeadId || rankData.ranked_documents.length === 0}>
                  {confirmMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                  Log Send & Copy Email
                </Button>
                {confirmMutation.isSuccess && (
                  <div className="text-sm text-green-600 text-center font-medium bg-green-50 p-2 rounded">Successfully logged!</div>
                )}
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="flex-1 flex flex-col gap-6 min-h-0 overflow-y-auto">
          {!batchResults ? (
            <>
              <div className="border-2 border-dashed rounded-lg p-12 text-center cursor-pointer hover:border-primary/50 transition-colors" onDrop={handleDrop} onDragOver={(e) => e.preventDefault()} onClick={() => fileInputRef.current?.click()}>
                <input ref={fileInputRef} type="file" className="hidden" multiple accept=".txt,.docx" onChange={(e) => e.target.files && handleFilesSelected(e.target.files)} />
                <Upload className="w-12 h-12 mx-auto mb-4 text-muted-foreground opacity-50" />
                <p className="text-lg font-medium mb-1">Drop transcript files here</p>
                <p className="text-sm text-muted-foreground">Or click to browse. Accepts .txt and .docx files (max 20 files, 500KB each)</p>
              </div>
              {batchError && <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-md text-sm text-red-400">{batchError}</div>}
              {batchFiles.length > 0 && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">{batchFiles.length} file(s) · {Math.round(batchFiles.reduce((s, f) => s + f.size, 0) / 1024)}KB total</span>
                    <Button variant="ghost" size="sm" onClick={() => { setBatchFiles([]); setBatchError(null); setParsedNames({}); }}>Clear All</Button>
                  </div>
                  <div className="space-y-2">
                    {batchFiles.map((file, i) => {
                      const extractedName = parsedNames[file.name];
                      return (
                        <div key={i} className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm border ${file.size > 500 * 1024 ? "border-red-500/50 bg-red-500/10 text-red-400" : "border-border bg-muted/50"}`}>
                          <FileText className="w-4 h-4 shrink-0" />
                          <div className="flex-1 min-w-0">
                            <div className="truncate">{file.name}</div>
                            <input
                              type="text"
                              className="w-full mt-1 text-xs bg-transparent border-b border-border/50 focus:border-primary outline-none text-muted-foreground placeholder:text-muted-foreground/50"
                              placeholder="Unknown investor"
                              value={extractedName ?? ""}
                              onChange={(e) => setParsedNames((prev) => ({ ...prev, [file.name]: e.target.value }))}
                            />
                          </div>
                          {file.size > 500 * 1024 && <span className="text-xs shrink-0">(too large)</span>}
                          <button onClick={() => removeFile(i)} className="hover:text-foreground shrink-0"><X className="w-3 h-3" /></button>
                        </div>
                      );
                    })}
                  </div>
                  <Button onClick={handleBatchSubmit} disabled={batchProcessing || batchFiles.length === 0} className="gap-2">
                    {batchProcessing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                    Analyze {batchFiles.length} Transcript{batchFiles.length !== 1 ? "s" : ""}
                  </Button>
                </div>
              )}
              {batchProcessing && (
                <div className="p-6 border rounded-lg text-center">
                  <Loader2 className="w-8 h-8 animate-spin mx-auto mb-4 text-primary" />
                  <p className="text-sm font-medium">Analyzing transcripts...</p>
                  <div className="w-full bg-muted rounded-full h-2 mt-3">
                    <div className="bg-primary h-2 rounded-full transition-all" style={{ width: `${batchProgress.total > 0 ? (batchProgress.current / batchProgress.total) * 100 : 0}%` }} />
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="font-semibold text-lg">Batch Results ({batchResults.length} transcripts)</h2>
                <Button variant="outline" size="sm" onClick={() => { setBatchResults(null); setBatchFiles([]); setBatchError(null); setParsedNames({}); }}>New Batch</Button>
              </div>
              {batchError && <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-md text-sm text-red-400">{batchError}</div>}
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {batchResults.map((result, i) => (
                  <Card key={i} className={result.status === "error" ? "border-red-500/30" : ""}>
                    <CardHeader className="pb-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          {result.investor_name && (
                            <CardTitle className="text-base font-semibold truncate">{result.investor_name}</CardTitle>
                          )}
                          <div className={`text-xs truncate ${result.investor_name ? "text-muted-foreground mt-0.5" : "text-sm font-medium"}`}>{result.filename}</div>
                        </div>
                        <Badge variant={result.status === "success" ? "default" : "destructive"} className="shrink-0 text-xs">
                          {result.status === "success" ? <><CheckCircle className="w-3 h-3 mr-1" />ANALYZED</> : <><XCircle className="w-3 h-3 mr-1" />ERROR</>}
                        </Badge>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      {result.status === "success" && result.analysis ? (
                        <>
                          {result.lead_match && (
                            <div className={`p-2 rounded-md text-xs ${
                              result.linked_lead_id ? "bg-green-500/10 border border-green-500/30" :
                              result.lead_match.status === "partial" ? "bg-amber-500/10 border border-amber-500/30" :
                              "bg-blue-500/10 border border-blue-500/30"
                            }`}>
                              {result.linked_lead_id ? (
                                <div className="flex items-center gap-1.5">
                                  <Link2 className="w-3 h-3 text-green-400" />
                                  <span className="text-green-400 font-medium">
                                    {result.created_lead_id ? "Lead created" : "Linked to lead"}
                                  </span>
                                </div>
                              ) : result.lead_match.status === "partial" ? (
                                <div className="flex items-center gap-1.5">
                                  <User className="w-3 h-3 text-amber-400" />
                                  <span className="text-amber-400">Possible match: {result.lead_match.matches[0]?.name}</span>
                                </div>
                              ) : (
                                <div className="flex items-center gap-1.5">
                                  <UserPlus className="w-3 h-3 text-blue-400" />
                                  <span className="text-blue-400">New investor — no matching lead</span>
                                </div>
                              )}
                            </div>
                          )}

                          {result.analysis.primary_issue && (
                            <div className={`p-2 rounded-md border ${PRIMARY_ISSUE_CONFIG[result.analysis.primary_issue]?.bg || ""} ${PRIMARY_ISSUE_CONFIG[result.analysis.primary_issue]?.border || ""}`}>
                              <div className="flex items-center gap-2 text-xs">
                                <span>{PRIMARY_ISSUE_CONFIG[result.analysis.primary_issue]?.icon}</span>
                                <span className={`font-bold ${PRIMARY_ISSUE_CONFIG[result.analysis.primary_issue]?.color || ""}`}>
                                  {PRIMARY_ISSUE_CONFIG[result.analysis.primary_issue]?.label}
                                </span>
                              </div>
                              {result.analysis.recommended_next_action && (
                                <p className="text-xs mt-1 text-muted-foreground">{result.analysis.recommended_next_action}</p>
                              )}
                            </div>
                          )}

                          <div className="grid grid-cols-3 gap-2">
                            <div>
                              <div className="text-xs text-muted-foreground">Persona</div>
                              <div className="text-sm font-medium">{result.analysis.persona}</div>
                              <Badge variant="secondary" className="text-xs mt-1">{Math.round(result.analysis.persona_confidence * 100)}%</Badge>
                            </div>
                            <div>
                              <div className="text-xs text-muted-foreground">Stage</div>
                              <div className="text-sm font-medium">{result.analysis.stage}</div>
                              <Badge variant="secondary" className="text-xs mt-1">{Math.round(result.analysis.stage_confidence * 100)}%</Badge>
                            </div>
                            <div>
                              <div className="text-xs text-muted-foreground">Readiness</div>
                              <div className="text-sm font-medium">{result.analysis.readiness_score != null ? `${Math.round(result.analysis.readiness_score * 100)}%` : "N/A"}</div>
                            </div>
                          </div>

                          {((result.analysis.blocking_objections && result.analysis.blocking_objections.length > 0) || (result.analysis.information_gaps && result.analysis.information_gaps.length > 0) || result.analysis.call_completeness) && (
                            <div className="border rounded-md">
                              <button className="w-full flex items-center justify-between px-3 py-2 text-xs font-medium hover:bg-muted/50" onClick={() => toggleBatchPanel(`detail-${i}`)}>
                                <span>Details</span>
                                {batchDetailPanels[`detail-${i}`] ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                              </button>
                              {batchDetailPanels[`detail-${i}`] && (
                                <div className="px-3 pb-3 border-t pt-2 space-y-3">
                                  {result.analysis.blocking_objections && result.analysis.blocking_objections.length > 0 && (
                                    <div>
                                      <div className="text-xs font-medium text-amber-400 mb-1 flex items-center gap-1">
                                        <AlertTriangle className="w-3 h-3" />Blocking Objections
                                      </div>
                                      <ul className="text-xs space-y-0.5">
                                        {result.analysis.blocking_objections.map((obj, j) => <li key={j} className="truncate">• {obj}</li>)}
                                      </ul>
                                    </div>
                                  )}
                                  {result.analysis.information_gaps && result.analysis.information_gaps.length > 0 && (
                                    <div>
                                      <div className="text-xs font-medium text-red-400 mb-1 flex items-center gap-1">
                                        <FileText className="w-3 h-3" />Information Gaps
                                      </div>
                                      <ul className="text-xs space-y-1">
                                        {result.analysis.information_gaps.map((gap, j) => (
                                          <li key={j}>
                                            <span className="font-medium">{gap.gap}</span>
                                            <span className="text-muted-foreground"> — {gap.impact}</span>
                                          </li>
                                        ))}
                                      </ul>
                                    </div>
                                  )}
                                  {result.analysis.call_completeness && (
                                    <div>
                                      <div className="text-xs font-medium text-muted-foreground mb-1">
                                        Call Completeness: {result.analysis.call_completeness.questions_covered}/{result.analysis.call_completeness.questions_total}
                                      </div>
                                      <p className="text-xs text-muted-foreground">{result.analysis.call_completeness.confidence_impact}</p>
                                      {result.analysis.call_completeness.missing_signals.length > 0 && (
                                        <ul className="text-xs text-muted-foreground mt-1">
                                          {result.analysis.call_completeness.missing_signals.map((s, j) => <li key={j}>• {s}</li>)}
                                        </ul>
                                      )}
                                    </div>
                                  )}
                                  {result.analysis.transcript_summary && (
                                    <div>
                                      <div className="text-xs font-medium text-muted-foreground mb-1">Summary</div>
                                      <p className="text-xs text-muted-foreground">{result.analysis.transcript_summary}</p>
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          )}

                          <div className="flex gap-2">
                            {!result.linked_lead_id && (
                              <>
                                <Button size="sm" variant="outline" className="flex-1 gap-1 text-xs" onClick={() => handleCreateLeadFromBatch(i)} disabled={creatingLeadIndex === i || !result.investor_name}>
                                  {creatingLeadIndex === i ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
                                  Create Lead
                                </Button>
                                <div className="relative flex-1">
                                  <Button size="sm" variant="outline" className="w-full gap-1 text-xs" onClick={() => { setLinkingIndex(linkingIndex === i ? null : i); setLinkSearch(result.investor_name || ""); }}>
                                    <Link2 className="w-3 h-3" />Link
                                  </Button>
                                  {linkingIndex === i && (
                                    <div className="absolute top-full left-0 right-0 mt-1 z-10 bg-popover border rounded-md shadow-lg p-2 space-y-2 min-w-[200px]">
                                      <Input placeholder="Search leads..." className="h-8 text-xs" value={linkSearch} onChange={(e) => setLinkSearch(e.target.value)} autoFocus />
                                      {linkLeads && linkLeads.length > 0 && (
                                        <div className="max-h-32 overflow-y-auto space-y-1">
                                          {linkLeads.map((lead) => (
                                            <button key={lead.id} className="w-full text-left px-2 py-1.5 text-xs hover:bg-muted rounded transition-colors" onClick={() => handleLinkToLead(i, lead.id)}>
                                              <div className="font-medium">{lead.name}</div>
                                              <div className="text-muted-foreground">{lead.company}</div>
                                            </button>
                                          ))}
                                        </div>
                                      )}
                                      <button className="w-full text-left px-2 py-1.5 text-xs text-primary hover:bg-muted rounded" onClick={() => { setLinkingIndex(null); setLinkSearch(""); }}>Cancel</button>
                                    </div>
                                  )}
                                </div>
                              </>
                            )}
                            {result.linked_lead_id && (
                              <Button size="sm" variant="outline" className="w-full gap-1 text-xs" onClick={() => window.location.href = `${import.meta.env.BASE_URL}leads/${result.linked_lead_id}`}>
                                <User className="w-3 h-3" />View Lead
                              </Button>
                            )}
                          </div>
                        </>
                      ) : (
                        <div className="text-sm text-red-400">{result.error}</div>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Sparkles(props: any) {
  return (
    <svg {...props} xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z" />
      <path d="M5 3v4" />
      <path d="M19 17v4" />
      <path d="M3 5h4" />
      <path d="M17 19h4" />
    </svg>
  );
}
