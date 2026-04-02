import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useGenerateDocument } from "@workspace/api-client-react";
import { Loader2, Wand2, CheckCircle2, XCircle, AlertCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";

export default function Generate() {
  const [docType, setDocType] = useState("");
  const [docName, setDocName] = useState("");
  const [requirements, setRequirements] = useState("");
  const [personas, setPersonas] = useState("Growth Seeker, Value Investor");
  
  const generateMutation = useGenerateDocument();

  const handleGenerate = () => {
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
        {generateMutation.isPending && (
          <Card className="h-full min-h-[400px] flex flex-col items-center justify-center p-8 text-center bg-muted/20 border-dashed">
            <Loader2 className="w-10 h-10 animate-spin text-primary mb-4" />
            <h3 className="text-lg font-medium">Generating & Checking...</h3>
            <p className="text-sm text-muted-foreground mt-2 max-w-sm">
              Applying institutional voice, referencing content bank, and running compliance assertions.
            </p>
          </Card>
        )}

        {!generateMutation.isPending && !generateMutation.data && (
          <Card className="h-full min-h-[400px] flex flex-col items-center justify-center p-8 text-center bg-muted/10 border-dashed">
            <Wand2 className="w-12 h-12 text-muted-foreground/30 mb-4" />
            <p className="text-muted-foreground">Fill out the brief to generate new content.</p>
          </Card>
        )}

        {generateMutation.data && (
          <div className="space-y-6">
            <Card className={generateMutation.data.qc_report.overall === "fail" ? "border-destructive/50" : "border-green-500/50"}>
              <CardHeader className="pb-3 border-b bg-muted/20">
                <div className="flex justify-between items-start">
                  <div>
                    <CardTitle className="flex items-center gap-2">
                      QC Report 
                      <Badge variant={generateMutation.data.qc_report.overall === "pass" ? "default" : "destructive"} 
                             className={generateMutation.data.qc_report.overall === "pass" ? "bg-green-600" : ""}>
                        {generateMutation.data.qc_report.overall.toUpperCase()}
                      </Badge>
                    </CardTitle>
                    <CardDescription className="mt-1">
                      Attempt #{generateMutation.data.qc_report.qc_attempt}
                    </CardDescription>
                  </div>
                  {generateMutation.data.qc_report.overall === "fail" && (
                    <Button variant="outline" size="sm" className="gap-1">
                      <Loader2 className="w-3 h-3" /> Regenerate
                    </Button>
                  )}
                </div>
              </CardHeader>
              <CardContent className="pt-4 space-y-4">
                {generateMutation.data.qc_report.checks.map(check => (
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
                <CardTitle>Generated Content</CardTitle>
                <CardDescription>File Code: {generateMutation.data.document.file_code}</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="prose prose-sm max-w-none dark:prose-invert">
                  <div dangerouslySetInnerHTML={{ __html: generateMutation.data.generated_content.replace(/\n/g, '<br/>') }} />
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}
