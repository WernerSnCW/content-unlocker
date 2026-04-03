import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useGenerateDocument, useRegenerateDocument, usePromoteDocument } from "@workspace/api-client-react";
import { Loader2, Wand2, CheckCircle2, XCircle, AlertCircle, RefreshCw, ArrowUpCircle, ShieldAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";

export default function Generate() {
  const [docType, setDocType] = useState("");
  const [docName, setDocName] = useState("");
  const [requirements, setRequirements] = useState("");
  const [personas, setPersonas] = useState("Growth Seeker, Value Investor");
  
  const generateMutation = useGenerateDocument();
  const regenerateMutation = useRegenerateDocument();
  const promoteMutation = usePromoteDocument();

  const [regenResult, setRegenResult] = useState<any>(null);
  const [regenError, setRegenError] = useState<string | null>(null);
  const [promoteSuccess, setPromoteSuccess] = useState(false);
  const [promoteError, setPromoteError] = useState<string | null>(null);

  const result = regenResult || generateMutation.data;

  const handleGenerate = () => {
    setRegenResult(null);
    setPromoteSuccess(false);
    setPromoteError(null);
    generateMutation.mutate({
      data: {
        document_type: docType || "Brief",
        document_name: docName || "Draft Document",
        requirements,
        target_personas: personas.split(",").map(s => s.trim()),
        pipeline_stage_relevance: ["Outreach", "Decision"]
      }
    });
  };

  const handleRegenerate = () => {
    if (!result?.document?.id) return;
    setRegenError(null);
    regenerateMutation.mutate(
      { id: result.document.id },
      {
        onSuccess: (data) => {
          setRegenResult(data);
        },
        onError: (err: any) => {
          setRegenError(err?.message || "Regeneration failed. Please try again.");
        },
      }
    );
  };

  const handlePromote = () => {
    if (!result?.document?.id) return;
    setPromoteError(null);
    promoteMutation.mutate(
      { id: result.document.id },
      {
        onSuccess: () => {
          setPromoteSuccess(true);
        },
        onError: (err: any) => {
          setPromoteError(err?.message || "Promotion failed. The document may require review first.");
        },
      }
    );
  };

  const isManualReview = result?.document?.review_state === "REQUIRES_REVIEW" ||
    (result?.qc_report?.warnings && result.qc_report.warnings.some((w: string) => w.includes("Maximum regeneration")));

  const qcPassed = result?.qc_report?.overall === "pass";
  const qcFailed = result?.qc_report?.overall === "fail" && !isManualReview;
  const canPromote = qcPassed && !promoteSuccess && result?.document?.lifecycle_status === "DRAFT";

  return (
    <div className="space-y-6 max-w-6xl mx-auto pb-12 flex flex-col lg:flex-row gap-6">
      
      <div className="w-full lg:w-1/3 space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Content Generation</h1>
          <p className="text-muted-foreground mt-1">Generate new collateral with built-in QC checking.</p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Generation Brief</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Document Name</label>
              <Input 
                placeholder="e.g. Q3 Growth Fund Summary" 
                value={docName}
                onChange={e => setDocName(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Document Type</label>
              <Input 
                placeholder="e.g. One Pager, Email Sequence" 
                value={docType}
                onChange={e => setDocType(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Target Personas (comma separated)</label>
              <Input 
                value={personas}
                onChange={e => setPersonas(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Specific Requirements</label>
              <Textarea 
                placeholder="Include details about..." 
                className="min-h-[100px]"
                value={requirements}
                onChange={e => setRequirements(e.target.value)}
              />
            </div>
            <Button 
              className="w-full gap-2" 
              onClick={handleGenerate}
              disabled={generateMutation.isPending || !requirements}
            >
              {generateMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" />}
              Generate & Verify
            </Button>
          </CardContent>
        </Card>
      </div>

      <div className="flex-1">
        {(generateMutation.isPending || regenerateMutation.isPending) && (
          <Card className="h-full min-h-[400px] flex flex-col items-center justify-center p-8 text-center bg-muted/20 border-dashed">
            <Loader2 className="w-10 h-10 animate-spin text-primary mb-4" />
            <h3 className="text-lg font-medium">
              {regenerateMutation.isPending ? "Regenerating & Re-checking..." : "Generating & Checking..."}
            </h3>
            <p className="text-sm text-muted-foreground mt-2 max-w-sm">
              Applying institutional voice, referencing content bank, and running compliance assertions.
            </p>
          </Card>
        )}

        {!generateMutation.isPending && !regenerateMutation.isPending && !result && (
          <Card className="h-full min-h-[400px] flex flex-col items-center justify-center p-8 text-center bg-muted/10 border-dashed">
            <Wand2 className="w-12 h-12 text-muted-foreground/30 mb-4" />
            <p className="text-muted-foreground">Fill out the brief to generate new content.</p>
          </Card>
        )}

        {!generateMutation.isPending && !regenerateMutation.isPending && result && (
          <div className="space-y-6">
            {isManualReview && (
              <div className="bg-red-50 border border-red-200 text-red-800 p-4 rounded-lg flex items-start gap-3">
                <ShieldAlert className="w-5 h-5 text-red-600 mt-0.5 flex-shrink-0" />
                <div>
                  <h3 className="font-semibold text-red-900">Manual Review Required</h3>
                  <p className="text-sm mt-1">Maximum regeneration attempts reached. This document needs manual editing before it can be promoted.</p>
                </div>
              </div>
            )}

            {promoteSuccess && (
              <div className="bg-green-50 border border-green-200 text-green-800 p-4 rounded-lg flex items-center gap-3">
                <CheckCircle2 className="w-5 h-5 text-green-600 flex-shrink-0" />
                <div>
                  <h3 className="font-semibold text-green-900">Document Promoted to CURRENT</h3>
                  <p className="text-sm mt-1">The document is now live in the registry.</p>
                </div>
              </div>
            )}

            {promoteError && (
              <div className="bg-red-50 border border-red-200 text-red-800 p-3 rounded-lg text-sm flex items-center gap-2">
                <XCircle className="w-4 h-4" />
                {promoteError}
              </div>
            )}

            <Card className={
              isManualReview ? "border-red-300" :
              qcPassed ? "border-green-500/50" :
              "border-destructive/50"
            }>
              <CardHeader className="pb-3 border-b bg-muted/20">
                <div className="flex justify-between items-start">
                  <div>
                    <CardTitle className="flex items-center gap-2">
                      QC Report 
                      <Badge
                        variant={qcPassed ? "default" : "destructive"}
                        className={qcPassed ? "bg-green-600" : ""}
                      >
                        {isManualReview ? "MANUAL REVIEW" : result.qc_report.overall.toUpperCase()}
                      </Badge>
                    </CardTitle>
                    <CardDescription className="mt-1">
                      Attempt #{result.qc_report.qc_attempt}
                    </CardDescription>
                  </div>
                  <div className="flex gap-2">
                    {qcFailed && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="gap-1.5"
                        onClick={handleRegenerate}
                        disabled={regenerateMutation.isPending}
                      >
                        <RefreshCw className={`w-3.5 h-3.5 ${regenerateMutation.isPending ? "animate-spin" : ""}`} />
                        Regenerate
                      </Button>
                    )}
                    {canPromote && (
                      <Button
                        size="sm"
                        className="gap-1.5 bg-green-600 hover:bg-green-700"
                        onClick={handlePromote}
                        disabled={promoteMutation.isPending}
                      >
                        {promoteMutation.isPending ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <ArrowUpCircle className="w-3.5 h-3.5" />
                        )}
                        {promoteMutation.isPending ? "Promoting..." : "Promote to CURRENT"}
                      </Button>
                    )}
                  </div>
                </div>
                {regenError && (
                  <div className="mt-2 p-3 bg-destructive/10 text-destructive text-sm rounded-md border border-destructive/20">
                    {regenError}
                  </div>
                )}
              </CardHeader>
              <CardContent className="pt-4 space-y-4">
                {result.qc_report.checks.map((check: any) => (
                  <div key={check.check_id} className="flex items-start gap-3 p-3 border rounded-md bg-background">
                    {check.result === "pass" ? (
                      <CheckCircle2 className="w-5 h-5 text-green-500 flex-shrink-0" />
                    ) : check.result === "warning" ? (
                      <AlertCircle className="w-5 h-5 text-amber-500 flex-shrink-0" />
                    ) : (
                      <XCircle className="w-5 h-5 text-destructive flex-shrink-0" />
                    )}
                    <div className="flex-1 text-sm">
                      <div className="font-medium">{check.label}</div>
                      {check.offending_text && (
                        <div className="mt-2 text-destructive bg-destructive/10 p-2 rounded text-xs font-mono">
                          Found: "{check.offending_text}"
                        </div>
                      )}
                      {check.correct_version && (
                        <div className="mt-1 text-green-700 bg-green-50 p-2 rounded text-xs font-mono">
                          Expected: "{check.correct_version}"
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <div className="flex justify-between items-center">
                  <div>
                    <CardTitle>Generated Content</CardTitle>
                    <CardDescription>File Code: {result.document.file_code}</CardDescription>
                  </div>
                  <Badge variant="outline">
                    {promoteSuccess ? "CURRENT" : result.document.lifecycle_status}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent>
                <div className="prose prose-sm max-w-none dark:prose-invert">
                  <div dangerouslySetInnerHTML={{ __html: result.generated_content.replace(/\n/g, '<br/>') }} />
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}
