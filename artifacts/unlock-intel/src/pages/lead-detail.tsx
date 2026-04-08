import { useState, useEffect } from "react";
import { useParams, Link } from "wouter";
import { useGetLead, useGetLeadNextAction } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Clock, FileText, Phone, Target, AlertCircle, CheckCircle, XCircle, Loader2, Sparkles, Lock } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { format } from "date-fns";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const API_BASE = (import.meta.env.BASE_URL?.replace(/\/$/, "") || "") + "/api";

const PERSONAS = [
  "Crypto Enthusiast", "Tech Worker", "Young Professional", "Entrepreneur", "BTL Mogul", "Concentrated Stock Holder",
  "Retirement Planner", "Old Fashioned Saver", "ISA/SIPP Maximiser", "DB Heavy", "Cautious Accumulator", "Drawdown Specialist", "Ultra-Conservative Saver",
  "Property Lover", "Legacy Builder", "Dividend Seeker", "Global Nomad", "Financial Advisor", "HNW Inheritor",
  "Growth Seeker", "Preserver",
];

const PERSONA_TO_ARCHETYPE: Record<string, string> = {
  "Crypto Enthusiast": "Growth Seeker", "Tech Worker": "Growth Seeker", "Young Professional": "Growth Seeker",
  "Entrepreneur": "Growth Seeker", "BTL Mogul": "Growth Seeker", "Concentrated Stock Holder": "Growth Seeker",
  "Retirement Planner": "Preserver", "Old Fashioned Saver": "Preserver", "ISA/SIPP Maximiser": "Preserver",
  "DB Heavy": "Preserver", "Cautious Accumulator": "Preserver", "Drawdown Specialist": "Preserver", "Ultra-Conservative Saver": "Preserver",
  "Property Lover": "Legacy Builder", "Legacy Builder": "Legacy Builder", "Dividend Seeker": "Legacy Builder",
  "Global Nomad": "Legacy Builder", "Financial Advisor": "Legacy Builder", "HNW Inheritor": "Legacy Builder",
  "Growth Seeker": "Growth Seeker", "Preserver": "Preserver",
};

const CLUSTER_ORDER = ["universal", "growth_seeker", "preserver", "legacy_builder", "company_conviction", "founding_round"];

const CLUSTER_LABELS: Record<string, string> = {
  universal: "Universal",
  growth_seeker: "Growth Seeker",
  preserver: "Preserver",
  legacy_builder: "Legacy Builder",
  company_conviction: "Company Conviction",
  founding_round: "Founding Round",
};

const STATE_COLOURS: Record<string, string> = {
  UNKNOWN: "bg-gray-300",
  ABSENT: "bg-red-400",
  PARTIAL: "bg-amber-400",
  ESTABLISHED: "bg-green-500",
  BLOCKED: "bg-purple-400",
};

const HOT_BUTTON_LABELS: Record<string, string> = {
  family_security: "Family Security",
  freedom: "Freedom",
  legacy: "Legacy",
  relief: "Relief",
  significance: "Significance",
};

const GATE_LABELS: Record<string, string> = {
  can_ask_risk_appetite_question: "Ask risk appetite question",
  can_recommend_pack_1: "Recommend Pack 1",
  can_recommend_pack_2: "Recommend Pack 2",
  can_make_investment_ask: "Make investment ask",
};

const READINESS_COLOURS: Record<string, string> = {
  READY_TO_CLOSE: "bg-green-500",
  OBJECTION_TO_RESOLVE: "bg-amber-400",
  INFORMATION_GAP: "bg-blue-500",
  NEEDS_NURTURING: "bg-gray-400",
};

export default function LeadDetail() {
  const params = useParams();
  const id = params.id as string;

  const { data: lead, isLoading: isLeadLoading, refetch } = useGetLead(id, { query: { enabled: !!id } });
  const { data: nextAction, isLoading: isNextActionLoading } = useGetLeadNextAction(id, { query: { enabled: !!id } });

  /* --- Existing state (unchanged) --- */
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [selectedPersona, setSelectedPersona] = useState("");
  const [confirmNotes, setConfirmNotes] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [confirmResult, setConfirmResult] = useState<string | null>(null);

  /* --- New state: tabs --- */
  const [activeTab, setActiveTab] = useState<"overview" | "beliefs">("overview");

  /* --- New state: notes --- */
  const [notes, setNotes] = useState<string>("");
  const [notesSaving, setNotesSaving] = useState<boolean>(false);
  const [notesSaved, setNotesSaved] = useState<boolean>(false);

  /* --- New state: generate profile --- */
  const [generatingProfile, setGeneratingProfile] = useState<boolean>(false);
  const [generateError, setGenerateError] = useState<string | null>(null);

  /* --- New state: intelligence & beliefs --- */
  const [intelligence, setIntelligence] = useState<any>(null);
  const [intelligenceLoading, setIntelligenceLoading] = useState(false);
  const [beliefs, setBeliefs] = useState<any[]>([]);
  const [beliefsLoading, setBeliefsLoading] = useState(false);
  const [gates, setGates] = useState<any>(null);
  const [nextBelief, setNextBelief] = useState<any>(null);
  const [beliefRegistry, setBeliefRegistry] = useState<any[]>([]);
  const [selectedBeliefId, setSelectedBeliefId] = useState<string | null>(null);
  const [transitions, setTransitions] = useState<any[]>([]);

  /* --- Initialise notes from lead data --- */
  useEffect(() => {
    if (lead) {
      setNotes((lead as any).notes ?? "");
    }
  }, [lead]);

  /* --- Fetch belief registry once on mount --- */
  useEffect(() => {
    fetchBeliefRegistry();
  }, []);

  /* --- Fetch intelligence/beliefs when Beliefs tab becomes active --- */
  useEffect(() => {
    if (activeTab === "beliefs" && id) {
      fetchIntelligence();
      fetchBeliefs();
      fetchGatesAndNext();
      fetchTransitions();
    }
  }, [activeTab, id]);

  /* --- Existing handler (unchanged) --- */
  const handleConfirmPersona = async (wasCorrect: boolean) => {
    const persona = wasCorrect ? (lead as any)?.detected_persona : selectedPersona;
    if (!persona) return;
    const archetype = PERSONA_TO_ARCHETYPE[persona] || "Growth Seeker";
    setConfirming(true);
    try {
      const res = await fetch(`${API_BASE}/leads/${id}/confirm-persona`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmed_persona: persona, confirmed_archetype: archetype, was_correct: wasCorrect, notes: confirmNotes }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      const data = await res.json();
      setConfirmResult(data.action === "PERSONA_CONFIRMED" ? "Persona confirmed" : "Persona corrected");
      setConfirmOpen(false);
      refetch();
    } catch (err: any) {
      setConfirmResult(`Error: ${err.message}`);
    } finally {
      setConfirming(false);
    }
  };

  /* --- New handler: notes save --- */
  const handleNotesSave = async () => {
    if (!id) return;
    setNotesSaving(true);
    try {
      const res = await fetch(`${API_BASE}/leads/${id}/notes`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes }),
      });
      if (res.ok) {
        setNotesSaved(true);
        setTimeout(() => setNotesSaved(false), 2000);
      }
    } catch {
    } finally {
      setNotesSaving(false);
    }
  };

  /* --- New handler: generate profile --- */
  const handleGenerateProfile = async () => {
    if (!id) return;
    setGeneratingProfile(true);
    setGenerateError(null);
    try {
      const res = await fetch(`${API_BASE}/leads/${id}/intelligence/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      if (res.ok) {
        await fetchIntelligence();
      } else {
        const data = await res.json().catch(() => ({}));
        setGenerateError(data.error || "Failed to generate profile");
      }
    } catch {
      setGenerateError("Failed to generate profile");
    } finally {
      setGeneratingProfile(false);
    }
  };

  /* --- New fetch functions --- */
  const fetchIntelligence = async () => {
    if (!id) return;
    setIntelligenceLoading(true);
    try {
      const res = await fetch(`${API_BASE}/leads/${id}/intelligence`);
      const data = await res.json();
      setIntelligence(data.intelligence);
    } catch { /* silent */ }
    finally { setIntelligenceLoading(false); }
  };

  const fetchBeliefs = async () => {
    if (!id) return;
    setBeliefsLoading(true);
    try {
      const res = await fetch(`${API_BASE}/leads/${id}/beliefs`);
      const data = await res.json();
      setBeliefs(data.beliefs || []);
    } catch { /* silent */ }
    finally { setBeliefsLoading(false); }
  };

  const fetchGatesAndNext = async () => {
    if (!id) return;
    try {
      const [gatesRes, nextRes] = await Promise.all([
        fetch(`${API_BASE}/leads/${id}/beliefs/gates`),
        fetch(`${API_BASE}/leads/${id}/beliefs/next`),
      ]);
      const gatesData = await gatesRes.json();
      const nextData = await nextRes.json();
      setGates(gatesData.gates);
      setNextBelief(nextData);
    } catch { /* silent */ }
  };

  const fetchBeliefRegistry = async () => {
    try {
      const res = await fetch(`${API_BASE}/beliefs`);
      const data = await res.json();
      setBeliefRegistry(data.beliefs || []);
    } catch { /* silent */ }
  };

  const fetchTransitions = async () => {
    if (!id) return;
    try {
      const res = await fetch(`${API_BASE}/leads/${id}/beliefs/transitions`);
      const data = await res.json();
      setTransitions(data.transitions || []);
    } catch { /* silent */ }
  };

  const handleBeliefUpdate = async (beliefId: string, newState: string) => {
    try {
      await fetch(`${API_BASE}/leads/${id}/beliefs/${beliefId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ state: newState }),
      });
      await fetchBeliefs();
      await fetchGatesAndNext();
    } catch { /* silent */ }
  };

  /* --- Build merged belief display list --- */
  const mergedBeliefs = CLUSTER_ORDER.flatMap(cluster => {
    const clusterBeliefs = beliefRegistry
      .filter((b: any) => b.cluster === cluster)
      .map((reg: any) => {
        const leadRow = beliefs.find((lb: any) => lb.belief_id === reg.id);
        return {
          belief_id: reg.id,
          name: reg.name,
          cluster: reg.cluster,
          is_hard_gate: reg.is_hard_gate,
          policy_status: reg.policy_status,
          state: leadRow?.state || "UNKNOWN",
          investor_relevance: leadRow?.investor_relevance || "standard",
          evidence: leadRow?.evidence || null,
          evidence_source: leadRow?.evidence_source || null,
          confidence: leadRow?.confidence || null,
          relevance_rationale: leadRow?.relevance_rationale || null,
        };
      });
    return clusterBeliefs;
  });

  const beliefsByCluster = CLUSTER_ORDER.map(cluster => ({
    cluster,
    label: CLUSTER_LABELS[cluster] || cluster,
    beliefs: mergedBeliefs.filter(b => b.cluster === cluster),
  }));

  if (isLeadLoading) {
    return (
      <div className="space-y-6 max-w-5xl mx-auto">
        <Skeleton className="h-8 w-32" />
        <Card>
          <CardHeader>
            <Skeleton className="h-8 w-64 mb-2" />
            <Skeleton className="h-4 w-48" />
          </CardHeader>
        </Card>
      </div>
    );
  }

  if (!lead) return <div>Lead not found</div>;

  return (
    <div className="space-y-6 max-w-5xl mx-auto pb-12">
      {/* --- Header (unchanged) --- */}
      <div className="flex items-center gap-4">
        <Link href="/leads" className="p-2 hover:bg-muted rounded-full transition-colors">
            <ArrowLeft className="w-5 h-5" />
        </Link>
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{lead.name}</h1>
          <p className="text-muted-foreground mt-1">{lead.company || "No company"}</p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Badge variant="outline" className="text-sm px-3 py-1">{lead.pipeline_stage}</Badge>
          {lead.detected_persona && <Badge className="text-sm px-3 py-1 bg-primary text-primary-foreground">{lead.detected_persona}</Badge>}
          <Link href={`/call-prep?lead=${id}`}>
            <Button size="sm" variant="outline" className="gap-1">
              <Phone className="w-3.5 h-3.5" />
              Call Prep
            </Button>
          </Link>
        </div>
      </div>

      {/* --- Tab structure --- */}
      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as "overview" | "beliefs")}>
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="beliefs">Intelligence & Beliefs</TabsTrigger>
        </TabsList>

        {/* ============ OVERVIEW TAB (existing content, unchanged) ============ */}
        <TabsContent value="overview">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="md:col-span-2 space-y-6">
              {nextAction && (
                <Card className="border-primary bg-primary/5">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-lg flex items-center gap-2 text-primary">
                      <Target className="w-5 h-5" /> Next Best Action
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-lg font-medium mb-2">{nextAction.action}</div>
                    <p className="text-sm text-muted-foreground mb-4">{nextAction.rationale}</p>
                    {nextAction.suggested_documents.length > 0 && (
                      <div>
                        <div className="text-xs uppercase tracking-wider text-muted-foreground font-semibold mb-2">Suggested Documents</div>
                        <div className="flex flex-wrap gap-2">
                          {nextAction.suggested_documents.map(doc => (
                            <Badge key={doc} variant="secondary" className="font-normal">{doc}</Badge>
                          ))}
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}

              <Card>
                <CardHeader>
                  <CardTitle>Interaction Timeline</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-8">
                    {lead.send_log.map((log, index) => (
                      <div key={log.send_id} className="relative pl-8">
                        {/* Timeline line */}
                        {index !== lead.send_log.length - 1 && (
                          <div className="absolute left-3.5 top-8 bottom-[-2rem] w-px bg-border" />
                        )}
                        
                        {/* Timeline dot */}
                        <div className="absolute left-2 top-1.5 w-3 h-3 rounded-full bg-primary ring-4 ring-background" />
                        
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-medium text-sm">{format(new Date(log.date), "MMM d, yyyy h:mm a")}</span>
                          <Badge variant="outline" className="text-xs font-normal">Sent Email</Badge>
                        </div>
                        
                        <div className="bg-muted/30 border rounded-md p-4 mt-2">
                          {log.transcript_summary && (
                            <div className="mb-3 text-sm text-muted-foreground border-b pb-3 border-border/50">
                              "{log.transcript_summary}"
                            </div>
                          )}
                          
                          <div className="text-xs uppercase tracking-wider text-muted-foreground font-semibold mb-2">Documents Sent</div>
                          <ul className="space-y-1">
                            {log.documents_sent.map(doc => (
                              <li key={doc} className="text-sm flex items-center gap-2">
                                <FileText className="w-3.5 h-3.5 text-primary" />
                                {doc}
                              </li>
                            ))}
                          </ul>
                        </div>
                      </div>
                    ))}
                    
                    {lead.send_log.length === 0 && (
                      <div className="text-center text-muted-foreground py-8 border border-dashed rounded-lg">
                        No interactions logged yet.
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            </div>

            <div className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle>Details</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <div className="text-sm text-muted-foreground">First Contact</div>
                    <div className="font-medium">{format(new Date(lead.first_contact), "MMM d, yyyy")}</div>
                  </div>
                  <div>
                    <div className="text-sm text-muted-foreground">Total Sends</div>
                    <div className="font-medium">{lead.send_count}</div>
                  </div>
                  <div>
                    <div className="text-sm text-muted-foreground">Status</div>
                    <div>
                      <Badge variant={lead.archived ? "secondary" : "default"} className={!lead.archived ? "bg-green-600 hover:bg-green-700" : ""}>
                        {lead.archived ? "Archived" : "Active"}
                      </Badge>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Persona Validation</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {(lead as any).confirmed_persona ? (
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <CheckCircle className="w-4 h-4 text-green-400" />
                        <span className="text-sm font-medium text-green-400">Confirmed</span>
                      </div>
                      <div>
                        <div className="text-xs text-muted-foreground">Confirmed Persona</div>
                        <div className="text-sm font-medium">{(lead as any).confirmed_persona}</div>
                      </div>
                      <div>
                        <div className="text-xs text-muted-foreground">Archetype</div>
                        <div className="text-sm font-medium">{(lead as any).confirmed_archetype}</div>
                      </div>
                      {(lead as any).detected_persona !== (lead as any).confirmed_persona && (
                        <div className="text-xs text-amber-400 flex items-center gap-1">
                          <AlertCircle className="w-3 h-3" />
                          Originally detected: {(lead as any).detected_persona}
                        </div>
                      )}
                    </div>
                  ) : lead.detected_persona ? (
                    <div className="space-y-3">
                      <div className="text-sm">
                        <span className="text-muted-foreground">Detected: </span>
                        <span className="font-medium">{lead.detected_persona}</span>
                      </div>
                      {confirmResult && (
                        <div className={`text-xs p-2 rounded ${confirmResult.startsWith("Error") ? "bg-red-500/10 text-red-400" : "bg-green-500/10 text-green-400"}`}>
                          {confirmResult}
                        </div>
                      )}
                      {!confirmOpen ? (
                        <Button size="sm" variant="outline" className="w-full gap-1" onClick={() => setConfirmOpen(true)}>
                          <CheckCircle className="w-3 h-3" />Validate Persona
                        </Button>
                      ) : (
                        <div className="space-y-3 border rounded-md p-3">
                          <p className="text-xs text-muted-foreground">Is "{lead.detected_persona}" correct?</p>
                          <div className="flex gap-2">
                            <Button size="sm" variant="default" className="flex-1 gap-1" onClick={() => handleConfirmPersona(true)} disabled={confirming}>
                              {confirming ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle className="w-3 h-3" />}
                              Correct
                            </Button>
                            <Button size="sm" variant="outline" className="flex-1 gap-1" onClick={() => setSelectedPersona("")}>
                              <XCircle className="w-3 h-3" />Wrong
                            </Button>
                          </div>
                          {selectedPersona !== undefined && !confirming && (
                            <div className="space-y-2">
                              <select className="w-full text-sm bg-background border rounded-md px-2 py-1.5" value={selectedPersona} onChange={(e) => setSelectedPersona(e.target.value)}>
                                <option value="">Select correct persona...</option>
                                {PERSONAS.filter((p) => p !== lead.detected_persona).map((p) => (
                                  <option key={p} value={p}>{p}</option>
                                ))}
                              </select>
                              <textarea className="w-full text-xs bg-background border rounded-md px-2 py-1.5 h-16 resize-none" placeholder="Optional notes..." value={confirmNotes} onChange={(e) => setConfirmNotes(e.target.value)} />
                              <Button size="sm" className="w-full" disabled={!selectedPersona || confirming} onClick={() => handleConfirmPersona(false)}>
                                {confirming ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : null}
                                Submit Correction
                              </Button>
                            </div>
                          )}
                          <button className="text-xs text-muted-foreground hover:text-foreground" onClick={() => setConfirmOpen(false)}>Cancel</button>
                        </div>
                      )}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">No persona detected yet</p>
                  )}
                </CardContent>
              </Card>

              {lead.stage_history && lead.stage_history.length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Stage History</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-4">
                      {lead.stage_history.map((history, i) => (
                        <div key={i} className="flex justify-between items-start text-sm">
                          <div>
                            <div className="font-medium">{history.stage}</div>
                            <div className="text-muted-foreground text-xs">{history.logged_by}</div>
                          </div>
                          <div className="text-muted-foreground text-xs whitespace-nowrap">
                            {format(new Date(history.date), "MMM d, yyyy")}
                          </div>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>
          </div>
        </TabsContent>

        {/* ============ INTELLIGENCE & BELIEFS TAB ============ */}
        <TabsContent value="beliefs">
          <div className="space-y-6">

            {/* Panel 1 — Notes + Generate Profile */}
            <Card>
              <CardHeader>
                <CardTitle>Operator Notes</CardTitle>
                <CardDescription>Add context about this investor before generating their profile.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="relative">
                  <textarea
                    className="w-full text-sm bg-background border rounded-md px-3 py-2 resize-none"
                    rows={4}
                    placeholder="Add your observations about this investor — what they said, their concerns, their situation..."
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    onBlur={handleNotesSave}
                  />
                  {notesSaving && <span className="absolute top-2 right-2 text-xs text-muted-foreground">Saving...</span>}
                  {notesSaved && <span className="absolute top-2 right-2 text-xs text-green-400">Saved</span>}
                </div>
                <div className="flex items-center gap-3">
                  <Button
                    size="sm"
                    className="gap-1"
                    disabled={generatingProfile || (!notes.trim() && !(lead as any).transcript_text)}
                    onClick={handleGenerateProfile}
                  >
                    {generatingProfile ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                    Generate Profile
                  </Button>
                  {generateError && <span className="text-xs text-red-400">{generateError}</span>}
                </div>
              </CardContent>
            </Card>

            {/* Panel 2 — Intelligence Summary */}
            <Card>
              <CardHeader>
                <CardTitle>Investor Profile</CardTitle>
              </CardHeader>
              <CardContent>
                {intelligenceLoading ? (
                  <div className="space-y-3">
                    <Skeleton className="h-6 w-48" />
                    <Skeleton className="h-20 w-full" />
                  </div>
                ) : !intelligence ? (
                  <p className="text-sm text-muted-foreground">No profile generated yet — add notes or upload a transcript, then click Generate Profile.</p>
                ) : (
                  <div className="space-y-4">
                    {/* Row 1: Pills */}
                    <div className="flex flex-wrap gap-2">
                      <Badge className={
                        intelligence.qualification === "QUALIFIED" ? "bg-green-500 hover:bg-green-600" :
                        intelligence.qualification === "INSUFFICIENT_DATA" ? "bg-amber-400 hover:bg-amber-500 text-black" :
                        "bg-red-500 hover:bg-red-600"
                      }>
                        {intelligence.qualification}
                      </Badge>
                      {intelligence.cluster && (
                        <Badge className={
                          intelligence.cluster === "growth_seeker" ? "bg-blue-500 hover:bg-blue-600" :
                          intelligence.cluster === "preserver" ? "bg-teal-500 hover:bg-teal-600" :
                          "bg-purple-500 hover:bg-purple-600"
                        }>
                          {intelligence.cluster === "growth_seeker" ? "Growth Seeker" :
                           intelligence.cluster === "preserver" ? "Preserver" :
                           intelligence.cluster === "legacy_builder" ? "Legacy Builder" :
                           intelligence.cluster}
                        </Badge>
                      )}
                      {intelligence.hot_button && (
                        <Badge variant="outline">{HOT_BUTTON_LABELS[intelligence.hot_button] || intelligence.hot_button}</Badge>
                      )}
                    </div>

                    {/* Row 2: Profile summary */}
                    {intelligence.profile_summary && (
                      <p className="text-sm text-muted-foreground">{intelligence.profile_summary}</p>
                    )}

                    {/* Row 3: Readiness */}
                    {intelligence.readiness && (
                      <div className="space-y-1">
                        <Badge className={`${READINESS_COLOURS[intelligence.readiness] || "bg-gray-400"} text-white`}>
                          {intelligence.readiness.replace(/_/g, " ")}
                        </Badge>
                        {intelligence.recommended_action && (
                          <p className="text-sm text-muted-foreground">{intelligence.recommended_action}</p>
                        )}
                      </div>
                    )}

                    {/* Row 4: Primary blocker */}
                    {intelligence.primary_blocker && (
                      <div className="text-sm text-amber-400">
                        Blocker: {intelligence.primary_blocker} ({intelligence.blocker_type})
                      </div>
                    )}

                    {/* Row 5: Hot button quote */}
                    {intelligence.hot_button_quote && (
                      <blockquote className="text-sm italic text-muted-foreground border-l-2 border-muted pl-3">
                        {intelligence.hot_button_quote}
                      </blockquote>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Panel 2b — SPIN Framework */}
            {intelligence?.spin_situation && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">SPIN Framework</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {[
                      { label: "Situation", value: intelligence.spin_situation, colour: "border-blue-500/30" },
                      { label: "Problem", value: intelligence.spin_problem, colour: "border-red-500/30" },
                      { label: "Implication", value: intelligence.spin_implication, colour: "border-amber-500/30" },
                      { label: "Need-Payoff", value: intelligence.spin_need_payoff, colour: "border-green-500/30" },
                    ].map(s => s.value && (
                      <div key={s.label} className={`border-l-2 ${s.colour} pl-3 space-y-1`}>
                        <div className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">{s.label}</div>
                        <p className="text-sm">{s.value}</p>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Panel 2c — Qualification Flags */}
            {intelligence && (intelligence.higher_rate_taxpayer !== undefined || intelligence.capital_available !== undefined) && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Qualification Flags</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                    {[
                      { key: "higher_rate_taxpayer", label: "Higher Rate Taxpayer" },
                      { key: "capital_available", label: "Capital Available" },
                      { key: "self_directed", label: "Self-Directed" },
                      { key: "open_to_early_stage_risk", label: "Open to Early-Stage Risk" },
                      { key: "ifa_involved", label: "IFA Involved" },
                      { key: "already_done_eis", label: "Previous EIS Experience" },
                      { key: "estate_above_2m", label: "Estate Above 2M" },
                      { key: "assets_abroad", label: "Assets Abroad" },
                      { key: "vct_aim_experience", label: "VCT/AIM Experience" },
                    ].map(flag => {
                      const val = intelligence[flag.key];
                      if (val === undefined || val === null) return null;
                      return (
                        <div key={flag.key} className="flex items-center gap-2 text-sm">
                          {val ? (
                            <CheckCircle className="w-4 h-4 text-green-500 shrink-0" />
                          ) : (
                            <XCircle className="w-4 h-4 text-red-400 shrink-0" />
                          )}
                          <span>{flag.label}</span>
                        </div>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Panel 3 — Belief Dot Grid */}
            <Card>
              <CardHeader>
                <CardTitle>Belief Map</CardTitle>
              </CardHeader>
              <CardContent>
                {beliefsLoading && beliefRegistry.length === 0 ? (
                  <Skeleton className="h-32 w-full" />
                ) : beliefRegistry.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No belief data available.</p>
                ) : (
                  <div className="space-y-4">
                    {beliefsByCluster.map(({ cluster, label, beliefs: clusterBeliefs }) => (
                      clusterBeliefs.length > 0 && (
                        <div key={cluster}>
                          <div className="text-xs uppercase tracking-wider text-muted-foreground font-semibold mb-2">{label}</div>
                          <div className="flex flex-wrap gap-2 mb-1">
                            {clusterBeliefs.map(b => {
                              const isBlocked = b.policy_status === "blocked_pending_legal";
                              const isNotApplicable = b.investor_relevance === "not_applicable";
                              const isHardGate = b.is_hard_gate;
                              return (
                                <button
                                  key={b.belief_id}
                                  title={b.name}
                                  className={`relative w-8 h-8 rounded-full ${STATE_COLOURS[b.state] || "bg-gray-300"} transition-all hover:ring-2 hover:ring-primary ${
                                    (isBlocked || isNotApplicable) ? "opacity-50" : ""
                                  } ${selectedBeliefId === b.belief_id ? "ring-2 ring-primary" : ""}`}
                                  onClick={() => setSelectedBeliefId(selectedBeliefId === b.belief_id ? null : b.belief_id)}
                                >
                                  <span className="absolute inset-0 flex items-center justify-center text-[10px] font-bold text-white drop-shadow-sm">
                                    {b.belief_id}
                                  </span>
                                  {isHardGate && (
                                    <Lock className="absolute -top-1 -right-1 w-3 h-3 text-foreground" />
                                  )}
                                </button>
                              );
                            })}
                          </div>
                          {selectedBeliefId && clusterBeliefs.some(b => b.belief_id === selectedBeliefId) && (() => {
                          const sel = clusterBeliefs.find(b => b.belief_id === selectedBeliefId)!;
                          return (
                            <div className="mt-2 mb-2 max-w-sm bg-muted/30 border rounded-md p-3 space-y-2">
                              <div className="text-xs font-medium">{sel.name}</div>
                              {sel.evidence && (
                                <blockquote className="text-xs italic text-muted-foreground border-l-2 border-muted pl-2">
                                  {sel.evidence}
                                </blockquote>
                              )}
                              <div className="flex flex-wrap gap-2">
                                {sel.confidence && (
                                  <Badge variant="outline" className="text-[10px]">
                                    {sel.confidence} confidence
                                  </Badge>
                                )}
                                {sel.evidence_source && (
                                  <Badge variant="outline" className="text-[10px]">
                                    {sel.evidence_source.replace(/_/g, " ")}
                                  </Badge>
                                )}
                                {sel.investor_relevance && sel.investor_relevance !== "standard" && (
                                  <Badge variant="outline" className="text-[10px]">
                                    {sel.investor_relevance} relevance
                                  </Badge>
                                )}
                              </div>
                              {sel.relevance_rationale && (
                                <p className="text-[10px] text-muted-foreground">{sel.relevance_rationale}</p>
                              )}
                              <Select
                                value={sel.state || "UNKNOWN"}
                                onValueChange={(val) => {
                                  handleBeliefUpdate(selectedBeliefId, val);
                                  setSelectedBeliefId(null);
                                }}
                              >
                                <SelectTrigger className="w-full h-8 text-sm">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="UNKNOWN">Unknown</SelectItem>
                                  <SelectItem value="ABSENT">Absent</SelectItem>
                                  <SelectItem value="PARTIAL">Partial</SelectItem>
                                  <SelectItem value="ESTABLISHED">Established</SelectItem>
                                  <SelectItem value="BLOCKED">Blocked</SelectItem>
                                </SelectContent>
                              </Select>
                            </div>
                          );
                        })()}
                        </div>
                      )
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Panel 3b — Belief Transitions */}
            {transitions.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Belief History</CardTitle>
                  <CardDescription>Recent belief state changes for this investor.</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2 max-h-48 overflow-y-auto">
                    {transitions.slice(0, 20).map((t: any, i: number) => (
                      <div key={i} className="flex items-center gap-2 text-sm">
                        <Badge variant="outline" className="text-[10px] shrink-0">{t.belief_id}</Badge>
                        <span className={`w-2 h-2 rounded-full shrink-0 ${STATE_COLOURS[t.previous_state] || "bg-gray-300"}`} />
                        <span className="text-muted-foreground">→</span>
                        <span className={`w-2 h-2 rounded-full shrink-0 ${STATE_COLOURS[t.new_state] || "bg-gray-300"}`} />
                        <span className="text-xs font-medium">{t.previous_state} → {t.new_state}</span>
                        <span className="text-xs text-muted-foreground ml-auto">
                          {t.created_at ? format(new Date(t.created_at), "MMM d, HH:mm") : ""}
                        </span>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Panel 4 — Gate Status + Next Step */}
            <Card>
              <CardHeader>
                <CardTitle>Next Step</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {!gates ? (
                  <p className="text-sm text-muted-foreground">No gate data available.</p>
                ) : (
                  <div className="space-y-2">
                    {Object.entries(GATE_LABELS).map(([key, label]) => {
                      const gate = gates[key];
                      const isOpen = gate?.open === true;
                      return (
                        <div key={key} className="flex items-center gap-2 text-sm">
                          {isOpen ? (
                            <CheckCircle className="w-4 h-4 text-green-500 shrink-0" />
                          ) : (
                            <XCircle className="w-4 h-4 text-red-400 shrink-0" />
                          )}
                          <span className="font-medium">{label}</span>
                          {gate?.reason && (
                            <span className="text-muted-foreground">— {gate.reason}</span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}

                <div className="border-t pt-4">
                  {nextBelief?.next_belief ? (
                    <div className="space-y-1">
                      <div className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">Next belief to establish:</div>
                      <div className="text-sm font-bold">{nextBelief.next_belief.name || nextBelief.next_belief.belief_id}</div>
                      <Badge className={`${STATE_COLOURS[nextBelief.next_belief.current_state] || "bg-gray-300"} text-white text-xs`}>
                        {nextBelief.next_belief.current_state || "UNKNOWN"}
                      </Badge>
                      {nextBelief.next_belief.recommended_document_id && (
                        <div className="text-xs text-muted-foreground mt-1">
                          Recommended document: {nextBelief.next_belief.recommended_document_id}
                        </div>
                      )}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">All active beliefs established or in progress.</p>
                  )}
                </div>
              </CardContent>
            </Card>

          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
