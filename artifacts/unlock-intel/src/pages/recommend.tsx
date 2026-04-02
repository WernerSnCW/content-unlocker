import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useListLeads, useAnalyzeTranscript, useRankDocuments, useConfirmSend, useGenerateEmailDraft } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Search, Loader2, User, FileText, Send, AlertTriangle } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";

export default function Recommend() {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null);
  const [transcript, setTranscript] = useState("");

  const { data: leads, isLoading: isLeadsLoading } = useListLeads({ search: searchQuery }, { query: { enabled: searchQuery.length > 0 } });
  
  const analyzeMutation = useAnalyzeTranscript();
  const rankMutation = useRankDocuments();
  const emailMutation = useGenerateEmailDraft();
  const confirmMutation = useConfirmSend();

  const handleAnalyze = async () => {
    if (!transcript) return;
    
    const analysis = await analyzeMutation.mutateAsync({
      data: { transcript, lead_id: selectedLeadId }
    });

    const ranking = await rankMutation.mutateAsync({
      data: {
        lead_id: selectedLeadId,
        detected_persona: analysis.detected_persona.name,
        pipeline_stage: analysis.pipeline_stage.stage,
        transcript_summary: analysis.transcript_summary,
        objections: analysis.objections.map(o => o.objection)
      }
    });

    const selectedLead = leads?.find(l => l.id === selectedLeadId);
    if (selectedLead && ranking.ranked_documents.length > 0) {
      await emailMutation.mutateAsync({
        data: {
          lead_name: selectedLead.name,
          detected_persona: analysis.detected_persona.name,
          pipeline_stage: analysis.pipeline_stage.stage,
          transcript_summary: analysis.transcript_summary,
          document_names: ranking.ranked_documents.slice(0, 3).map(d => d.name)
        }
      });
    }
  };

  const handleConfirm = () => {
    if (!selectedLeadId || !analyzeMutation.data || !rankMutation.data) return;
    
    confirmMutation.mutate({
      data: {
        lead_id: selectedLeadId,
        document_ids: rankMutation.data.ranked_documents.map(d => d.document_id),
        transcript_summary: analyzeMutation.data.transcript_summary,
        detected_persona: analyzeMutation.data.detected_persona.name,
        pipeline_stage: analyzeMutation.data.pipeline_stage.stage,
        analysis_confidence: {
          persona: analyzeMutation.data.detected_persona.confidence_score,
          stage: analyzeMutation.data.pipeline_stage.confidence_score
        },
        email_sent: true
      }
    });
  };

  const selectedLead = leads?.find(l => l.id === selectedLeadId);

  return (
    <div className="h-[calc(100vh-8rem)] flex flex-col lg:flex-row gap-6">
      {/* Panel 1: Lead Context */}
      <div className="w-full lg:w-80 flex flex-col gap-4 border-r pr-6">
        <h2 className="font-semibold text-lg">Lead Context</h2>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input 
            placeholder="Search leads..." 
            className="pl-9"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
          />
        </div>

        {searchQuery.length > 0 && !selectedLeadId && (
          <Card className="mt-2">
            <CardContent className="p-2 flex flex-col gap-1">
              {isLeadsLoading ? <div className="p-4 text-center text-sm text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin mx-auto" /></div> : null}
              {leads?.map(lead => (
                <button 
                  key={lead.id}
                  onClick={() => setSelectedLeadId(lead.id)}
                  className="text-left px-3 py-2 text-sm hover:bg-muted rounded-md transition-colors"
                >
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

      {/* Panel 2: Analysis */}
      <div className="flex-1 flex flex-col gap-4">
        <h2 className="font-semibold text-lg">Input & Analysis</h2>
        <Card className="flex-1 flex flex-col">
          <CardContent className="p-0 flex-1 flex flex-col">
            <Textarea 
              className="flex-1 resize-none border-0 focus-visible:ring-0 rounded-none p-6 text-base"
              placeholder="Paste call transcript, meeting notes, or email thread here..."
              value={transcript}
              onChange={e => setTranscript(e.target.value)}
            />
            <div className="p-4 border-t bg-muted/30 flex justify-between items-center">
              <span className="text-sm text-muted-foreground">
                {transcript.length} characters
              </span>
              <Button 
                onClick={handleAnalyze} 
                disabled={!transcript || analyzeMutation.isPending}
                className="gap-2"
              >
                {analyzeMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                Analyze & Recommend
              </Button>
            </div>
          </CardContent>
        </Card>

        {analyzeMutation.data && (
          <Card className="bg-card">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Intelligence Output</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="p-3 border rounded-md">
                  <div className="text-xs text-muted-foreground uppercase tracking-wider mb-2">Detected Persona</div>
                  <div className="font-medium flex items-center justify-between">
                    {analyzeMutation.data.detected_persona.name}
                    <Badge variant={analyzeMutation.data.detected_persona.confidence_score > 0.8 ? "default" : "destructive"}>
                      {Math.round(analyzeMutation.data.detected_persona.confidence_score * 100)}%
                    </Badge>
                  </div>
                </div>
                <div className="p-3 border rounded-md">
                  <div className="text-xs text-muted-foreground uppercase tracking-wider mb-2">Pipeline Stage</div>
                  <div className="font-medium flex items-center justify-between">
                    {analyzeMutation.data.pipeline_stage.stage}
                    <Badge variant={analyzeMutation.data.pipeline_stage.confidence_score > 0.8 ? "default" : "destructive"}>
                      {Math.round(analyzeMutation.data.pipeline_stage.confidence_score * 100)}%
                    </Badge>
                  </div>
                </div>
              </div>
              
              {analyzeMutation.data.objections.length > 0 && (
                <div className="p-3 border rounded-md">
                  <div className="text-xs text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1">
                    <AlertTriangle className="w-3 h-3" /> Detected Objections
                  </div>
                  <ul className="space-y-2">
                    {analyzeMutation.data.objections.map((obj, i) => (
                      <li key={i} className="text-sm">
                        <span className="font-medium">{obj.objection}:</span> {obj.suggested_response}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>

      {/* Panel 3: Recommendations */}
      <div className="w-full lg:w-[400px] flex flex-col gap-4 border-l pl-6">
        <h2 className="font-semibold text-lg">Recommendations</h2>
        
        {!rankMutation.data && !rankMutation.isPending && (
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

        {rankMutation.data && (
          <div className="space-y-6 flex-1 overflow-y-auto pr-2">
            {rankMutation.data.ranked_documents.length > 0 ? (
              <div className="space-y-3">
                <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Suggested Documents</h3>
                {rankMutation.data.ranked_documents.slice(0, 3).map((doc, i) => (
                  <Card key={doc.document_id} className={`bg-card ${i === 0 ? 'border-primary shadow-sm' : ''}`}>
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
            ) : (
              <div className="p-4 bg-muted/50 rounded-lg text-center text-sm">
                {rankMutation.data.all_sent_message || "No suitable documents found."}
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

            <Button 
              className="w-full gap-2" 
              size="lg"
              onClick={handleConfirm}
              disabled={confirmMutation.isPending || !selectedLeadId || rankMutation.data.ranked_documents.length === 0}
            >
              {confirmMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              Log Send & Copy Email
            </Button>
            
            {confirmMutation.isSuccess && (
              <div className="text-sm text-green-600 text-center font-medium bg-green-50 p-2 rounded">
                Successfully logged!
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function Sparkles(props: any) {
  return (
    <svg
      {...props}
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z" />
      <path d="M5 3v4" />
      <path d="M19 17v4" />
      <path d="M3 5h4" />
      <path d="M17 19h4" />
    </svg>
  );
}
