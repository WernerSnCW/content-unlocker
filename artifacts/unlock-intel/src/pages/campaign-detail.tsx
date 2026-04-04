import { Fragment, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useRoute, useLocation } from "wouter";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  ArrowLeft,
  Play,
  Shield,
  CheckCircle2,
  AlertTriangle,
  Clock,
  Zap,
  FileText,
  Download,
  ChevronDown,
  ChevronRight,
  Megaphone,
  Loader2,
} from "lucide-react";

const API_BASE = "/api";

const CHANNEL_LABELS: Record<string, string> = {
  email_cold: "Cold Email",
  email_warm: "Warm Email",
  email_nurture: "Nurture Email",
  whatsapp: "WhatsApp",
  linkedin_message: "LinkedIn",
  meta_ad: "Meta Ad",
  linkedin_ad: "LinkedIn Ad",
  display_ad: "Display Ad",
  call_script: "Call Script",
  voicemail: "Voicemail",
};

const STATUS_COLORS: Record<string, string> = {
  PENDING: "bg-gray-500",
  GENERATED: "bg-blue-500",
  PASSED: "bg-green-600",
  FAILED: "bg-red-600",
  WARNING: "bg-yellow-500",
};

export default function CampaignDetailPage() {
  const [, params] = useRoute("/campaigns/:id");
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const [expandedAsset, setExpandedAsset] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"assets" | "sequence" | "ac-build" | "tags">("assets");

  const campaignId = params?.id;

  const { data, isLoading } = useQuery({
    queryKey: ["campaign", campaignId],
    queryFn: async () => {
      const r = await fetch(`${API_BASE}/campaigns/${campaignId}`);
      if (!r.ok) throw new Error(`Failed to load campaign`);
      return r.json();
    },
    enabled: !!campaignId,
  });

  const { data: acBuild } = useQuery({
    queryKey: ["campaign-ac-build", campaignId],
    queryFn: async () => {
      const r = await fetch(`${API_BASE}/campaigns/${campaignId}/ac-build`);
      if (!r.ok) throw new Error(`Failed to load AC build`);
      return r.json();
    },
    enabled: !!campaignId && activeTab === "ac-build",
  });

  const { data: tagTable } = useQuery({
    queryKey: ["campaign-tags", campaignId],
    queryFn: async () => {
      const r = await fetch(`${API_BASE}/campaigns/${campaignId}/tag-table`);
      if (!r.ok) throw new Error(`Failed to load tag table`);
      return r.json();
    },
    enabled: !!campaignId && activeTab === "tags",
  });

  const generateMutation = useMutation({
    mutationFn: async () => {
      const r = await fetch(`${API_BASE}/campaigns/${campaignId}/generate`, {
        method: "POST",
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error(err.message || `Generation failed`);
      }
      return r.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["campaign", campaignId] });
    },
  });

  const qcMutation = useMutation({
    mutationFn: async () => {
      const r = await fetch(`${API_BASE}/campaigns/${campaignId}/qc`);
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error(err.message || `QC failed`);
      }
      return r.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["campaign", campaignId] });
    },
  });

  const activateMutation = useMutation({
    mutationFn: async () => {
      const r = await fetch(`${API_BASE}/campaigns/${campaignId}/activate`, {
        method: "PATCH",
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error(err.message || `Activation failed`);
      }
      return r.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["campaign", campaignId] });
    },
  });

  if (isLoading || !data) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const { campaign, assets = [], channel_summary = {} } = data;
  const sequence = (campaign.sequence as any[]) || [];

  const pendingAssets = assets.filter(
    (a: any) => a.status === "PENDING" || !a.content
  );
  const generatedAssets = assets.filter((a: any) => a.content);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => navigate("/campaigns")}
        >
          <ArrowLeft className="w-4 h-4 mr-1" /> Back
        </Button>
      </div>

      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <Megaphone className="w-6 h-6 text-primary" />
            <h1 className="text-2xl font-bold">{campaign.name}</h1>
            <Badge
              className={`${STATUS_COLORS[campaign.status] || "bg-gray-500"} text-white`}
            >
              {campaign.status}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground">{campaign.id}</p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => generateMutation.mutate()}
            disabled={
              generateMutation.isPending || pendingAssets.length === 0
            }
          >
            {generateMutation.isPending ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <Zap className="w-4 h-4 mr-2" />
            )}
            Generate Assets ({pendingAssets.length})
          </Button>
          <Button
            variant="outline"
            onClick={() => qcMutation.mutate()}
            disabled={qcMutation.isPending || generatedAssets.length === 0}
          >
            {qcMutation.isPending ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <Shield className="w-4 h-4 mr-2" />
            )}
            Run QC
          </Button>
          <Button
            onClick={() => activateMutation.mutate()}
            disabled={
              activateMutation.isPending || campaign.qc_status !== "PASSED"
            }
          >
            <Play className="w-4 h-4 mr-2" /> Activate
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
        <Card className="p-3">
          <div className="text-xs text-muted-foreground">Cluster</div>
          <div className="font-semibold text-sm">{campaign.target_cluster}</div>
        </Card>
        <Card className="p-3">
          <div className="text-xs text-muted-foreground">Pipeline</div>
          <div className="font-semibold text-sm">
            {campaign.entry_stage} → {campaign.target_stage}
          </div>
        </Card>
        <Card className="p-3">
          <div className="text-xs text-muted-foreground">Duration</div>
          <div className="font-semibold text-sm">
            {campaign.duration_weeks} weeks
          </div>
        </Card>
        <Card className="p-3">
          <div className="text-xs text-muted-foreground">Assets</div>
          <div className="font-semibold text-sm">
            {campaign.assets_passed_qc}/{campaign.asset_count} passed
          </div>
        </Card>
        <Card className="p-3">
          <div className="text-xs text-muted-foreground">QC Status</div>
          <div className="font-semibold text-sm">{campaign.qc_status}</div>
        </Card>
        <Card className="p-3">
          <div className="text-xs text-muted-foreground">Daily Volume</div>
          <div className="font-semibold text-sm">
            {campaign.daily_volume || "—"}
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Card className="p-4">
          <h3 className="text-sm font-semibold mb-2">Channel Summary</h3>
          <div className="space-y-2">
            {Object.entries(channel_summary).map(
              ([channel, info]: [string, any]) => (
                <div
                  key={channel}
                  className="flex items-center justify-between text-sm"
                >
                  <span>{CHANNEL_LABELS[channel] || channel}</span>
                  <div className="flex gap-2">
                    <Badge variant="outline">{info.count} assets</Badge>
                    {Object.entries(info.statuses || {}).map(
                      ([status, count]: [string, any]) => (
                        <Badge
                          key={status}
                          className={`${STATUS_COLORS[status] || "bg-gray-500"} text-white text-xs`}
                        >
                          {count} {status.toLowerCase()}
                        </Badge>
                      )
                    )}
                  </div>
                </div>
              )
            )}
          </div>
        </Card>
        <Card className="p-4">
          <h3 className="text-sm font-semibold mb-2">Compliance</h3>
          <div className="space-y-2">
            <div>
              <div className="text-xs text-muted-foreground mb-1">
                Required ACUs
              </div>
              <div className="flex flex-wrap gap-1">
                {((campaign.compliance_constraints as string[]) || []).map(
                  (id: string) => (
                    <Badge key={id} variant="outline" className="text-xs">
                      {id}
                    </Badge>
                  )
                )}
                {((campaign.compliance_constraints as string[]) || [])
                  .length === 0 && (
                  <span className="text-xs text-muted-foreground">None</span>
                )}
              </div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground mb-1">
                Blocked Content
              </div>
              <div className="flex flex-wrap gap-1">
                {((campaign.blocked_content as string[]) || []).map(
                  (id: string) => (
                    <Badge
                      key={id}
                      variant="outline"
                      className="text-xs border-red-300 text-red-700"
                    >
                      {id}
                    </Badge>
                  )
                )}
                {((campaign.blocked_content as string[]) || []).length ===
                  0 && (
                  <span className="text-xs text-muted-foreground">None</span>
                )}
              </div>
            </div>
            {campaign.notes && (
              <div>
                <div className="text-xs text-muted-foreground mb-1">Notes</div>
                <div className="text-xs bg-muted p-2 rounded">
                  {campaign.notes}
                </div>
              </div>
            )}
          </div>
        </Card>
      </div>

      <div className="flex gap-1 border-b">
        {(
          [
            { key: "assets", label: "Assets", icon: FileText },
            { key: "sequence", label: "Sequence Map", icon: Zap },
            { key: "ac-build", label: "ActiveCampaign Build", icon: Download },
            { key: "tags", label: "Aircall Tags", icon: Shield },
          ] as const
        ).map((tab) => (
          <Button
            key={tab.key}
            variant={activeTab === tab.key ? "default" : "ghost"}
            size="sm"
            onClick={() => setActiveTab(tab.key)}
          >
            <tab.icon className="w-4 h-4 mr-1" />
            {tab.label}
          </Button>
        ))}
      </div>

      {activeTab === "assets" && (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8"></TableHead>
                <TableHead>Day</TableHead>
                <TableHead>Touchpoint</TableHead>
                <TableHead>Channel</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Words</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>QC</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {assets
                .sort((a: any, b: any) => a.day - b.day)
                .map((asset: any) => {
                  const isExpanded = expandedAsset === asset.id;
                  return (
                    <Fragment key={asset.id}>
                      <TableRow
                        className="cursor-pointer hover:bg-muted/50"
                        onClick={() =>
                          setExpandedAsset(isExpanded ? null : asset.id)
                        }
                      >
                        <TableCell>
                          {isExpanded ? (
                            <ChevronDown className="w-4 h-4 text-muted-foreground" />
                          ) : (
                            <ChevronRight className="w-4 h-4 text-muted-foreground" />
                          )}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline">Day {asset.day}</Badge>
                        </TableCell>
                        <TableCell className="font-medium">
                          {asset.title}
                        </TableCell>
                        <TableCell>
                          <Badge variant="secondary">
                            {CHANNEL_LABELS[asset.channel] || asset.channel}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {asset.output_type}
                        </TableCell>
                        <TableCell>{asset.word_count || "—"}</TableCell>
                        <TableCell>
                          <Badge
                            className={`${STATUS_COLORS[asset.status] || "bg-gray-500"} text-white`}
                          >
                            {asset.status}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <QCBadge status={asset.qc_status} />
                        </TableCell>
                      </TableRow>
                      {isExpanded && (
                        <TableRow>
                          <TableCell colSpan={8}>
                            <div className="p-4 bg-muted/30 rounded-lg space-y-3">
                              {asset.content ? (
                                <div>
                                  <div className="text-xs font-semibold text-muted-foreground mb-1">
                                    Content
                                  </div>
                                  <div className="text-sm bg-background p-3 rounded border whitespace-pre-wrap font-mono max-h-96 overflow-y-auto">
                                    {asset.content}
                                  </div>
                                </div>
                              ) : (
                                <div className="text-sm text-muted-foreground italic">
                                  Content not yet generated. Click "Generate
                                  Assets" to produce this touchpoint.
                                </div>
                              )}
                              {asset.qc_report &&
                                (asset.qc_report as any).violations?.length >
                                  0 && (
                                  <div>
                                    <div className="text-xs font-semibold text-red-600 mb-1">
                                      QC Violations
                                    </div>
                                    {(
                                      (asset.qc_report as any).violations || []
                                    ).map((v: any, i: number) => (
                                      <div
                                        key={i}
                                        className="text-xs bg-red-50 text-red-800 p-2 rounded border border-red-200 mb-1"
                                      >
                                        [{v.check}] {v.message}
                                      </div>
                                    ))}
                                  </div>
                                )}
                              <div className="grid grid-cols-3 gap-4 text-xs">
                                <div>
                                  <span className="font-semibold text-muted-foreground">
                                    Node:
                                  </span>{" "}
                                  {asset.node_id}
                                </div>
                                <div>
                                  <span className="font-semibold text-muted-foreground">
                                    Position:
                                  </span>{" "}
                                  {asset.sequence_position}
                                </div>
                                <div>
                                  <span className="font-semibold text-muted-foreground">
                                    Branch:
                                  </span>{" "}
                                  {asset.branch_condition || "—"}
                                </div>
                              </div>
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                    </Fragment>
                  );
                })}
            </TableBody>
          </Table>
        </Card>
      )}

      {activeTab === "sequence" && (
        <Card className="p-4">
          <h3 className="text-sm font-semibold mb-4">
            Sequence Map — {sequence.length} nodes
          </h3>
          <div className="relative">
            {sequence
              .sort((a: any, b: any) => a.day - b.day)
              .map((node: any, i: number) => (
                <div key={node.node_id} className="flex items-start gap-4 mb-4">
                  <div className="flex flex-col items-center">
                    <div className="w-10 h-10 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-sm font-bold">
                      D{node.day}
                    </div>
                    {i < sequence.length - 1 && (
                      <div className="w-0.5 h-8 bg-border mt-1" />
                    )}
                  </div>
                  <div className="flex-1 bg-muted/50 rounded-lg p-3">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-semibold text-sm">
                        {node.title}
                      </span>
                      <Badge variant="secondary" className="text-xs">
                        {CHANNEL_LABELS[node.channel] || node.channel}
                      </Badge>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {node.content_id}
                    </div>
                    {node.next_nodes?.length > 0 && (
                      <div className="mt-2 space-y-1">
                        {node.next_nodes.map((nn: any, j: number) => (
                          <div
                            key={j}
                            className="text-xs bg-background rounded px-2 py-1 border"
                          >
                            <span className="font-semibold">
                              {nn.condition}:
                            </span>{" "}
                            → {nn.node_id} (Day {nn.day})
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ))}
          </div>
        </Card>
      )}

      {activeTab === "ac-build" && acBuild && (
        <Card className="p-4">
          <h3 className="text-sm font-semibold mb-2">
            ActiveCampaign Build Instructions
          </h3>
          <div className="space-y-3 text-sm">
            <div className="grid grid-cols-3 gap-3">
              <div>
                <span className="text-xs text-muted-foreground">Platform</span>
                <div className="font-semibold">{acBuild.platform}</div>
              </div>
              <div>
                <span className="text-xs text-muted-foreground">
                  Entry Tag
                </span>
                <div className="font-mono text-xs">{acBuild.entry_tag}</div>
              </div>
              <div>
                <span className="text-xs text-muted-foreground">
                  Daily Limit
                </span>
                <div>{acBuild.daily_send_limit}</div>
              </div>
            </div>
            <div>
              <div className="text-xs font-semibold text-muted-foreground mb-2">
                Automations ({acBuild.automations?.length})
              </div>
              {acBuild.automations?.map((auto: any, i: number) => (
                <div
                  key={i}
                  className="bg-muted/50 rounded p-3 mb-2 border"
                >
                  <div className="font-semibold text-xs">
                    Step {auto.step}: {auto.email_name}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Trigger: {auto.trigger}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Content ID: {auto.content_id}
                  </div>
                </div>
              ))}
            </div>
            <div>
              <div className="text-xs font-semibold text-muted-foreground mb-1">
                Setup Notes
              </div>
              <ul className="text-xs space-y-1">
                {acBuild.notes?.map((note: string, i: number) => (
                  <li key={i} className="text-muted-foreground">
                    • {note}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </Card>
      )}

      {activeTab === "tags" && tagTable && (
        <Card className="p-4">
          <h3 className="text-sm font-semibold mb-2">
            Aircall Tag Trigger Table ({tagTable.tags?.length} tags)
          </h3>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Tag</TableHead>
                <TableHead>Day</TableHead>
                <TableHead>Title</TableHead>
                <TableHead>Trigger</TableHead>
                <TableHead>Outcomes</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tagTable.tags?.map((tag: any, i: number) => (
                <TableRow key={i}>
                  <TableCell className="font-mono text-xs">
                    {tag.aircall_tag}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">Day {tag.day}</Badge>
                  </TableCell>
                  <TableCell className="font-medium">{tag.title}</TableCell>
                  <TableCell className="text-xs">
                    {tag.trigger_action}
                  </TableCell>
                  <TableCell>
                    <div className="space-y-1">
                      {tag.post_call_actions?.map((a: any, j: number) => (
                        <div key={j} className="text-xs">
                          <span className="font-semibold">{a.outcome}:</span>{" "}
                          {a.action}
                        </div>
                      ))}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </div>
  );
}

function QCBadge({ status }: { status: string }) {
  if (status === "PASSED")
    return (
      <Badge className="bg-green-600 text-white">
        <CheckCircle2 className="w-3 h-3 mr-1" />
        Passed
      </Badge>
    );
  if (status === "FAILED")
    return (
      <Badge className="bg-red-600 text-white">
        <AlertTriangle className="w-3 h-3 mr-1" />
        Failed
      </Badge>
    );
  return (
    <Badge variant="outline">
      <Clock className="w-3 h-3 mr-1" />
      Pending
    </Badge>
  );
}
