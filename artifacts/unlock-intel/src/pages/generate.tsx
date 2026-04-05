import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useGenerateDocument, useRegenerateDocument, usePromoteDocument, useListTemplates, useGetTemplate, useGenerateFromTemplate } from "@workspace/api-client-react";
import { Loader2, Wand2, CheckCircle2, XCircle, AlertCircle, RefreshCw, ArrowUpCircle, ShieldAlert, FileText, Lock, Ban, ChevronDown } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useQuery } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";

const API_BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";

async function fetchACUs() {
  const base = API_BASE.endsWith("/") ? API_BASE : `${API_BASE}/`;
  const res = await fetch(`${base}api/acu`);
  if (!res.ok) throw new Error("Failed to fetch ACUs");
  return res.json();
}

function TemplateTab() {
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [tmplDocName, setTmplDocName] = useState("");
  const [tmplContext, setTmplContext] = useState("");
  const [tmplNameError, setTmplNameError] = useState(false);
  const [tmplResult, setTmplResult] = useState<any>(null);
  const [tmplError, setTmplError] = useState<string | null>(null);

  const { data: templates, isLoading: templatesLoading, error: templatesError } = useListTemplates();

  const { data: templateDetail, isLoading: detailLoading, error: detailError } = useGetTemplate(
    selectedTemplateId || "",
    { query: { enabled: !!selectedTemplateId } }
  );

  const { data: allACUs, isLoading: acusLoading } = useQuery({
    queryKey: ["all-acus-for-generation"],
    queryFn: fetchACUs,
    staleTime: Infinity,
  });

  const generateFromTemplateMutation = useGenerateFromTemplate();

  const groupedTemplates = (() => {
    if (!templates || !Array.isArray(templates)) return {};
    const groups: Record<string, any[]> = {};
    for (const t of templates) {
      const group = t.output_type || "other";
      if (!groups[group]) groups[group] = [];
      groups[group].push(t);
    }
    return groups;
  })();

  const resolveACU = (acuId: string) => {
    if (!allACUs || !Array.isArray(allACUs)) return null;
    return allACUs.find((a: any) => a.id === acuId) || null;
  };

  const handleTemplateGenerate = () => {
    if (!tmplDocName.trim()) {
      setTmplNameError(true);
      return;
    }
    setTmplNameError(false);
    setTmplError(null);
    setTmplResult(null);

    const payload: any = { template_id: selectedTemplateId };
    const contextObj: Record<string, string> = { document_name: tmplDocName.trim() };
    if (tmplContext.trim()) {
      contextObj.brief = tmplContext.trim();
    }
    payload.context = contextObj;

    generateFromTemplateMutation.mutate(
      { data: payload },
      {
        onSuccess: (data) => {
          setTmplResult(data);
        },
        onError: (err: any) => {
          setTmplError(err?.message || "Generation failed. Please try again.");
        },
      }
    );
  };

  const handleTemplateChange = (value: string) => {
    setSelectedTemplateId(value);
    setTmplResult(null);
    setTmplError(null);
    setTmplNameError(false);
  };

  const sections = templateDetail?.sections || (templateDetail as any)?.composed_sections || [];
  const requiredAcus: string[] = (templateDetail?.required_acus as string[]) || [];
  const prohibitedAcus: string[] = (templateDetail?.prohibited_acus as string[]) || [];

  return (
    <div className="space-y-6 max-w-6xl mx-auto pb-12 flex flex-col lg:flex-row gap-6">
      <div className="w-full lg:w-1/3 space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Select Template</CardTitle>
            <CardDescription>Choose from the 22 registered output templates.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {templatesLoading ? (
              <div className="space-y-2">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-4 w-3/4" />
              </div>
            ) : templatesError ? (
              <div className="text-sm text-destructive p-3 bg-destructive/10 rounded-md">
                Could not load templates. Please try again.
              </div>
            ) : !templates || (Array.isArray(templates) && templates.length === 0) ? (
              <div className="text-sm text-muted-foreground p-3 border border-dashed rounded-md text-center">
                No templates available.
              </div>
            ) : (
              <Select
                value={selectedTemplateId || ""}
                onValueChange={handleTemplateChange}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Choose a template..." />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(groupedTemplates).map(([group, items]) => (
                    <div key={group}>
                      <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                        {group}
                      </div>
                      {items.map((t: any) => (
                        <SelectItem key={t.id} value={t.id}>
                          <div className="flex items-center gap-2">
                            <span>{t.name}</span>
                            {t.channel && (
                              <span className="text-xs text-muted-foreground">({t.channel})</span>
                            )}
                          </div>
                        </SelectItem>
                      ))}
                    </div>
                  ))}
                </SelectContent>
              </Select>
            )}

            {selectedTemplateId && (
              <div className="border rounded-lg p-4 space-y-4 bg-muted/20">
                {detailLoading || acusLoading ? (
                  <div className="space-y-2">
                    <Skeleton className="h-4 w-1/2" />
                    <Skeleton className="h-4 w-3/4" />
                    <Skeleton className="h-4 w-2/3" />
                  </div>
                ) : detailError ? (
                  <div className="text-sm text-destructive">Could not load template details.</div>
                ) : (
                  <>
                    {sections.length > 0 && (
                      <div>
                        <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Sections</h4>
                        <div className="space-y-1">
                          {sections.map((s: any, i: number) => (
                            <div key={i} className="text-sm flex items-center gap-2">
                              <FileText className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                              <span>{s.label || s.name || s.id}</span>
                              {s.required && <Badge variant="outline" className="text-[10px] px-1 py-0">Required</Badge>}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {requiredAcus.length > 0 && (
                      <div>
                        <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1.5">
                          <Lock className="w-3 h-3" /> Required ACUs
                        </h4>
                        <div className="space-y-2">
                          {requiredAcus.map((acuId) => {
                            const acu = resolveACU(acuId);
                            if (!acu) {
                              return (
                                <div key={acuId} className="text-xs text-muted-foreground/60 italic p-2 bg-muted/30 rounded">
                                  <span className="font-mono">{acuId}</span> — Content unavailable
                                </div>
                              );
                            }
                            const preview = acu.content.length > 100
                              ? acu.content.slice(0, 100) + "…"
                              : acu.content;
                            return (
                              <div key={acuId} className="text-xs p-2 bg-green-500/5 border border-green-500/20 rounded">
                                <Badge variant="outline" className="text-[10px] mb-1">{acu.type}</Badge>
                                <p className="text-muted-foreground">{preview}</p>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {prohibitedAcus.length > 0 && (
                      <div>
                        <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1.5">
                          <Ban className="w-3 h-3" /> Prohibited Content
                        </h4>
                        <div className="space-y-2">
                          {prohibitedAcus.map((acuId) => {
                            const acu = resolveACU(acuId);
                            if (!acu) {
                              return (
                                <div key={acuId} className="text-xs text-muted-foreground/60 italic p-2 bg-muted/30 rounded">
                                  <span className="font-mono">{acuId}</span> — Content unavailable
                                </div>
                              );
                            }
                            const preview = acu.content.length > 100
                              ? acu.content.slice(0, 100) + "…"
                              : acu.content;
                            return (
                              <div key={acuId} className="text-xs p-2 bg-red-500/5 border border-red-500/20 rounded">
                                <Badge variant="outline" className="text-[10px] mb-1">{acu.type}</Badge>
                                <p className="text-muted-foreground">{preview}</p>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}

            <div className="space-y-2">
              <label className="text-sm font-medium">Document Name</label>
              <Input
                placeholder="Document name"
                value={tmplDocName}
                onChange={(e) => {
                  setTmplDocName(e.target.value);
                  if (e.target.value.trim()) setTmplNameError(false);
                }}
              />
              {tmplNameError && (
                <p className="text-xs text-destructive">Document name is required.</p>
              )}
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Context / Brief</label>
              <Textarea
                placeholder="Additional context or brief (optional)."
                className="min-h-[80px]"
                value={tmplContext}
                onChange={(e) => setTmplContext(e.target.value)}
              />
            </div>

            <Button
              className="w-full gap-2"
              onClick={handleTemplateGenerate}
              disabled={!selectedTemplateId || generateFromTemplateMutation.isPending}
            >
              {generateFromTemplateMutation.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Wand2 className="w-4 h-4" />
              )}
              Generate from Template
            </Button>

            {tmplError && (
              <div className="text-sm text-destructive p-3 bg-destructive/10 rounded-md flex items-center gap-2">
                <XCircle className="w-4 h-4 flex-shrink-0" />
                {tmplError}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="flex-1">
        {generateFromTemplateMutation.isPending && (
          <Card className="h-full min-h-[400px] flex flex-col items-center justify-center p-8 text-center bg-muted/20 border-dashed">
            <Loader2 className="w-10 h-10 animate-spin text-primary mb-4" />
            <h3 className="text-lg font-medium">Generating from Template...</h3>
            <p className="text-sm text-muted-foreground mt-2 max-w-sm">
              Applying template structure, injecting locked ACUs, and running compliance checks.
            </p>
          </Card>
        )}

        {!generateFromTemplateMutation.isPending && !tmplResult && (
          <Card className="h-full min-h-[400px] flex flex-col items-center justify-center p-8 text-center bg-muted/10 border-dashed">
            <Wand2 className="w-12 h-12 text-muted-foreground/30 mb-4" />
            <p className="text-muted-foreground">Select a template and provide a document name to generate.</p>
          </Card>
        )}

        {!generateFromTemplateMutation.isPending && tmplResult && (
          <div className="space-y-6">
            <Card className={tmplResult.compliance_check?.pass ? "border-green-500/50" : "border-destructive/50"}>
              <CardHeader className="pb-3 border-b bg-muted/20">
                <div className="flex justify-between items-start">
                  <CardTitle className="flex items-center gap-2">
                    Compliance Check
                    <Badge
                      variant={tmplResult.compliance_check?.pass ? "default" : "destructive"}
                      className={tmplResult.compliance_check?.pass ? "bg-green-600" : ""}
                    >
                      {tmplResult.compliance_check?.pass ? "Compliance Check Passed" : "Compliance Check Failed"}
                    </Badge>
                  </CardTitle>
                </div>
              </CardHeader>
              {tmplResult.compliance_check?.issues && tmplResult.compliance_check.issues.length > 0 && (
                <CardContent className="pt-4">
                  <h4 className="text-sm font-semibold mb-2">Issues</h4>
                  <ul className="space-y-1.5">
                    {tmplResult.compliance_check.issues.map((issue: string, i: number) => (
                      <li key={i} className="text-sm flex items-start gap-2">
                        <XCircle className="w-4 h-4 text-destructive flex-shrink-0 mt-0.5" />
                        <span>{issue}</span>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              )}
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Generated Output</CardTitle>
              </CardHeader>
              <CardContent className="space-y-6">
                {tmplResult.output && Object.entries(tmplResult.output).map(([sectionId, content]) => (
                  <div key={sectionId}>
                    <h3 className="text-base font-semibold border-b pb-2 mb-3">{sectionId}</h3>
                    <div className="prose prose-sm max-w-none dark:prose-invert">
                      <div dangerouslySetInnerHTML={{ __html: (content as string).replace(/\n/g, '<br/>') }} />
                    </div>
                  </div>
                ))}

                <div className="text-xs text-muted-foreground pt-4 border-t">
                  Template: {tmplResult.metadata?.template_name || tmplResult.template_id} · {tmplResult.metadata?.sections_count || "—"} sections
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}

export default function Generate() {
  const [activeTab, setActiveTab] = useState("template");

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
    <div className="space-y-6 max-w-6xl mx-auto pb-12">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Content Generation</h1>
        <p className="text-muted-foreground mt-1">Generate new collateral with built-in compliance checking.</p>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="template">From Template</TabsTrigger>
          <TabsTrigger value="custom">Custom</TabsTrigger>
        </TabsList>

        <TabsContent value="template" className="mt-6">
          <TemplateTab key={activeTab === "template" ? "active" : "inactive"} />
        </TabsContent>

        <TabsContent value="custom" className="mt-6">
          <div className="flex flex-col lg:flex-row gap-6">
            <div className="w-full lg:w-1/3 space-y-6">
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
        </TabsContent>
      </Tabs>
    </div>
  );
}
