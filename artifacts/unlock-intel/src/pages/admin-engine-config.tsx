// Phase 7.0 — Read-only engine config viewer.
// Surfaces every config export from engine/v2/config.ts so admins can
// inspect what the engine is running against without a code read.
// Edit capability comes in Phase 7.1+; until then this is pure visibility.

import { Fragment, useState } from "react";
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
          <TableHead>Order</TableHead>
          <TableHead>Gate</TableHead>
          <TableHead>Condition / route</TableHead>
          <TableHead>When blocked</TableHead>
          <TableHead>Override</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((g) => (
          <TableRow key={g.id}>
            <TableCell className="font-mono text-xs">
              {g.evaluationOrder}
            </TableCell>
            <TableCell className="font-mono text-xs">{g.id}</TableCell>
            <TableCell className="text-xs font-mono max-w-md">
              {g.condition ? (
                <code className="whitespace-pre-wrap break-words">
                  {g.condition}
                </code>
              ) : g.routeMap ? (
                <div className="space-y-0.5">
                  {Object.entries(g.routeMap).map(([state, route]) => (
                    <div key={state}>
                      <span className="text-muted-foreground">{state}</span>{" "}
                      → {String(route)}
                    </div>
                  ))}
                </div>
              ) : (
                "—"
              )}
            </TableCell>
            <TableCell className="text-xs text-muted-foreground max-w-md">
              {g.blockedAction?.reason ?? "—"}
              {g.blockedAction?.send != null && (
                <div className="text-xs mt-0.5">
                  Sends doc {g.blockedAction.send}
                  {g.blockedAction.sendOnly ? " (only)" : ""}
                </div>
              )}
              {g.blockedAction?.blockDocument != null && (
                <div className="text-xs mt-0.5">
                  Blocks doc {g.blockedAction.blockDocument}
                </div>
              )}
              {g.blockedAction?.skipSignals && (
                <div className="text-xs mt-0.5">
                  Skips {g.blockedAction.skipSignals.join(", ")}
                </div>
              )}
              {g.blockedAction?.skipCategories && (
                <div className="text-xs mt-0.5">
                  Skips category {g.blockedAction.skipCategories.join(", ")}
                </div>
              )}
            </TableCell>
            <TableCell className="text-xs">{g.override ?? "—"}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
      </h3>
      {children}
    </div>
  );
}

function KeyValueGrid({
  rows,
}: {
  rows: Array<{ label: string; value: React.ReactNode }>;
}) {
  return (
    <div className="grid grid-cols-[180px_1fr] gap-x-4 gap-y-2 text-sm">
      {rows.map((r, i) => (
        <Fragment key={i}>
          <div className="text-muted-foreground">{r.label}</div>
          <div>{r.value}</div>
        </Fragment>
      ))}
    </div>
  );
}

function TimingRulesView({ data }: { data: any }) {
  const entries = Object.entries(data);
  return (
    <div className="space-y-6">
      {entries.map(([key, value]) => {
        const obj = value as Record<string, any>;
        return (
          <Section key={key} title={key}>
            <KeyValueGrid
              rows={Object.entries(obj).map(([k, v]) => ({
                label: k,
                value:
                  typeof v === "string" || typeof v === "number" ? (
                    <span className="font-mono text-xs">{String(v)}</span>
                  ) : (
                    <code className="text-xs">{JSON.stringify(v)}</code>
                  ),
              }))}
            />
          </Section>
        );
      })}
    </div>
  );
}

function CallTypesView({ data }: { data: any }) {
  return (
    <div className="space-y-8">
      {Object.entries(data).map(([key, raw]) => {
        const ct = raw as any;
        return (
          <Section key={key} title={`${ct.name ?? key} — Call ${ct.callNumber ?? "?"}`}>
            <KeyValueGrid
              rows={[
                { label: "Owner", value: ct.owner ?? "—" },
                {
                  label: "Duration",
                  value: ct.durationMins
                    ? `${ct.durationMins.min}–${ct.durationMins.max} min`
                    : "—",
                },
                {
                  label: "Signal responsibility",
                  value: (
                    <span className="font-mono text-xs">
                      {(ct.signalResponsibility || []).join(", ") || "—"}
                    </span>
                  ),
                },
                {
                  label: "Also surfaces",
                  value: (
                    <span className="font-mono text-xs">
                      {(ct.alsoSurfaces || []).join(", ") || "—"}
                    </span>
                  ),
                },
                {
                  label: "Success outcome",
                  value: ct.successOutcome ?? "—",
                },
                { label: "Produces", value: ct.produces ?? "—" },
                { label: "Close script", value: ct.closeScript ?? "—" },
              ]}
            />

            {ct.dispositionCodes && (
              <div className="mt-4">
                <div className="text-xs font-semibold text-muted-foreground mb-1">
                  Disposition codes
                </div>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Code</TableHead>
                      <TableHead>Label</TableHead>
                      <TableHead>Pipeline action</TableHead>
                      <TableHead>Fires</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {Object.entries(ct.dispositionCodes).map(
                      ([code, def]: [string, any]) => (
                        <TableRow key={code}>
                          <TableCell className="font-mono text-xs">
                            {code}
                          </TableCell>
                          <TableCell>{def.label}</TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {def.pipelineAction ?? "—"}
                          </TableCell>
                          <TableCell className="text-xs">
                            {def.firesWorkflow ?? def.createsTask ?? "—"}
                          </TableCell>
                        </TableRow>
                      ),
                    )}
                  </TableBody>
                </Table>
              </div>
            )}

            {ct.outcomes && (
              <div className="mt-4">
                <div className="text-xs font-semibold text-muted-foreground mb-1">
                  Outcomes
                </div>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Outcome</TableHead>
                      <TableHead>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {Object.entries(ct.outcomes).map(
                      ([outcome, def]: [string, any]) => (
                        <TableRow key={outcome}>
                          <TableCell className="font-mono text-xs">
                            {outcome}
                          </TableCell>
                          <TableCell className="text-xs">
                            {(def.actions || []).join(", ")}
                          </TableCell>
                        </TableRow>
                      ),
                    )}
                  </TableBody>
                </Table>
              </div>
            )}
          </Section>
        );
      })}
    </div>
  );
}

function PersonasView({ data }: { data: any }) {
  return (
    <div className="space-y-6">
      <KeyValueGrid
        rows={[
          {
            label: "Detection threshold",
            value: <span className="font-mono text-xs">{data.threshold}</span>,
          },
        ]}
      />

      <Section title="Personas">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>ID</TableHead>
              <TableHead>Label</TableHead>
              <TableHead>Problem cluster</TableHead>
              <TableHead>Demo emphasis</TableHead>
              <TableHead>Patterns</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(data.personas || []).map((p: any) => (
              <TableRow key={p.id}>
                <TableCell className="font-mono text-xs">{p.id}</TableCell>
                <TableCell>{p.label}</TableCell>
                <TableCell className="text-xs font-mono">
                  {(p.problemCluster || []).join(", ")}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground max-w-xs">
                  {p.demoEmphasis}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {(p.patterns || []).length} patterns
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Section>

      <Section title="Hot buttons">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>ID</TableHead>
              <TableHead>Trigger phrases</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(data.hotButtons || []).map((h: any) => (
              <TableRow key={h.id}>
                <TableCell className="font-mono text-xs">{h.id}</TableCell>
                <TableCell className="text-xs text-muted-foreground max-w-xl">
                  {(h.patterns || []).join(" · ")}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Section>
    </div>
  );
}

function EmailTemplatesView({ data }: { data: any }) {
  const renderTemplate = (label: string, tpl: any) => (
    <Section key={label} title={label}>
      <KeyValueGrid
        rows={[
          { label: "ID", value: <code className="text-xs">{tpl.id}</code> },
          { label: "Trigger", value: <code className="text-xs">{tpl.trigger}</code> },
          { label: "Timing", value: tpl.timing ?? "—" },
          { label: "Subject", value: tpl.subject ?? "—" },
          {
            label: "Attachment",
            value: tpl.attachment
              ? `${tpl.attachment.docId} — ${tpl.attachment.docName}`
              : "—",
          },
          {
            label: "Personalisation",
            value: tpl.personalisationRequired ? "required" : "not required",
          },
        ]}
      />
      {tpl.structure && (
        <div className="mt-2">
          <div className="text-xs font-semibold text-muted-foreground mb-1">
            Structure
          </div>
          <ol className="list-decimal pl-5 space-y-1 text-xs">
            {tpl.structure.map((s: string, i: number) => (
              <li key={i}>{s}</li>
            ))}
          </ol>
        </div>
      )}
      {tpl.note && (
        <div className="mt-2 text-xs text-muted-foreground italic">
          {tpl.note}
        </div>
      )}
    </Section>
  );

  return (
    <div className="space-y-6">
      {data.demoConfirmation &&
        renderTemplate("Demo confirmation (EMAIL_1)", data.demoConfirmation)}
      {data.postDemo && renderTemplate("Post-demo (EMAIL_2)", data.postDemo)}

      {data.attachmentRoutingTable && (
        <Section title="Attachment routing table">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Belief / trigger</TableHead>
                <TableHead>Doc</TableHead>
                <TableHead>Notes</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(data.attachmentRoutingTable as any[]).map((row, i) => (
                <TableRow key={i}>
                  <TableCell className="font-mono text-xs">
                    {row.belief ?? row.trigger ?? "—"}
                  </TableCell>
                  <TableCell className="text-xs">
                    {row.docId != null
                      ? `${row.docId}${row.docName ? ` — ${row.docName}` : ""}`
                      : "—"}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {row.note ?? row.state ?? "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Section>
      )}

      {data.personaSupplementWithPack1 && (
        <Section title="Persona supplement with Pack 1">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Persona</TableHead>
                <TableHead>Supplement</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {Object.entries(data.personaSupplementWithPack1).map(
                ([persona, v]: [string, any]) => (
                  <TableRow key={persona}>
                    <TableCell className="font-mono text-xs">
                      {persona}
                    </TableCell>
                    <TableCell className="text-xs">
                      {v.docId != null
                        ? `${v.docId} — ${v.docName}`
                        : Array.isArray(v.docIds)
                        ? v.docIds
                            .map(
                              (id: number, i: number) =>
                                `${id} — ${v.docNames?.[i] ?? ""}`,
                            )
                            .join(", ")
                        : JSON.stringify(v)}
                    </TableCell>
                  </TableRow>
                ),
              )}
            </TableBody>
          </Table>
        </Section>
      )}
    </div>
  );
}

function PostCloseWorkflowView({ data }: { data: any }) {
  return (
    <div className="space-y-6">
      {(data.stages || []).map((s: any) => (
        <Section key={s.stage} title={`Stage ${s.stage} — ${s.name}`}>
          <div className="text-xs text-muted-foreground mb-2">
            Trigger: <code>{s.trigger}</code>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Action</TableHead>
                <TableHead>Owner</TableHead>
                <TableHead>Timing</TableHead>
                <TableHead>Detail</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {[...(s.actions || []), ...(s.recurringActions || [])].map(
                (a: any, i: number) => (
                  <TableRow key={i}>
                    <TableCell className="font-mono text-xs">
                      {a.action}
                    </TableCell>
                    <TableCell className="text-xs">{a.owner}</TableCell>
                    <TableCell className="text-xs">{a.timing}</TableCell>
                    <TableCell className="text-xs text-muted-foreground max-w-md">
                      {a.detail ?? "—"}
                    </TableCell>
                  </TableRow>
                ),
              )}
            </TableBody>
          </Table>
        </Section>
      ))}
    </div>
  );
}

function AdviserLoopView({ data }: { data: any }) {
  const phase = (label: string, p: any) => {
    if (!p) return null;
    return (
      <Section key={label} title={label}>
        {p.tomRole && (
          <KeyValueGrid rows={[{ label: "Tom's role", value: p.tomRole }]} />
        )}
        {p.openingFrame && (
          <div className="mt-2 text-xs italic border-l-2 border-muted pl-3">
            "{p.openingFrame}"
          </div>
        )}
        {p.agenda && (
          <div className="mt-2">
            <div className="text-xs font-semibold text-muted-foreground mb-1">
              Agenda
            </div>
            <ul className="list-disc pl-5 text-xs space-y-0.5">
              {p.agenda.map((a: string, i: number) => (
                <li key={i}>{a}</li>
              ))}
            </ul>
          </div>
        )}
        {p.fcaConcerns && (
          <div className="mt-2 text-xs text-muted-foreground">
            <span className="font-semibold">FCA concerns:</span> {p.fcaConcerns}
          </div>
        )}
        {p.actions && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Action</TableHead>
                <TableHead>Owner</TableHead>
                <TableHead>Timing</TableHead>
                <TableHead>Detail</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {p.actions.map((a: any, i: number) => (
                <TableRow key={i}>
                  <TableCell className="font-mono text-xs">
                    {a.action}
                  </TableCell>
                  <TableCell className="text-xs">{a.owner ?? "—"}</TableCell>
                  <TableCell className="text-xs">
                    {a.timing ?? a.nextStep ?? "—"}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground max-w-md">
                    {a.detail ?? (a.fields ? a.fields.join(", ") : "—")}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Section>
    );
  };

  return (
    <div className="space-y-6">
      <KeyValueGrid
        rows={[
          {
            label: "Trigger",
            value: <code className="text-xs">{data.trigger}</code>,
          },
        ]}
      />
      {phase("Pre-call", data.preCall)}
      {phase("During call", data.duringCall)}
      {phase("Post-call", data.postCall)}
    </div>
  );
}

function Book2RoutingView({ data }: { data: any }) {
  return (
    <div className="space-y-6">
      <KeyValueGrid
        rows={[
          {
            label: "Trigger",
            value: <code className="text-xs">{data.trigger}</code>,
          },
        ]}
      />

      {data.entryActions && (
        <Section title="Entry actions">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Action</TableHead>
                <TableHead>Owner</TableHead>
                <TableHead>Timing</TableHead>
                <TableHead>Detail</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.entryActions.map((a: any, i: number) => (
                <TableRow key={i}>
                  <TableCell className="font-mono text-xs">{a.action}</TableCell>
                  <TableCell className="text-xs">{a.owner ?? "—"}</TableCell>
                  <TableCell className="text-xs">{a.timing ?? "—"}</TableCell>
                  <TableCell className="text-xs text-muted-foreground max-w-md">
                    {a.detail ?? "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Section>
      )}

      {data.subscriberPipeline && (
        <Section title="Subscriber pipeline">
          {data.subscriberPipeline.map((stage: any, i: number) => (
            <div key={i} className="mb-4 last:mb-0">
              <div className="text-sm font-semibold">{stage.stage}</div>
              <div className="text-xs text-muted-foreground mb-1">
                Trigger: <code>{stage.trigger}</code>
              </div>
              {stage.action && (
                <div className="text-xs mb-1">
                  <span className="text-muted-foreground">Action:</span>{" "}
                  {stage.action}
                </div>
              )}
              {stage.autoEmails && (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Email</TableHead>
                      <TableHead>Timing</TableHead>
                      <TableHead>Length</TableHead>
                      <TableHead>Content</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {stage.autoEmails.map((e: any, j: number) => (
                      <TableRow key={j}>
                        <TableCell className="text-xs">{e.name}</TableCell>
                        <TableCell className="text-xs font-mono">
                          {e.timing}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {e.wordCount ?? "—"}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground max-w-md">
                          {e.content}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </div>
          ))}
        </Section>
      )}

      {data.crossoverRule && (
        <Section title="Crossover rule">
          <p className="text-xs text-muted-foreground">{data.crossoverRule}</p>
        </Section>
      )}

      {data.exclusionRules && (
        <Section title="Exclusion rules">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Tag</TableHead>
                <TableHead>Rule</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.exclusionRules.map((r: any, i: number) => (
                <TableRow key={i}>
                  <TableCell className="font-mono text-xs">{r.tag}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {r.rule}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Section>
      )}
    </div>
  );
}

function ProblemBeliefPatternsTable({
  rows,
}: {
  rows: Record<string, any>;
}) {
  const entries = Object.entries(rows);
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Code</TableHead>
          <TableHead>Belief</TableHead>
          <TableHead>Pattern count</TableHead>
          <TableHead>Sample patterns</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {entries.map(([code, def]) => (
          <TableRow key={code}>
            <TableCell className="font-mono text-xs">{code}</TableCell>
            <TableCell className="text-sm">
              {def.belief ?? def.name ?? "—"}
            </TableCell>
            <TableCell className="text-xs text-muted-foreground">
              {(def.patterns || []).length}
            </TableCell>
            <TableCell className="text-xs text-muted-foreground max-w-xl">
              {(def.patterns || [])
                .slice(0, 4)
                .map((p: any) => p.pattern ?? p)
                .join(" · ")}
              {(def.patterns || []).length > 4 && " …"}
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
      case "timingRules":
        body = <TimingRulesView data={data.timingRules} />;
        break;
      case "callTypes":
        body = <CallTypesView data={data.callTypes} />;
        break;
      case "personaConfig":
        body = <PersonasView data={data.personaConfig} />;
        break;
      case "emailTemplates":
        body = <EmailTemplatesView data={data.emailTemplates} />;
        break;
      case "postCloseWorkflow":
        body = <PostCloseWorkflowView data={data.postCloseWorkflow} />;
        break;
      case "adviserLoopWorkflow":
        body = <AdviserLoopView data={data.adviserLoopWorkflow} />;
        break;
      case "book2Routing":
        body = <Book2RoutingView data={data.book2Routing} />;
        break;
      case "problemBeliefPatterns":
        body = (
          <ProblemBeliefPatternsTable rows={data.problemBeliefPatterns} />
        );
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
