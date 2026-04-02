import { useParams, Link } from "wouter";
import { useGetDocument, useGetComplianceConstants, useUpdateDocument } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, AlertTriangle, ShieldCheck, FileText, Download, Pencil, X, Save } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useState, useEffect } from "react";
import ReactMarkdown from "react-markdown";

export default function DocumentDetail() {
  const params = useParams();
  const id = params.id as string;

  const { data: document, isLoading: isDocumentLoading, refetch } = useGetDocument(id, { query: { enabled: !!id } });
  const { data: compliance, isLoading: isComplianceLoading } = useGetComplianceConstants();
  const updateMutation = useUpdateDocument();

  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editContent, setEditContent] = useState("");

  useEffect(() => {
    if (document) {
      setEditName(document.name);
      setEditDescription(document.description || "");
      setEditContent(document.content || "");
    }
  }, [document]);

  const handleMarkClean = () => {
    if (!document) return;
    updateMutation.mutate(
      { id: document.id, data: { review_state: "CLEAN" } },
      { onSuccess: () => refetch() }
    );
  };

  const handleSave = () => {
    if (!document) return;
    updateMutation.mutate(
      {
        id: document.id,
        data: {
          name: editName !== document.name ? editName : undefined,
          description: editDescription !== (document.description || "") ? editDescription : undefined,
          content: editContent !== (document.content || "") ? editContent : undefined,
        },
      },
      {
        onSuccess: () => {
          setEditing(false);
          refetch();
        },
      }
    );
  };

  const handleDownload = () => {
    if (!document) return;
    const content = document.content || "No content available.";
    const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = window.document.createElement("a");
    a.href = url;
    a.download = `${document.file_code}_${document.name.replace(/\s+/g, "_")}_v${document.version}.md`;
    a.click();
    URL.revokeObjectURL(url);
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
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-4">
          <Link href="/registry" className="p-2 hover:bg-muted rounded-full transition-colors">
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <div>
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="font-mono">{document.file_code}</Badge>
              {editing ? (
                <Input
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="text-xl font-bold h-9 w-[400px]"
                />
              ) : (
                <h1 className="text-2xl font-bold tracking-tight">{document.name}</h1>
              )}
            </div>
            {editing ? (
              <Input
                value={editDescription}
                onChange={(e) => setEditDescription(e.target.value)}
                className="mt-2 text-sm w-[500px]"
                placeholder="Description"
              />
            ) : (
              <p className="text-muted-foreground mt-1 text-sm">{document.description}</p>
            )}
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={handleDownload}>
            <Download className="w-4 h-4 mr-1.5" />
            Download
          </Button>
          {editing ? (
            <>
              <Button variant="ghost" size="sm" onClick={() => setEditing(false)}>
                <X className="w-4 h-4 mr-1.5" />
                Cancel
              </Button>
              <Button size="sm" onClick={handleSave} disabled={updateMutation.isPending}>
                <Save className="w-4 h-4 mr-1.5" />
                {updateMutation.isPending ? "Saving..." : "Save"}
              </Button>
            </>
          ) : (
            <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
              <Pencil className="w-4 h-4 mr-1.5" />
              Edit
            </Button>
          )}
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
              <CardTitle>{editing ? "Edit Content" : "Content Preview"}</CardTitle>
              <Badge variant="secondary">v{document.version}</Badge>
            </CardHeader>
            <CardContent>
              {editing ? (
                <Textarea
                  value={editContent}
                  onChange={(e) => setEditContent(e.target.value)}
                  className="min-h-[500px] font-mono text-sm leading-relaxed"
                  placeholder="Document content (markdown supported)..."
                />
              ) : document.content ? (
                <div className="prose prose-sm max-w-none dark:prose-invert
                  prose-headings:text-foreground prose-headings:font-semibold
                  prose-p:text-foreground/85 prose-p:leading-relaxed
                  prose-strong:text-foreground prose-strong:font-semibold
                  prose-li:text-foreground/85
                  prose-hr:border-border prose-hr:my-6
                  prose-table:text-sm prose-th:text-left prose-th:font-semibold prose-th:pb-2 prose-th:border-b
                  prose-td:py-1.5 prose-td:pr-4
                ">
                  <ReactMarkdown>{document.content}</ReactMarkdown>
                </div>
              ) : (
                <div className="text-center py-12 text-muted-foreground border border-dashed rounded">
                  No content available. Click Edit to add content.
                </div>
              )}
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
                <div className="text-sm text-muted-foreground">Filename</div>
                <div className="font-mono text-xs mt-1 bg-muted p-1.5 rounded">{document.filename}</div>
              </div>
              <div>
                <div className="text-sm text-muted-foreground mb-1">Pipeline Stages</div>
                <div className="flex flex-wrap gap-1">
                  {document.pipeline_stage_relevance.map(s => (
                    <Badge key={s} variant="outline" className="text-xs">{s}</Badge>
                  ))}
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
