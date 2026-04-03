import { useState } from "react";
import { useParams, Link } from "wouter";
import { useGetLead, useGetLeadNextAction } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Clock, FileText, Phone, Target, AlertCircle, CheckCircle, XCircle, Loader2 } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { format } from "date-fns";

const API_BASE = import.meta.env.VITE_API_URL || "/api";

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

export default function LeadDetail() {
  const params = useParams();
  const id = params.id as string;

  const { data: lead, isLoading: isLeadLoading, refetch } = useGetLead(id, { query: { enabled: !!id } });
  const { data: nextAction, isLoading: isNextActionLoading } = useGetLeadNextAction(id, { query: { enabled: !!id } });

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [selectedPersona, setSelectedPersona] = useState("");
  const [confirmNotes, setConfirmNotes] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [confirmResult, setConfirmResult] = useState<string | null>(null);

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
      <div className="flex items-center gap-4">
        <Link href="/leads" className="p-2 hover:bg-muted rounded-full transition-colors">
            <ArrowLeft className="w-5 h-5" />
        </Link>
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{lead.name}</h1>
          <p className="text-muted-foreground mt-1">{lead.company || "No company"}</p>
        </div>
        <div className="ml-auto flex gap-2">
          <Badge variant="outline" className="text-sm px-3 py-1">{lead.pipeline_stage}</Badge>
          {lead.detected_persona && <Badge className="text-sm px-3 py-1 bg-primary text-primary-foreground">{lead.detected_persona}</Badge>}
        </div>
      </div>

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
    </div>
  );
}
