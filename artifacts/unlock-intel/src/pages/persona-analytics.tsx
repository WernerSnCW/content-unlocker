import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, CheckCircle, XCircle, User, BarChart3, AlertTriangle } from "lucide-react";
import { Link } from "wouter";

const API_BASE = import.meta.env.VITE_API_URL || "/api";

type PersonaAnalyticsData = {
  summary: {
    total_leads: number;
    with_detected_persona: number;
    with_confirmed_persona: number;
    accuracy_percentage: number | null;
    correct_predictions: number;
    incorrect_predictions: number;
    awaiting_confirmation: number;
  };
  persona_distribution: Record<string, { detected: number; confirmed: number }>;
  archetype_distribution: Record<string, { detected: number; confirmed: number }>;
  confidence_distribution: { high: number; medium: number; low: number };
  corrections: Array<{ lead_id: string; lead_name: string; detected: string; confirmed: string; confirmed_archetype: string }>;
  unconfirmed_leads: Array<{ lead_id: string; name: string; detected_persona: string; persona_confidence: number | null; pipeline_stage: string }>;
};

export default function PersonaAnalytics() {
  const [data, setData] = useState<PersonaAnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${API_BASE}/analytics/personas`)
      .then((r) => r.json())
      .then(setData)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>;
  if (error || !data) return <div className="p-8 text-center text-red-400">{error || "Failed to load"}</div>;

  const s = data.summary;
  const totalConfidence = data.confidence_distribution.high + data.confidence_distribution.medium + data.confidence_distribution.low;

  return (
    <div className="space-y-8 max-w-7xl mx-auto">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Persona Accuracy Analytics</h1>
        <p className="text-muted-foreground mt-2">Track AI persona detection accuracy and validate predictions against confirmed outcomes.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Accuracy</CardDescription>
            <CardTitle className={`text-3xl ${s.accuracy_percentage !== null ? (s.accuracy_percentage >= 80 ? "text-green-400" : s.accuracy_percentage >= 60 ? "text-amber-400" : "text-red-400") : ""}`}>
              {s.accuracy_percentage !== null ? `${s.accuracy_percentage}%` : "—"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">{s.with_confirmed_persona} confirmed of {s.with_detected_persona} detected</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Correct</CardDescription>
            <CardTitle className="text-3xl text-green-400">{s.correct_predictions}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">Persona matched</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Incorrect</CardDescription>
            <CardTitle className="text-3xl text-red-400">{s.incorrect_predictions}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">Persona corrected</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Awaiting</CardDescription>
            <CardTitle className="text-3xl text-amber-400">{s.awaiting_confirmation}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">Need confirmation</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Coverage</CardDescription>
            <CardTitle className="text-3xl">{s.total_leads > 0 ? Math.round((s.with_detected_persona / s.total_leads) * 100) : 0}%</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">{s.with_detected_persona} of {s.total_leads} leads</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <Card>
          <CardHeader>
            <CardTitle>Archetype Distribution</CardTitle>
            <CardDescription>Detected vs confirmed archetypes across leads</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {Object.entries(data.archetype_distribution).map(([archetype, counts]) => {
              const maxVal = Math.max(...Object.values(data.archetype_distribution).flatMap((c) => [c.detected, c.confirmed]), 1);
              return (
                <div key={archetype} className="space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium">{archetype}</span>
                    <span className="text-muted-foreground">D: {counts.detected} / C: {counts.confirmed}</span>
                  </div>
                  <div className="flex gap-1 h-5">
                    <div className="bg-primary/60 rounded-sm transition-all" style={{ width: `${(counts.detected / maxVal) * 100}%` }} title={`Detected: ${counts.detected}`} />
                    <div className="bg-green-500/60 rounded-sm transition-all" style={{ width: `${(counts.confirmed / maxVal) * 100}%` }} title={`Confirmed: ${counts.confirmed}`} />
                  </div>
                </div>
              );
            })}
            <div className="flex items-center gap-4 text-xs text-muted-foreground pt-2 border-t">
              <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-primary/60" /> Detected</span>
              <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-green-500/60" /> Confirmed</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Confidence Distribution</CardTitle>
            <CardDescription>AI confidence levels across detected personas</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {[
              { label: "High (80%+)", value: data.confidence_distribution.high, color: "bg-green-500" },
              { label: "Medium (50-80%)", value: data.confidence_distribution.medium, color: "bg-amber-500" },
              { label: "Low (<50%)", value: data.confidence_distribution.low, color: "bg-red-500" },
            ].map((item) => (
              <div key={item.label} className="space-y-1">
                <div className="flex items-center justify-between text-sm">
                  <span>{item.label}</span>
                  <span className="font-medium">{item.value}</span>
                </div>
                <div className="w-full bg-muted rounded-full h-3">
                  <div className={`${item.color} h-3 rounded-full transition-all`} style={{ width: `${totalConfidence > 0 ? (item.value / totalConfidence) * 100 : 0}%` }} />
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      {data.corrections.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-amber-400" />
              Persona Corrections
            </CardTitle>
            <CardDescription>Cases where AI-detected persona was overridden by a human</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-2 pr-4 font-medium text-muted-foreground">Lead</th>
                    <th className="text-left py-2 pr-4 font-medium text-muted-foreground">Detected</th>
                    <th className="text-left py-2 pr-4 font-medium text-muted-foreground">Confirmed</th>
                    <th className="text-left py-2 font-medium text-muted-foreground">Archetype</th>
                  </tr>
                </thead>
                <tbody>
                  {data.corrections.map((c) => (
                    <tr key={c.lead_id} className="border-b last:border-0">
                      <td className="py-2 pr-4">
                        <Link href={`/leads/${c.lead_id}`} className="text-primary hover:underline font-medium">{c.lead_name}</Link>
                      </td>
                      <td className="py-2 pr-4">
                        <Badge variant="outline" className="text-red-400 border-red-500/30">{c.detected}</Badge>
                      </td>
                      <td className="py-2 pr-4">
                        <Badge variant="outline" className="text-green-400 border-green-500/30">{c.confirmed}</Badge>
                      </td>
                      <td className="py-2">{c.confirmed_archetype}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Awaiting Persona Confirmation</CardTitle>
          <CardDescription>Leads with AI-detected personas that haven't been validated yet</CardDescription>
        </CardHeader>
        <CardContent>
          {data.unconfirmed_leads.length === 0 ? (
            <div className="py-8 text-center text-muted-foreground border border-dashed rounded-lg">
              All detected personas have been confirmed
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-2 pr-4 font-medium text-muted-foreground">Lead</th>
                    <th className="text-left py-2 pr-4 font-medium text-muted-foreground">Detected Persona</th>
                    <th className="text-left py-2 pr-4 font-medium text-muted-foreground">Confidence</th>
                    <th className="text-left py-2 pr-4 font-medium text-muted-foreground">Stage</th>
                    <th className="text-left py-2 font-medium text-muted-foreground">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {data.unconfirmed_leads.map((lead) => (
                    <tr key={lead.lead_id} className="border-b last:border-0">
                      <td className="py-2 pr-4">
                        <Link href={`/leads/${lead.lead_id}`} className="text-primary hover:underline font-medium">{lead.name}</Link>
                      </td>
                      <td className="py-2 pr-4">{lead.detected_persona}</td>
                      <td className="py-2 pr-4">
                        <Badge variant={lead.persona_confidence && lead.persona_confidence >= 0.8 ? "default" : "secondary"}>
                          {lead.persona_confidence ? `${Math.round(lead.persona_confidence * 100)}%` : "N/A"}
                        </Badge>
                      </td>
                      <td className="py-2 pr-4"><Badge variant="outline">{lead.pipeline_stage}</Badge></td>
                      <td className="py-2">
                        <Link href={`/leads/${lead.lead_id}`}>
                          <Button size="sm" variant="outline" className="gap-1 text-xs">
                            <CheckCircle className="w-3 h-3" />Confirm
                          </Button>
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Persona Breakdown</CardTitle>
          <CardDescription>Individual persona detection counts</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
            {Object.entries(data.persona_distribution)
              .sort(([, a], [, b]) => (b.detected + b.confirmed) - (a.detected + a.confirmed))
              .map(([persona, counts]) => (
                <div key={persona} className="p-3 border rounded-md">
                  <div className="text-sm font-medium truncate" title={persona}>{persona}</div>
                  <div className="flex items-center gap-2 mt-1">
                    <Badge variant="secondary" className="text-xs">D: {counts.detected}</Badge>
                    {counts.confirmed > 0 && <Badge variant="default" className="text-xs">C: {counts.confirmed}</Badge>}
                  </div>
                </div>
              ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
