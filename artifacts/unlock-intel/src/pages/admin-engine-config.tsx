// Phase 7.0 — Read-only engine config viewer.
// Surfaces every config export from engine/v2/config.ts so admins can
// inspect what the engine is running against without a code read.
// Edit capability comes in Phase 7.1+; until then this is pure visibility.

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Loader2, Copy, Check, Search } from "lucide-react";
import { apiFetch } from "@/lib/apiClient";

interface ConfigPayload {
  meta: { engineVersion: string; spec: string; updated: string };
  signals: any[];
  questions: any[];
  gates: any[];
  routingMap: any[];
  personaConfig: Record<string, any>;
  callTypes: Record<string, any>;
  timingRules: Record<string, any>;
  compliance: { version: string; effectiveDate: string; rules: any[] };
  redSignalActions: Record<string, { meaning: string; action: string }>;
  pipelineStages: any[];
  demoSegments: any[];
  coldCallSteps: any[];
  emailTemplates: Record<string, any>;
  problemBeliefPatterns: Record<string, any>;
  postCloseWorkflow: { stages: any[] };
  adviserLoopWorkflow: any;
  book2Routing: any;
}

function fetchConfig(): Promise<ConfigPayload> {
  return apiFetch("/api/engine/config/all").then((r) => {
    if (!r.ok) throw new Error(`Failed to load engine config (${r.status})`);
    return r.json();
  });
}

function CopyButton({ value }: { value: unknown }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={() => {
        navigator.clipboard.writeText(
          typeof value === "string" ? value : JSON.stringify(value, null, 2),
        );
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
    >
      {copied ? (
        <>
          <Check className="w-3.5 h-3.5 mr-1" /> Copied
        </>
      ) : (
        <>
          <Copy className="w-3.5 h-3.5 mr-1" /> Copy JSON
        </>
      )}
    </Button>
  );
}

function SurfaceHeader({
  title,
  subtitle,
  count,
  raw,
}: {
  title: string;
  subtitle?: string;
  count?: number;
  raw: unknown;
}) {
  return (
    <div className="flex items-start justify-between gap-4 mb-4">
      <div>
        <h2 className="text-lg font-semibold">{title}</h2>
        {subtitle && (
          <p className="text-sm text-muted-foreground mt-0.5">{subtitle}</p>
        )}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {count != null && (
          <Badge variant="outline" className="font-mono">
            {count}
          </Badge>
        )}
        <CopyButton value={raw} />
      </div>
    </div>
  );
}

function filterRows<T extends Record<string, any>>(rows: T[], query: string): T[] {
  if (!query.trim()) return rows;
  const q = query.toLowerCase();
  return rows.filter((r) =>
    JSON.stringify(r).toLowerCase().includes(q),
  );
}

function JsonBlock({ value }: { value: unknown }) {
  return (
    <pre className="bg-muted/50 rounded-md p-3 text-xs overflow-x-auto max-h-[500px] whitespace-pre-wrap break-words">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

function SignalsTable({ rows }: { rows: any[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Code</TableHead>
          <TableHead>Name</TableHead>
          <TableHead>Category</TableHead>
          <TableHead>Persona</TableHead>
          <TableHead>Priority</TableHead>
          <TableHead>Gate role</TableHead>
          <TableHead>States</TableHead>
          <TableHead>Detection patterns</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((s) => (
          <TableRow key={s.code}>
            <TableCell className="font-mono text-xs">{s.code}</TableCell>
            <TableCell>{s.name}</TableCell>
            <TableCell>
              <Badge variant="secondary">{s.category}</Badge>
            </TableCell>
            <TableCell>{s.persona ?? "—"}</TableCell>
            <TableCell className="font-mono text-xs">{s.priority}</TableCell>
            <TableCell>{s.gateRole ?? "—"}</TableCell>
            <TableCell className="text-xs">
              {(s.validStates || []).join(" / ")}
            </TableCell>
            <TableCell className="text-xs text-muted-foreground">
              {(s.detectionPatterns || []).length} pos /{" "}
              {(s.negativePatterns || []).length} neg
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function QuestionsTable({ rows }: { rows: any[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Q#</TableHead>
          <TableHead>Call</TableHead>
          <TableHead>Category</TableHead>
          <TableHead>Signal</TableHead>
          <TableHead>Gate role</TableHead>
          <TableHead>Text</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((q) => (
          <TableRow key={q.qNum}>
            <TableCell className="font-mono text-xs">Q{q.qNum}</TableCell>
            <TableCell>
              <Badge variant="outline">{q.call}</Badge>
            </TableCell>
            <TableCell className="text-xs">{q.category}</TableCell>
            <TableCell className="font-mono text-xs">
              {q.signal ?? "—"}
            </TableCell>
            <TableCell className="text-xs">{q.gateRole ?? "—"}</TableCell>
            <TableCell className="text-sm max-w-xl">
              {q.text}
              {q.variants && (
                <div className="mt-1 text-xs text-muted-foreground">
                  {Object.keys(q.variants).length} persona variants
                </div>
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function GatesTable({ rows }: { rows: any[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Code</TableHead>
          <TableHead>Name</TableHead>
          <TableHead>Description</TableHead>
          <TableHead>Blocking signals</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((g) => (
          <TableRow key={g.code}>
            <TableCell className="font-mono text-xs">{g.code}</TableCell>
            <TableCell>{g.name}</TableCell>
            <TableCell className="text-sm text-muted-foreground max-w-xl">
              {g.description ?? "—"}
            </TableCell>
            <TableCell className="text-xs font-mono">
              {(g.blockingSignals || g.requiresSignals || []).join(", ") || "—"}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function RoutingTable({ rows }: { rows: any[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Signal</TableHead>
          <TableHead>Trigger states</TableHead>
          <TableHead>Doc ID</TableHead>
          <TableHead>Doc name</TableHead>
          <TableHead>Alt</TableHead>
          <TableHead>Persona variants</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r, i) => (
          <TableRow key={`${r.signal}-${i}`}>
            <TableCell className="font-mono text-xs">{r.signal}</TableCell>
            <TableCell className="text-xs">
              {(r.triggerStates || []).join(" / ")}
            </TableCell>
            <TableCell className="font-mono text-xs">
              {r.docId ?? "—"}
            </TableCell>
            <TableCell>{r.docName ?? "—"}</TableCell>
            <TableCell className="text-xs">
              {r.altDoc ? `${r.altDoc.docId} — ${r.altDoc.docName}` : "—"}
            </TableCell>
            <TableCell className="text-xs">
              {r.personaVariant
                ? Object.keys(r.personaVariant).join(", ")
                : "—"}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function DemoSegmentsTable({ rows }: { rows: any[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>#</TableHead>
          <TableHead>Name</TableHead>
          <TableHead>Duration</TableHead>
          <TableHead>Screen</TableHead>
          <TableHead>Signals surfaced</TableHead>
          <TableHead>Critical gate</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((s) => (
          <TableRow key={s.segment}>
            <TableCell className="font-mono text-xs">{s.segment}</TableCell>
            <TableCell>{s.name}</TableCell>
            <TableCell className="text-xs">{s.durationMins}m</TableCell>
            <TableCell className="text-xs">{s.screenShare ? "yes" : "no"}</TableCell>
            <TableCell className="text-xs font-mono">
              {(s.signalsSurfaced || []).join(", ") || "—"}
            </TableCell>
            <TableCell className="text-xs">{s.criticalGate ?? "—"}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function ColdCallStepsTable({ rows }: { rows: any[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Step</TableHead>
          <TableHead>Name</TableHead>
          <TableHead>Goal</TableHead>
          <TableHead>Details</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((s, i) => (
          <TableRow key={`${s.step ?? i}`}>
            <TableCell className="font-mono text-xs">{s.step ?? i + 1}</TableCell>
            <TableCell>{s.name ?? s.title ?? "—"}</TableCell>
            <TableCell className="text-sm max-w-md">
              {s.goal ?? s.purpose ?? "—"}
            </TableCell>
            <TableCell className="text-xs text-muted-foreground max-w-xl">
              {s.script ?? s.note ?? s.description ?? "—"}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function PipelineStagesTable({ rows }: { rows: any[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Event / stage</TableHead>
          <TableHead>Raw</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((p, i) => (
          <TableRow key={i}>
            <TableCell className="font-mono text-xs">
              {typeof p === "string" ? p : p.event ?? p.stage ?? p.name ?? `#${i}`}
            </TableCell>
            <TableCell className="text-xs text-muted-foreground">
              {typeof p === "string" ? "—" : JSON.stringify(p)}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function ComplianceRulesTable({
  compliance,
}: {
  compliance: ConfigPayload["compliance"];
}) {
  return (
    <>
      <div className="text-xs text-muted-foreground mb-2">
        Version {compliance.version} · Effective {compliance.effectiveDate}
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Code</TableHead>
            <TableHead>Rule</TableHead>
            <TableHead>Trigger</TableHead>
            <TableHead>Phrases</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {(compliance.rules || []).map((r: any) => (
            <TableRow key={r.code ?? r.id}>
              <TableCell className="font-mono text-xs">{r.code ?? r.id}</TableCell>
              <TableCell className="text-sm max-w-md">{r.name ?? r.description ?? "—"}</TableCell>
              <TableCell className="text-xs">{r.trigger ?? r.appliesWhen ?? "—"}</TableCell>
              <TableCell className="text-xs text-muted-foreground max-w-md">
                {Array.isArray(r.phrases) ? r.phrases.join(" | ") : r.phrase ?? "—"}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </>
  );
}

function RedSignalActionsTable({
  rows,
}: {
  rows: Record<string, { meaning: string; action: string }>;
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Signal code</TableHead>
          <TableHead>Meaning</TableHead>
          <TableHead>Action</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {Object.entries(rows).map(([code, def]) => (
          <TableRow key={code}>
            <TableCell className="font-mono text-xs">{code}</TableCell>
            <TableCell className="text-sm">{def.meaning}</TableCell>
            <TableCell className="text-sm text-muted-foreground">{def.action}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

const SURFACES: Array<{
  id: string;
  group: string;
  label: string;
  subtitle: string;
}> = [
  { id: "signals", group: "Intelligence", label: "Signals", subtitle: "Catalog of signal codes the engine tracks across qualification, belief and demo surfaces." },
  { id: "questions", group: "Intelligence", label: "Questions", subtitle: "Question registry — phrasing, call number, gate role and persona variants." },
  { id: "gates", group: "Intelligence", label: "Gates", subtitle: "Gate definitions and the signals that keep each gate closed." },
  { id: "personaConfig", group: "Intelligence", label: "Personas", subtitle: "Persona definitions, detection rules and hot-button mappings." },
  { id: "routingMap", group: "Routing", label: "Routing map", subtitle: "Signal state → document routing, with persona variants and alt docs." },
  { id: "redSignalActions", group: "Routing", label: "Red signal actions", subtitle: "What to do when each signal transitions to red." },
  { id: "book2Routing", group: "Routing", label: "Book 2 routing", subtitle: "Triggering criteria for the Book 2 callback loop." },
  { id: "timingRules", group: "Routing", label: "Timing rules", subtitle: "Follow-up cadence and cool-off defaults." },
  { id: "callTypes", group: "Call structure", label: "Call types", subtitle: "Cold call / opportunity / demo definitions." },
  { id: "demoSegments", group: "Call structure", label: "Demo segments", subtitle: "Six-segment demo agenda with durations, signals and critical gates." },
  { id: "coldCallSteps", group: "Call structure", label: "Cold-call steps", subtitle: "Cold-call script the pre-call panel uses." },
  { id: "pipelineStages", group: "Call structure", label: "Pipeline stages", subtitle: "Logical event names emitted by the engine; mapped to website stages in Phase 7.5." },
  { id: "emailTemplates", group: "Post-call", label: "Email templates", subtitle: "EMAIL_1 / EMAIL_2 templates and attachment routing." },
  { id: "postCloseWorkflow", group: "Post-call", label: "Post-close workflow", subtitle: "Post-close checklist stages." },
  { id: "adviserLoopWorkflow", group: "Post-call", label: "Adviser loop", subtitle: "Adviser-loop checklist." },
  { id: "compliance", group: "Post-call", label: "Compliance", subtitle: "C9 exact-string compliance rules enforced on email drafts." },
  { id: "problemBeliefPatterns", group: "Post-call", label: "Problem-belief patterns", subtitle: "Keyword patterns used by the legacy keyword extraction path." },
];

const GROUPS = ["Intelligence", "Routing", "Call structure", "Post-call"];

export default function AdminEngineConfigPage() {
  const [activeSurfaceId, setActiveSurfaceId] = useState<string>("signals");
  const [query, setQuery] = useState("");

  const { data, isLoading, error } = useQuery({
    queryKey: ["engine-config-all"],
    queryFn: fetchConfig,
  });

  const activeSurface = SURFACES.find((s) => s.id === activeSurfaceId);
  const rawValue = data ? (data as any)[activeSurfaceId] : undefined;

  const renderSurface = () => {
    if (!data || !activeSurface || rawValue === undefined) return null;

    // Tabular renderers for the surfaces with an obvious shape. Anything
    // else falls back to a pretty-printed JSON block — still useful, just
    // less glanceable.
    const countable =
      Array.isArray(rawValue)
        ? rawValue.length
        : typeof rawValue === "object" && rawValue
        ? Object.keys(rawValue).length
        : undefined;

    let body: React.ReactNode;
    switch (activeSurfaceId) {
      case "signals":
        body = <SignalsTable rows={filterRows(data.signals, query)} />;
        break;
      case "questions":
        body = <QuestionsTable rows={filterRows(data.questions, query)} />;
        break;
      case "gates":
        body = <GatesTable rows={filterRows(data.gates, query)} />;
        break;
      case "routingMap":
        body = <RoutingTable rows={filterRows(data.routingMap, query)} />;
        break;
      case "demoSegments":
        body = <DemoSegmentsTable rows={filterRows(data.demoSegments, query)} />;
        break;
      case "coldCallSteps":
        body = <ColdCallStepsTable rows={filterRows(data.coldCallSteps, query)} />;
        break;
      case "pipelineStages":
        body = <PipelineStagesTable rows={data.pipelineStages} />;
        break;
      case "compliance":
        body = <ComplianceRulesTable compliance={data.compliance} />;
        break;
      case "redSignalActions":
        body = <RedSignalActionsTable rows={data.redSignalActions} />;
        break;
      default:
        body = <JsonBlock value={rawValue} />;
    }

    return (
      <>
        <SurfaceHeader
          title={activeSurface.label}
          subtitle={activeSurface.subtitle}
          count={countable}
          raw={rawValue}
        />
        <div className="relative mb-3">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter rows…"
            className="pl-9"
          />
        </div>
        {body}
      </>
    );
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-4">
            <div>
              <CardTitle>Engine config</CardTitle>
              <p className="text-sm text-muted-foreground mt-1">
                Read-only view of every config surface in{" "}
                <code className="font-mono text-xs bg-muted px-1 py-0.5 rounded">
                  engine/v2/config.ts
                </code>
                . Editing lands in Phase 7.1.
              </p>
            </div>
            {data && (
              <div className="text-right text-sm shrink-0">
                <div className="font-mono text-xs">
                  v{data.meta.engineVersion}
                </div>
                <div className="text-xs text-muted-foreground">
                  spec {data.meta.spec}
                </div>
                <div className="text-xs text-muted-foreground">
                  updated {data.meta.updated}
                </div>
              </div>
            )}
          </div>
        </CardHeader>
      </Card>

      {isLoading && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-8 justify-center">
          <Loader2 className="w-4 h-4 animate-spin" />
          Loading engine config…
        </div>
      )}

      {error && (
        <Card>
          <CardContent className="py-6 text-sm text-destructive">
            {(error as Error).message}
          </CardContent>
        </Card>
      )}

      {data && (
        <div className="grid grid-cols-[240px_1fr] gap-4">
          <Card className="h-fit sticky top-4">
            <CardContent className="p-3 space-y-4">
              {GROUPS.map((group) => (
                <div key={group}>
                  <p className="px-2 mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    {group}
                  </p>
                  <div className="space-y-0.5">
                    {SURFACES.filter((s) => s.group === group).map((s) => (
                      <button
                        key={s.id}
                        onClick={() => setActiveSurfaceId(s.id)}
                        className={`w-full text-left text-sm px-2 py-1.5 rounded transition-colors ${
                          activeSurfaceId === s.id
                            ? "bg-primary/10 text-primary font-medium"
                            : "hover:bg-muted"
                        }`}
                      >
                        {s.label}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-6">{renderSurface()}</CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
