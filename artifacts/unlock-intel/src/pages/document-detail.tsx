import { useParams, Link } from "wouter";
import { useGetDocument, useGetComplianceConstants, useUpdateDocument } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, AlertTriangle, ShieldCheck, FileText, CheckCircle2, ChevronRight } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";

export default function DocumentDetail() {
  const params = useParams();
  const id = params.id as string;

  const { data: document, isLoading: isDocumentLoading } = useGetDocument(id, { query: { enabled: !!id } });
  const { data: compliance, isLoading: isComplianceLoading } = useGetComplianceConstants();
  const updateMutation = useUpdateDocument();

  const handleMarkClean = () => {
    if (!document) return;
    updateMutation.mutate({
      id: document.id,
      data: { review_state: "CLEAN" }
    });
  };

  if (isDocumentLoading) {
    return (
      <div className="space-y-6 max-w-6xl mx-auto">
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-[400px] w-full" />
      </div>
    );
  }

  if (!document) return <div>Document not found</div>;

  return (
    <div className="space-y-6 max-w-6xl mx-auto pb-12">
      <div className="flex items-center gap-4">
        <Link href="/registry" className="p-2 hover:bg-muted rounded-full transition-colors">
            <ArrowLeft className="w-5 h-5" />
        </Link>
        <div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="font-mono">{document.file_code}</Badge>
            <h1 className="text-2xl font-bold tracking-tight">{document.name}</h1>
          </div>
          <p className="text-muted-foreground mt-1 text-sm">{document.description}</p>
        </div>
      </div>

      {document.review_state === "REQUIRES_REVIEW" && (
        <div className="bg-orange-50 border border-orange-200 text-orange-800 p-4 rounded-lg flex items-start gap-4">
          <AlertTriangle className="w-5 h-5 text-orange-600 mt-0.5 flex-shrink-0" />
          <div className="flex-1">
            <h3 className="font-semibold text-orange-900">Review Required</h3>
            <p className="text-sm mt-1">This document has been flagged due to upstream dependency changes or compliance updates.</p>
          </div>
          <Button 
            variant="outline" 
            className="border-orange-300 text-orange-800 hover:bg-orange-100"
            onClick={handleMarkClean}
            disabled={updateMutation.isPending}
          >
            {updateMutation.isPending ? "Updating..." : "Mark as Clean"}
          </Button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <Card>
            <CardHeader className="flex flex-row justify-between items-center pb-2">
              <CardTitle>Content Preview</CardTitle>
              <Badge variant="secondary">v{document.version}</Badge>
            </CardHeader>
            <CardContent>
              <div className="prose prose-sm max-w-none prose-h1:text-xl prose-h2:text-lg dark:prose-invert">
                {document.content ? (
                  <div dangerouslySetInnerHTML={{ __html: document.content.replace(/\n/g, '<br/>') }} />
                ) : (
                  <div className="text-center py-12 text-muted-foreground border border-dashed rounded">
                    Content preview not available
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {(document.upstream_dependencies.length > 0 || document.downstream_dependents.length > 0) && (
            <Card>
              <CardHeader>
                <CardTitle>Dependency Chain</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {document.upstream_dependencies.length > 0 && (
                    <div>
                      <h4 className="text-sm font-medium text-muted-foreground mb-2 uppercase tracking-wider">Upstream (Relies on)</h4>
                      <ul className="space-y-2">
                        {document.upstream_dependencies.map(dep => (
                          <li key={dep} className="flex items-center gap-2 text-sm bg-muted/50 p-2 rounded">
                            <FileText className="w-4 h-4 text-muted-foreground" />
                            <span className="font-mono text-xs bg-background border px-1 rounded">{dep}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  
                  {document.downstream_dependents.length > 0 && (
                    <div>
                      <h4 className="text-sm font-medium text-muted-foreground mb-2 uppercase tracking-wider">Downstream (Affects)</h4>
                      <ul className="space-y-2">
                        {document.downstream_dependents.map(dep => (
                          <li key={dep} className="flex items-center gap-2 text-sm bg-muted/50 p-2 rounded">
                            <FileText className="w-4 h-4 text-muted-foreground" />
                            <span className="font-mono text-xs bg-background border px-1 rounded">{dep}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Metadata</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <div className="text-sm text-muted-foreground">Lifecycle Status</div>
                <div className="mt-1">
                  <Badge className={document.lifecycle_status === 'CURRENT' ? 'bg-green-600' : ''}>
                    {document.lifecycle_status}
                  </Badge>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <div className="text-sm text-muted-foreground">Category</div>
                  <div className="font-medium text-sm">{document.category}</div>
                </div>
                <div>
                  <div className="text-sm text-muted-foreground">Tier</div>
                  <div className="font-medium text-sm">Tier {document.tier}</div>
                </div>
              </div>
              <div>
                <div className="text-sm text-muted-foreground mb-1">Target Personas</div>
                <div className="flex flex-wrap gap-1">
                  {document.persona_relevance.map(p => (
                    <Badge key={p} variant="secondary" className="text-xs">{p}</Badge>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border-primary/20 bg-primary/5">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-primary" /> Compliance Context
              </CardTitle>
            </CardHeader>
            <CardContent>
              {isComplianceLoading ? (
                <div className="space-y-2"><Skeleton className="h-4 w-full" /><Skeleton className="h-4 w-full" /></div>
              ) : (
                <div className="space-y-3">
                  {compliance?.constants.map(c => (
                    <div key={c.key} className="text-sm">
                      <span className="text-muted-foreground block text-xs">{c.label}</span>
                      <span className="font-mono font-medium">{c.value}</span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
