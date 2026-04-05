import { useParams, Link } from "wouter";
import { useGetDocument, useGetComplianceConstants, useUpdateDocument, useExportToGoogleDocs, useImportFromGoogleDocs, useGetGdocsStatus } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, AlertTriangle, ShieldCheck, FileText, Download, Pencil, X, Save, ExternalLink, RefreshCw, FileUp, Lock, Unlock, Shield, Award, ChevronDown, ChevronRight, Loader2 } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useState, useEffect } from "react";
import ReactMarkdown from "react-markdown";

function TierLockBanner({ tier, onUnlock, isUnlocked }: { tier: number; onUnlock: () => void; isUnlocked: boolean }) {
  if (tier !== 1 || isUnlocked) return null;
  return (
    <div className="bg-red-50 border border-red-200 text-red-800 p-4 rounded-lg flex items-start gap-4">
      <Lock className="w-5 h-5 text-red-600 mt-0.5 flex-shrink-0" />
      <div className="flex-1">
        <h3 className="font-semibold text-red-900">Tier 1 — Foundational Document (Locked)</h3>
        <p className="text-sm mt-1">This is a core source-of-truth document. Changes here cascade to Tier 2 and Tier 3 documents. Editing is restricted to prevent accidental modifications.</p>
      </div>
      <Button
        variant="outline"
        size="sm"
        className="border-red-300 text-red-800 hover:bg-red-100 whitespace-nowrap"
        onClick={onUnlock}
      >
        <Unlock className="w-4 h-4 mr-1.5" />
        Unlock for Editing
      </Button>
    </div>
  );
}

function UnlockConfirmDialog({ docName, onConfirm, onCancel }: { docName: string; onConfirm: () => void; onCancel: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4 overflow-hidden">
        <div className="bg-red-50 border-b border-red-200 p-4 flex items-center gap-3">
          <Shield className="w-6 h-6 text-red-600" />
          <h2 className="text-lg font-semibold text-red-900">Unlock Foundational Document</h2>
        </div>
        <div className="p-6 space-y-4">
          <p className="text-sm text-foreground/80">
            You are about to unlock <strong>{docName}</strong> for editing. This is a <strong>Tier 1 foundational document</strong>.
          </p>
          <div className="bg-amber-50 border border-amber-200 rounded p-3 text-sm text-amber-800">
            <strong>Warning:</strong> Any changes to this document will trigger propagation alerts across all downstream Tier 2 and Tier 3 documents that depend on it.
          </div>
          <p className="text-sm text-muted-foreground">
            Please ensure you have reviewed the impact before proceeding. All edits will be logged in the changelog.
          </p>
        </div>
        <div className="p-4 bg-muted/30 border-t flex justify-end gap-3">
          <Button variant="outline" onClick={onCancel}>Cancel</Button>
          <Button variant="destructive" onClick={onConfirm}>
            <Unlock className="w-4 h-4 mr-1.5" />
            Confirm Unlock
          </Button>
        </div>
      </div>
    </div>
  );
}

function Tier2Warning() {
  return (
    <div className="bg-amber-50 border border-amber-200 text-amber-800 p-3 rounded-lg flex items-start gap-3 text-sm">
      <AlertTriangle className="w-4 h-4 text-amber-600 mt-0.5 flex-shrink-0" />
      <div>
        <strong>Tier 2 — Derived Document.</strong> Changes may affect downstream Tier 3 documents. Edits are logged.
      </div>
    </div>
  );
}

export default function DocumentDetail() {
  const params = useParams();
  const id = params.id as string;

  const { data: document, isLoading: isDocumentLoading, refetch } = useGetDocument(id, { query: { enabled: !!id } });
  const { data: compliance, isLoading: isComplianceLoading } = useGetComplianceConstants();
  const { data: gdocsStatus, refetch: refetchGdocs } = useGetGdocsStatus(id, { query: { enabled: !!id } });
  const updateMutation = useUpdateDocument();
  const exportMutation = useExportToGoogleDocs();
  const importMutation = useImportFromGoogleDocs();

  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editContent, setEditContent] = useState("");
  const [tier1Unlocked, setTier1Unlocked] = useState(false);
  const [showUnlockDialog, setShowUnlockDialog] = useState(false);
  const [pendingAction, setPendingAction] = useState<"edit" | "import" | null>(null);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [qualityScore, setQualityScore] = useState<any>(null);
  const [qualityScoring, setQualityScoring] = useState(false);
  const [qualityScoreError, setQualityScoreError] = useState<string | null>(null);

  useEffect(() => {
    if (document) {
      setEditName(document.name);
      setEditDescription(document.description || "");
      setEditContent(document.content || "");
    }
  }, [document]);

  useEffect(() => {
    setTier1Unlocked(false);
    setEditing(false);
    setPendingAction(null);
    setShowUnlockDialog(false);
    setQualityScore(null);
    setQualityScoring(false);
    setQualityScoreError(null);
  }, [id]);

  const isTier1 = document?.tier === 1;
  const isTier2 = document?.tier === 2;
  const canEdit = !isTier1 || tier1Unlocked;

  const handleMarkClean = () => {
    if (!document) return;
    updateMutation.mutate(
      { id: document.id, data: { review_state: "CLEAN" } },
      { onSuccess: () => refetch() }
    );
  };

  const requestEdit = () => {
    if (isTier1 && !tier1Unlocked) {
      setPendingAction("edit");
      setShowUnlockDialog(true);
    } else {
      setEditing(true);
    }
  };

  const handleUnlockConfirm = () => {
    setTier1Unlocked(true);
    setShowUnlockDialog(false);
    if (pendingAction === "edit") {
      setEditing(true);
    } else if (pendingAction === "import") {
      doImportFromGdocs();
    }
    setPendingAction(null);
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
          ...(isTier1 ? { edit_override: true } : {}),
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

  const handleExportPdf = async () => {
    if (!document) return;
    setExportingPdf(true);
    try {
      const baseUrl = import.meta.env.VITE_API_URL || `${window.location.origin}/api`;
      const resp = await fetch(`${baseUrl}/documents/${document.id}/export-pdf`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      if (!resp.ok) throw new Error("Export failed");
      const html = await resp.text();
      const printWindow = window.open("", "_blank");
      if (printWindow) {
        printWindow.document.write(html);
        printWindow.document.close();
        setTimeout(() => printWindow.print(), 500);
      }
    } catch (err) {
      console.error("PDF export failed:", err);
    } finally {
      setExportingPdf(false);
    }
  };

  const [gdocLink, setGdocLink] = useState<string | null>(null);

  const handleExportToGdocs = () => {
    if (!document) return;
    exportMutation.mutate(
      { id: document.id },
      {
        onSuccess: (data) => {
          refetch();
          refetchGdocs();
          if (data.gdoc_url) {
            setGdocLink(data.gdoc_url);
          }
        },
      }
    );
  };

  const requestImportFromGdocs = () => {
    if (isTier1 && !tier1Unlocked) {
      setPendingAction("import");
      setShowUnlockDialog(true);
    } else {
      doImportFromGdocs();
    }
  };

  const doImportFromGdocs = () => {
    if (!document) return;
    importMutation.mutate(
      { id: document.id, data: { ...(isTier1 ? { edit_override: true } : {}) } },
      {
        onSuccess: () => {
          refetch();
        },
      }
    );
  };

  const [expandedDimensions, setExpandedDimensions] = useState<Record<string, boolean>>({});

  const handleQualityScore = async () => {
    setQualityScoring(true);
    setQualityScoreError(null);
    try {
      const baseUrl = import.meta.env.VITE_API_URL || `${window.location.origin}/api`;
      const resp = await fetch(`${baseUrl}/documents/${id}/quality-score`, {
        method: "POST",
      });
      if (!resp.ok) throw new Error("Failed");
      const data = await resp.json();
      setQualityScore(data);
      setExpandedDimensions({});
    } catch {
      setQualityScoreError("Could not score document. Please try again.");
    } finally {
      setQualityScoring(false);
    }
  };

  const toggleDimension = (key: string) => {
    setExpandedDimensions(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const verdictBadge = (verdict: string) => {
    switch (verdict) {
      case "PASS": return <Badge variant="outline" className="border-green-200 text-green-700 bg-green-50 text-xs">{verdict}</Badge>;
      case "ADVISORY": return <Badge variant="outline" className="border-amber-200 text-amber-700 bg-amber-50 text-xs">{verdict}</Badge>;
      case "FAIL": return <Badge variant="destructive" className="text-xs">{verdict}</Badge>;
      default: return <Badge variant="secondary" className="text-xs">{verdict}</Badge>;
    }
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

  const isLinkedToGdocs = gdocsStatus?.linked || !!document.gdoc_url;

  const tierLabel = isTier1 ? "Tier 1 — Core" : isTier2 ? "Tier 2 — Derived" : "Tier 3 — Output";
  const tierColor = isTier1 ? "bg-red-500" : isTier2 ? "bg-amber-500" : "bg-blue-500";

  return (
    <div className="space-y-6 max-w-6xl mx-auto pb-12">
      {showUnlockDialog && (
        <UnlockConfirmDialog
          docName={document.name}
          onConfirm={handleUnlockConfirm}
          onCancel={() => { setShowUnlockDialog(false); setPendingAction(null); }}
        />
      )}

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
              <div className="flex items-center gap-1.5 ml-2">
                <div className={`w-2 h-2 rounded-full ${tierColor}`} />
                <span className="text-xs text-muted-foreground font-medium">{tierLabel}</span>
                {isTier1 && !tier1Unlocked && <Lock className="w-3 h-3 text-red-500" />}
                {isTier1 && tier1Unlocked && <Unlock className="w-3 h-3 text-green-600" />}
              </div>
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
        <div className="flex gap-2 flex-wrap justify-end">
          <Button variant="outline" size="sm" onClick={handleDownload}>
            <Download className="w-4 h-4 mr-1.5" />
            Download
          </Button>
          {document.lifecycle_status === "CURRENT" && document.review_state === "CLEAN" && document.content && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleExportPdf}
              disabled={exportingPdf}
              className="border-emerald-200 text-emerald-700 hover:bg-emerald-50"
            >
              <FileText className="w-4 h-4 mr-1.5" />
              {exportingPdf ? "Generating..." : "Export PDF"}
            </Button>
          )}
          {isLinkedToGdocs ? (
            <>
              <a
                href={gdocsStatus?.gdoc_url || document?.gdoc_url || "#"}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-md border border-blue-200 text-blue-700 bg-white hover:bg-blue-50 transition-colors"
              >
                <ExternalLink className="w-4 h-4" />
                Open in Google Docs
              </a>
              <Button
                variant="outline"
                size="sm"
                onClick={requestImportFromGdocs}
                disabled={importMutation.isPending}
                className="border-green-200 text-green-700 hover:bg-green-50"
              >
                <RefreshCw className={`w-4 h-4 mr-1.5 ${importMutation.isPending ? "animate-spin" : ""}`} />
                {importMutation.isPending ? "Pulling..." : "Pull from Docs"}
              </Button>
            </>
          ) : (
            <Button variant="outline" size="sm" onClick={handleExportToGdocs} disabled={exportMutation.isPending} className="border-blue-200 text-blue-700 hover:bg-blue-50">
              <FileUp className={`w-4 h-4 mr-1.5 ${exportMutation.isPending ? "animate-spin" : ""}`} />
              {exportMutation.isPending ? "Creating..." : "Send to Google Docs"}
            </Button>
          )}
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
            <Button variant="outline" size="sm" onClick={requestEdit}>
              {isTier1 && !tier1Unlocked ? <Lock className="w-4 h-4 mr-1.5" /> : <Pencil className="w-4 h-4 mr-1.5" />}
              {isTier1 && !tier1Unlocked ? "Edit (Locked)" : "Edit"}
            </Button>
          )}
        </div>
      </div>

      <TierLockBanner tier={document.tier} onUnlock={() => setShowUnlockDialog(true)} isUnlocked={tier1Unlocked} />
      {isTier2 && editing && <Tier2Warning />}

      {gdocLink && (
        <div className="bg-blue-50 border border-blue-200 text-blue-800 p-4 rounded-lg flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm">
            <ExternalLink className="w-4 h-4" />
            <span>Google Doc created successfully.</span>
          </div>
          <div className="flex items-center gap-3">
            <a
              href={gdocLink}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-md bg-blue-600 text-white hover:bg-blue-700 transition-colors"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              Open Google Doc
            </a>
            <button onClick={() => setGdocLink(null)} className="text-blue-400 hover:text-blue-600">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {importMutation.isSuccess && (
        <div className="bg-green-50 border border-green-200 text-green-800 p-3 rounded-lg text-sm flex items-center gap-2">
          <RefreshCw className="w-4 h-4" />
          Content updated from Google Docs successfully.
        </div>
      )}

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
              <div className="flex items-center gap-3">
                <CardTitle>{editing ? "Edit Content" : "Content Preview"}</CardTitle>
                {isLinkedToGdocs && (
                  <Badge variant="outline" className="border-blue-200 text-blue-600 bg-blue-50 text-xs gap-1">
                    <svg className="w-3 h-3" viewBox="0 0 24 24" fill="currentColor"><path d="M14.727 6.727H14V0H4.91c-.905 0-1.637.732-1.637 1.636v20.728c0 .904.732 1.636 1.636 1.636h14.182c.904 0 1.636-.732 1.636-1.636V6.727h-6.727zM16.364 21.273H7.636v-1.636h8.727v1.636zm0-3.273H7.636v-1.636h8.727V18zm0-3.273H7.636v-1.636h8.727v-1.636zm-1.636-4.909V1.227l6.136 6.136h-4.909z"/></svg>
                    Linked to Google Docs
                  </Badge>
                )}
              </div>
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
                <div className="text-center py-12 text-muted-foreground border border-dashed rounded space-y-2">
                  <FileText className="w-8 h-8 mx-auto opacity-30" />
                  <p>No content available.</p>
                  <p className="text-xs">
                    {canEdit ? (
                      <>Click Edit to add content, or use "Send to Google Docs" to create and edit in Google Docs.</>
                    ) : (
                      <>Unlock this document to add or edit content.</>
                    )}
                  </p>
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
          {isLinkedToGdocs && (
            <Card className="border-blue-200 bg-blue-50/50">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2 text-blue-800">
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor"><path d="M14.727 6.727H14V0H4.91c-.905 0-1.637.732-1.637 1.636v20.728c0 .904.732 1.636 1.636 1.636h14.182c.904 0 1.636-.732 1.636-1.636V6.727h-6.727zM16.364 21.273H7.636v-1.636h8.727v1.636zm0-3.273H7.636v-1.636h8.727V18zm0-3.273H7.636v-1.636h8.727v-1.636zm-1.636-4.909V1.227l6.136 6.136h-4.909z"/></svg>
                  Google Docs
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <a
                  href={gdocsStatus?.gdoc_url || document?.gdoc_url || "#"}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center justify-center gap-1.5 w-full px-3 py-1.5 text-sm font-medium rounded-md border border-blue-200 text-blue-700 bg-white hover:bg-blue-100 transition-colors"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  Open in Google Docs
                </a>
                <Button size="sm" variant="outline" className="w-full border-green-200 text-green-700 hover:bg-green-100" onClick={requestImportFromGdocs} disabled={importMutation.isPending}>
                  <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${importMutation.isPending ? "animate-spin" : ""}`} />
                  {importMutation.isPending ? "Pulling..." : "Pull changes back"}
                </Button>
                {gdocsStatus?.gdoc_modified && (
                  <p className="text-xs text-muted-foreground">
                    Last modified: {new Date(gdocsStatus.gdoc_modified).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                  </p>
                )}
              </CardContent>
            </Card>
          )}

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
                  <div className="font-medium text-sm flex items-center gap-1.5">
                    <div className={`w-2 h-2 rounded-full ${tierColor}`} />
                    Tier {document.tier}
                  </div>
                </div>
              </div>
              <div>
                <div className="text-sm text-muted-foreground">Edit Permissions</div>
                <div className="font-medium text-sm mt-1">
                  {isTier1 ? (
                    <span className="text-red-600 flex items-center gap-1">
                      <Lock className="w-3 h-3" /> Requires unlock
                    </span>
                  ) : isTier2 ? (
                    <span className="text-amber-600 flex items-center gap-1">
                      <AlertTriangle className="w-3 h-3" /> Editable (with warning)
                    </span>
                  ) : (
                    <span className="text-green-600 flex items-center gap-1">
                      <Pencil className="w-3 h-3" /> Freely editable
                    </span>
                  )}
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

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <Award className="w-4 h-4 text-primary" /> Quality Score
              </CardTitle>
            </CardHeader>
            <CardContent>
              {qualityScore ? (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="text-2xl font-bold">{qualityScore.overall_score}/10</div>
                    {verdictBadge(qualityScore.overall_verdict)}
                  </div>

                  <div className="space-y-2">
                    {([
                      ["structural_completeness", "Structure"],
                      ["compliance_constant_accuracy", "Compliance"],
                      ["strategic_alignment", "Strategy"],
                      ["persona_fit", "Persona Fit"],
                      ["prohibited_content_absence", "Prohibited Content"],
                      ["tone_compliance", "Tone"],
                    ] as const).map(([key, label]) => {
                      const dim = qualityScore.dimensions[key];
                      if (!dim) return null;
                      const isExpanded = expandedDimensions[key] || false;
                      return (
                        <div key={key} className="border rounded p-2">
                          <button
                            className="w-full flex items-center justify-between text-sm"
                            onClick={() => toggleDimension(key)}
                          >
                            <div className="flex items-center gap-2">
                              {isExpanded ? <ChevronDown className="w-3 h-3 text-muted-foreground" /> : <ChevronRight className="w-3 h-3 text-muted-foreground" />}
                              <span className="font-medium">{label}</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="text-xs text-muted-foreground">{dim.score}/10</span>
                              {verdictBadge(dim.verdict)}
                            </div>
                          </button>
                          {isExpanded && dim.findings && (
                            <ul className="mt-2 ml-5 space-y-1">
                              {dim.findings.map((f: string, i: number) => (
                                <li key={i} className="text-xs text-muted-foreground list-disc">{f}</li>
                              ))}
                            </ul>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {qualityScore.content_truncated && (
                    <p className="text-xs text-muted-foreground italic">Note: document was truncated to 6,000 characters for scoring.</p>
                  )}

                  <Button variant="outline" size="sm" className="w-full" onClick={handleQualityScore} disabled={qualityScoring}>
                    {qualityScoring ? <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />Re-scoring...</> : "Re-score"}
                  </Button>
                  {qualityScoreError && (
                    <p className="text-sm text-destructive">{qualityScoreError}</p>
                  )}
                </div>
              ) : (
                <div className="space-y-3">
                  <p className="text-sm text-muted-foreground">Score this document against the Unlock quality rubric.</p>
                  <Button variant="outline" size="sm" className="w-full" onClick={handleQualityScore} disabled={qualityScoring}>
                    {qualityScoring ? <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />Scoring...</> : "Score Document"}
                  </Button>
                  {qualityScoreError && (
                    <p className="text-sm text-destructive">{qualityScoreError}</p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
