import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CheckCircle, Circle, Phone, ArrowRight, Loader2, User, Target, AlertTriangle, FileText, ArrowLeft } from "lucide-react";

const API_BASE = (import.meta.env.BASE_URL?.replace(/\/$/, "") || "") + "/api";

type CallQuestion = {
  id: string;
  question: string;
  purpose: string;
  signals: string[];
  listen_for: string[];
};

const STATE_COLOURS: Record<string, string> = {
  UNKNOWN: "bg-gray-300",
  ABSENT: "bg-red-400",
  PARTIAL: "bg-amber-400",
  ESTABLISHED: "bg-green-500",
  BLOCKED: "bg-purple-400",
};

export default function CallPrep() {
  const [, setLocation] = useLocation();
  const leadId = new URLSearchParams(window.location.search).get("lead");

  const [questions, setQuestions] = useState<CallQuestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [checked, setChecked] = useState<Record<string, boolean>>({
    Q1: false, Q2: false, Q3: false, Q4: false,
  });

  const [lead, setLead] = useState<any>(null);
  const [beliefs, setBeliefs] = useState<any[]>([]);
  const [intelligence, setIntelligence] = useState<any>(null);
  const [nextAction, setNextAction] = useState<any>(null);
  const [leadLoading, setLeadLoading] = useState(!!leadId);

  useEffect(() => {
    fetch(`${API_BASE}/call-framework/questions`)
      .then((r) => r.json())
      .then((data) => {
        setQuestions(data.questions || []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!leadId) return;
    setLeadLoading(true);
    Promise.all([
      fetch(`${API_BASE}/leads/${leadId}`).then(r => r.ok ? r.json() : null),
      fetch(`${API_BASE}/leads/${leadId}/beliefs`).then(r => r.ok ? r.json() : { beliefs: [] }),
      fetch(`${API_BASE}/leads/${leadId}/intelligence`).then(r => r.ok ? r.json() : null),
      fetch(`${API_BASE}/leads/${leadId}/next-action`).then(r => r.ok ? r.json() : null),
    ]).then(([leadData, beliefsData, intelData, nextActionData]) => {
      setLead(leadData);
      setBeliefs(beliefsData?.beliefs || (Array.isArray(beliefsData) ? beliefsData : []));
      setIntelligence(intelData);
      setNextAction(nextActionData);
      setLeadLoading(false);
    }).catch(() => setLeadLoading(false));
  }, [leadId]);

  const toggleQuestion = (id: string) => {
    setChecked((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const coveredCount = Object.values(checked).filter(Boolean).length;

  const handleStartRecommend = () => {
    const p = new URLSearchParams();
    Object.entries(checked).forEach(([k, v]) => {
      if (v) p.set(k, "1");
    });
    if (leadId) p.set("lead_id", leadId);
    setLocation(`/recommend?${p.toString()}`);
  };

  if (loading || leadLoading) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-8rem)]">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  const gapBeliefs = beliefs.filter((b: any) => b.state === "ABSENT" || b.state === "PARTIAL" || b.state === "UNKNOWN");
  const establishedBeliefs = beliefs.filter((b: any) => b.state === "ESTABLISHED");
  const blockedBeliefs = beliefs.filter((b: any) => b.state === "BLOCKED");

  return (
    <div className="max-w-4xl mx-auto space-y-6 pb-12">
      <div className="flex items-center gap-3">
        {leadId && (
          <button onClick={() => setLocation(`/leads/${leadId}`)} className="p-2 hover:bg-muted rounded-full transition-colors">
            <ArrowLeft className="w-5 h-5" />
          </button>
        )}
        <Phone className="w-6 h-6 text-primary" />
        <h1 className="text-2xl font-bold tracking-tight">Call Preparation Brief</h1>
      </div>

      {lead && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                  <User className="w-5 h-5 text-primary" />
                </div>
                <div>
                  <div className="font-semibold">{lead.name}</div>
                  <div className="text-xs text-muted-foreground">{lead.company || "No company"}</div>
                </div>
              </div>
              <div className="flex gap-2 mt-3">
                <Badge variant="outline">{lead.pipeline_stage}</Badge>
                {lead.detected_persona && <Badge className="bg-primary text-primary-foreground">{lead.detected_persona}</Badge>}
              </div>
            </CardContent>
          </Card>

          {nextAction && (
            <Card className="border-primary/30 bg-primary/5">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Target className="w-4 h-4 text-primary" />
                  <span className="text-sm font-medium">Next Best Action</span>
                </div>
                <p className="text-sm">{nextAction.action}</p>
                <p className="text-xs text-muted-foreground mt-1">{nextAction.reason}</p>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-2">
                <FileText className="w-4 h-4 text-muted-foreground" />
                <span className="text-sm font-medium">Belief Summary</span>
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-green-500" />
                  {establishedBeliefs.length} Established
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-amber-400" />
                  {gapBeliefs.length} Gaps
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-purple-400" />
                  {blockedBeliefs.length} Blocked
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-gray-300" />
                  {beliefs.length} Total
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {lead && intelligence && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {intelligence.spin_situation && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">SPIN Situation</CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">{intelligence.spin_situation}</CardContent>
            </Card>
          )}
          {intelligence.spin_problem && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">SPIN Problem</CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">{intelligence.spin_problem}</CardContent>
            </Card>
          )}
          {intelligence.spin_implication && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">SPIN Implication</CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">{intelligence.spin_implication}</CardContent>
            </Card>
          )}
          {intelligence.spin_need_payoff && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">SPIN Need-Payoff</CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">{intelligence.spin_need_payoff}</CardContent>
            </Card>
          )}
        </div>
      )}

      {lead && blockedBeliefs.length > 0 && (
        <Card className="border-purple-500/30">
          <CardHeader className="pb-2">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-purple-400" />
              <CardTitle className="text-sm">Blocked Beliefs — Avoid Confronting Directly</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {blockedBeliefs.map((b: any) => (
                <div key={b.belief_id} className="flex items-center gap-2 text-sm">
                  <span className={`w-2 h-2 rounded-full ${STATE_COLOURS[b.state]}`} />
                  <span className="font-medium">{b.belief_id}</span>
                  <span className="text-muted-foreground">— {b.name || b.belief_id}</span>
                  {b.evidence && <span className="text-xs text-muted-foreground italic ml-auto max-w-[300px] truncate">"{b.evidence}"</span>}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {lead && gapBeliefs.length > 0 && (
        <Card className="border-amber-500/30">
          <CardHeader className="pb-2">
            <div className="flex items-center gap-2">
              <Target className="w-4 h-4 text-amber-400" />
              <CardTitle className="text-sm">Belief Gaps — Priority Topics for This Call</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {gapBeliefs.slice(0, 6).map((b: any) => (
                <div key={b.belief_id} className="flex items-center gap-2 text-sm">
                  <span className={`w-2 h-2 rounded-full ${STATE_COLOURS[b.state]}`} />
                  <span className="font-medium">{b.belief_id}</span>
                  <span className="text-muted-foreground">— {b.name || b.belief_id}</span>
                  <Badge variant="outline" className="text-xs ml-auto">{b.state}</Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <div className="space-y-2">
        <h2 className="text-lg font-semibold">Call Questions Checklist</h2>
        <p className="text-muted-foreground text-sm">
          Cover these four questions in every call. They don't need to be asked verbatim — work them into the conversation naturally.
        </p>
      </div>

      <div className="flex items-center gap-3 p-4 rounded-lg border bg-muted/30">
        <Badge
          variant={coveredCount === 4 ? "default" : coveredCount >= 3 ? "secondary" : "destructive"}
          className="text-sm px-3 py-1"
        >
          {coveredCount}/4
        </Badge>
        <span className="text-sm">
          {coveredCount === 4
            ? "Full coverage — ready for high-confidence analysis"
            : coveredCount >= 3
            ? "Good coverage — note which signal is missing"
            : coveredCount >= 1
            ? "Low coverage — analysis confidence may be reduced"
            : "No questions covered yet"}
        </span>
      </div>

      <div className="space-y-4">
        {questions.map((q) => {
          const isChecked = checked[q.id] || false;
          return (
            <Card
              key={q.id}
              className={`transition-all cursor-pointer ${
                isChecked ? "border-primary/50 bg-primary/5" : ""
              }`}
              onClick={() => toggleQuestion(q.id)}
            >
              <CardContent className="p-6 space-y-4">
                <div className="flex items-start gap-4">
                  <button className="mt-1 shrink-0" onClick={(e) => { e.stopPropagation(); toggleQuestion(q.id); }}>
                    {isChecked ? (
                      <CheckCircle className="w-6 h-6 text-primary" />
                    ) : (
                      <Circle className="w-6 h-6 text-muted-foreground" />
                    )}
                  </button>
                  <div className="space-y-3 flex-1 min-w-0">
                    <p className="text-lg font-medium leading-snug">
                      "{q.question}"
                    </p>
                    <div>
                      <p className="text-sm font-medium text-muted-foreground mb-2">
                        What to listen for:
                      </p>
                      <ul className="space-y-1.5">
                        {q.listen_for.map((item, i) => (
                          <li key={i} className="text-sm text-muted-foreground flex items-start gap-2">
                            <span className="shrink-0 mt-1.5 w-1.5 h-1.5 rounded-full bg-muted-foreground/50" />
                            {item}
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <div className="sticky bottom-0 py-4 bg-background border-t">
        <Button
          size="lg"
          className="w-full gap-2 text-base"
          onClick={handleStartRecommend}
        >
          Start Recommend Flow
          <ArrowRight className="w-5 h-5" />
        </Button>
      </div>
    </div>
  );
}
