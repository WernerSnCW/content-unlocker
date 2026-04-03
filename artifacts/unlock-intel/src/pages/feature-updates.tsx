import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { useSubmitFeatureUpdate, useGetFeatureUpdateQueue } from "@workspace/api-client-react";
import {
  Loader2,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  RefreshCw,
  Send,
  Shield,
  Layers,
  ExternalLink,
} from "lucide-react";
import { Link } from "wouter";

function PriorityBadge({ priority }: { priority: string }) {
  const styles: Record<string, string> = {
    CRITICAL: "bg-red-600 text-white",
    HIGH: "bg-orange-600 text-white",
    MEDIUM: "bg-amber-600 text-white",
    LOW: "bg-slate-600 text-white",
  };
  return <Badge className={styles[priority] || "bg-slate-600 text-white"}>{priority}</Badge>;
}

function DetectionMethodTag({ method }: { method: string }) {
  const labels: Record<string, string> = {
    tier1_propagation: "Tier 1 Cascade",
    semantic_match: "Semantic Match",
    type_match: "Type Match",
    compliance_match: "Compliance Match",
  };
  return <Badge variant="outline" className="text-xs">{labels[method] || method}</Badge>;
}

export default function FeatureUpdates() {
  const submitMutation = useSubmitFeatureUpdate();

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [featuresText, setFeaturesText] = useState("");
  const [changeType, setChangeType] = useState<"addition" | "modification" | "removal">("modification");
  const [affectsCompliance, setAffectsCompliance] = useState(false);
  const [affectsTier1, setAffectsTier1] = useState(false);

  const [result, setResult] = useState<any>(null);
  const [activeUpdateId, setActiveUpdateId] = useState<string | null>(null);

  const queueQuery = useGetFeatureUpdateQueue(
    activeUpdateId || "",
    { query: { enabled: !!activeUpdateId, refetchInterval: 5000 } }
  );

  const handleSubmit = () => {
    submitMutation.mutate(
      {
        data: {
          title,
          description,
          affected_features: featuresText.split(",").map((s) => s.trim()).filter(Boolean),
          change_type: changeType,
          affects_compliance: affectsCompliance,
          affects_tier1: affectsTier1,
        },
      },
      {
        onSuccess: (res: any) => {
          setResult(res);
          setActiveUpdateId(res.update_id);
        },
      }
    );
  };

  const handleReset = () => {
    setTitle("");
    setDescription("");
    setFeaturesText("");
    setChangeType("modification");
    setAffectsCompliance(false);
    setAffectsTier1(false);
    setResult(null);
    setActiveUpdateId(null);
  };

  if (result) {
    const queue = queueQuery.data;
    const completedCount = queue?.completed ?? 0;
    const totalCount = queue?.total ?? result.summary.total_affected;
    const allCleared = queue ? queue.pending === 0 : false;

    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Feature Update Results</h1>
            <p className="text-muted-foreground mt-1">{result.update_id}</p>
          </div>
          <Button variant="outline" onClick={handleReset}>
            <RefreshCw className="w-4 h-4 mr-2" /> New Update
          </Button>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">{title}</CardTitle>
            <CardDescription>{description}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex gap-4 text-sm">
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground">Change type:</span>
                <Badge variant="outline">{changeType}</Badge>
              </div>
              {affectsCompliance && (
                <div className="flex items-center gap-2">
                  <Shield className="w-4 h-4 text-red-500" />
                  <span className="text-sm text-red-400">Affects compliance</span>
                </div>
              )}
              {affectsTier1 && (
                <div className="flex items-center gap-2">
                  <Layers className="w-4 h-4 text-orange-500" />
                  <span className="text-sm text-orange-400">Affects Tier 1</span>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        <div className="grid grid-cols-4 gap-4">
          <Card className="text-center">
            <CardContent className="pt-6">
              <p className="text-3xl font-bold">{result.summary.total_affected}</p>
              <p className="text-sm text-muted-foreground">Total Affected</p>
            </CardContent>
          </Card>
          <Card className="text-center border-red-500/30">
            <CardContent className="pt-6">
              <p className="text-3xl font-bold text-red-500">{result.summary.critical_count}</p>
              <p className="text-sm text-muted-foreground">Critical</p>
            </CardContent>
          </Card>
          <Card className="text-center border-orange-500/30">
            <CardContent className="pt-6">
              <p className="text-3xl font-bold text-orange-500">{result.summary.high_count}</p>
              <p className="text-sm text-muted-foreground">High</p>
            </CardContent>
          </Card>
          <Card className="text-center border-emerald-500/30">
            <CardContent className="pt-6">
              <p className="text-3xl font-bold text-emerald-500">{completedCount}</p>
              <p className="text-sm text-muted-foreground">Reviewed</p>
            </CardContent>
          </Card>
        </div>

        {!allCleared && (
          <div className="w-full bg-muted rounded-full h-2">
            <div
              className="bg-primary rounded-full h-2 transition-all"
              style={{ width: `${totalCount > 0 ? (completedCount / totalCount) * 100 : 0}%` }}
            />
          </div>
        )}

        {allCleared && totalCount > 0 && (
          <Card className="border-emerald-500 bg-emerald-500/5">
            <CardContent className="pt-6 flex items-center gap-3">
              <CheckCircle2 className="w-6 h-6 text-emerald-500" />
              <div>
                <p className="font-medium text-emerald-400">All documents reviewed</p>
                <p className="text-sm text-muted-foreground">{totalCount} documents have been updated and cleared from the review queue.</p>
              </div>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Review Queue</CardTitle>
            <CardDescription>
              Documents listed in recommended review order — {completedCount} of {totalCount} reviewed
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {result.affected_documents.map((doc: any, i: number) => {
                const isCompleted = queue?.completed_documents?.some(
                  (cd: any) => cd.id === doc.document_id
                );
                return (
                  <div
                    key={i}
                    className={`flex items-center justify-between p-3 rounded-lg ${
                      isCompleted ? "bg-emerald-500/10 opacity-60" : "bg-muted/50"
                    }`}
                  >
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      <span className="text-xs text-muted-foreground w-6 text-center">{i + 1}</span>
                      <PriorityBadge priority={doc.review_priority} />
                      <Badge variant="outline" className="text-xs">T{doc.tier}</Badge>
                      <span className="text-sm font-medium truncate">{doc.title}</span>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0 ml-4">
                      {(doc.detection_methods || [doc.detection_method]).map((m: string, j: number) => (
                        <DetectionMethodTag key={j} method={m} />
                      ))}
                      {isCompleted ? (
                        <Badge className="bg-emerald-600 text-white">
                          <CheckCircle2 className="w-3 h-3 mr-1" /> Done
                        </Badge>
                      ) : (
                        <Link href={`/registry/${doc.document_id}`}>
                          <Button size="sm" variant="outline">
                            Review <ExternalLink className="w-3 h-3 ml-1" />
                          </Button>
                        </Link>
                      )}
                    </div>
                  </div>
                );
              })}
              {result.affected_documents.length > 0 && (
                <div className="pt-3">
                  <p className="text-xs text-muted-foreground">
                    Relevance reasons are logged in the changelog for each document.
                  </p>
                </div>
              )}
            </div>

            {result.affected_documents.length === 0 && (
              <div className="flex items-center gap-2 text-emerald-500 py-4">
                <CheckCircle2 className="w-5 h-5" />
                <span>No documents affected by this feature update.</span>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Feature Update Cascade</h1>
        <p className="text-muted-foreground mt-1">
          Describe a product change and identify all documents that need to be reviewed
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Submit Feature Update</CardTitle>
          <CardDescription>
            Provide detail about the change — the more specific the description, the better the semantic matching
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <label className="text-sm font-medium text-muted-foreground">Title</label>
            <Input
              placeholder="e.g. VCT Relief Rate Change"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>

          <div>
            <label className="text-sm font-medium text-muted-foreground">Description</label>
            <Textarea
              placeholder="Full description of what changed in the product..."
              rows={5}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          <div>
            <label className="text-sm font-medium text-muted-foreground">Affected Features (comma-separated)</label>
            <Input
              placeholder="e.g. EIS relief rate, VCT tax credit, SEIS calculation"
              value={featuresText}
              onChange={(e) => setFeaturesText(e.target.value)}
            />
          </div>

          <div>
            <label className="text-sm font-medium text-muted-foreground">Change Type</label>
            <div className="flex gap-2 mt-1">
              {(["addition", "modification", "removal"] as const).map((ct) => (
                <Button
                  key={ct}
                  variant={changeType === ct ? "default" : "outline"}
                  size="sm"
                  onClick={() => setChangeType(ct)}
                >
                  {ct.charAt(0).toUpperCase() + ct.slice(1)}
                </Button>
              ))}
            </div>
          </div>

          <div className="flex gap-6 pt-2">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={affectsCompliance}
                onChange={(e) => setAffectsCompliance(e.target.checked)}
                className="rounded"
              />
              <Shield className="w-4 h-4 text-red-500" />
              <span className="text-sm">Affects compliance figures</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={affectsTier1}
                onChange={(e) => setAffectsTier1(e.target.checked)}
                className="rounded"
              />
              <Layers className="w-4 h-4 text-orange-500" />
              <span className="text-sm">Affects Tier 1 documents</span>
            </label>
          </div>

          <div className="flex justify-end pt-4">
            <Button
              onClick={handleSubmit}
              disabled={!title || !description || submitMutation.isPending}
              size="lg"
            >
              {submitMutation.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Scanning registry...
                </>
              ) : (
                <>
                  <Send className="w-4 h-4 mr-2" />
                  Submit Feature Update
                </>
              )}
            </Button>
          </div>

          {submitMutation.isError && (
            <div className="flex items-center gap-2 text-destructive pt-2">
              <XCircle className="w-5 h-5" />
              <span>Failed: {(submitMutation.error as any)?.message || "Unknown error"}</span>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
