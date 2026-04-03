import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CheckCircle, Circle, Phone, ArrowRight, Loader2 } from "lucide-react";

const API_BASE = import.meta.env.VITE_API_URL || "/api";

type CallQuestion = {
  id: string;
  question: string;
  purpose: string;
  signals: string[];
  listen_for: string[];
};

export default function CallPrep() {
  const [, setLocation] = useLocation();
  const [questions, setQuestions] = useState<CallQuestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [checked, setChecked] = useState<Record<string, boolean>>({
    Q1: false,
    Q2: false,
    Q3: false,
    Q4: false,
  });

  useEffect(() => {
    fetch(`${API_BASE}/call-framework/questions`)
      .then((r) => r.json())
      .then((data) => {
        setQuestions(data.questions || []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const toggleQuestion = (id: string) => {
    setChecked((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const coveredCount = Object.values(checked).filter(Boolean).length;

  const handleStartRecommend = () => {
    const params = new URLSearchParams();
    Object.entries(checked).forEach(([k, v]) => {
      if (v) params.set(k, "1");
    });
    setLocation(`/recommend?${params.toString()}`);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-8rem)]">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto space-y-8">
      <div className="space-y-2">
        <div className="flex items-center gap-3">
          <Phone className="w-6 h-6 text-primary" />
          <h1 className="text-2xl font-bold tracking-tight">Before You Call</h1>
        </div>
        <p className="text-muted-foreground text-lg">
          Cover these four questions in every call. They don't need to be asked
          verbatim — work them into the conversation naturally.
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

      <div className="sticky bottom-0 py-4 bg-background border-t -mx-8 px-8">
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
