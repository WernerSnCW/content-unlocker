import { useParams, Link } from "wouter";
import { useGetLead, useGetLeadNextAction } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Clock, FileText, Phone, Target, AlertCircle } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { format } from "date-fns";

export default function LeadDetail() {
  const params = useParams();
  const id = params.id as string;

  const { data: lead, isLoading: isLeadLoading } = useGetLead(id, { query: { enabled: !!id } });
  const { data: nextAction, isLoading: isNextActionLoading } = useGetLeadNextAction(id, { query: { enabled: !!id } });

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
