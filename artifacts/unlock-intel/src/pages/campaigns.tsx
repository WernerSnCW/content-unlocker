import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useLocation } from "wouter";
import {
  Megaphone,
  Plus,
  Play,
  CheckCircle2,
  Clock,
  AlertTriangle,
  Target,
  Users,
  Mail,
  Phone,
  MessageSquare,
  MonitorSmartphone,
} from "lucide-react";

const API_BASE = "/api";

const STATUS_COLORS: Record<string, string> = {
  DRAFT: "bg-gray-500",
  GENERATING: "bg-blue-500",
  QC_PENDING: "bg-yellow-500",
  READY: "bg-green-500",
  ACTIVE: "bg-emerald-600",
  PAUSED: "bg-orange-500",
  COMPLETED: "bg-slate-600",
};

const CHANNEL_ICONS: Record<string, any> = {
  email: Mail,
  call: Phone,
  linkedin: MessageSquare,
  whatsapp: MessageSquare,
  meta: MonitorSmartphone,
  display: MonitorSmartphone,
};

export default function CampaignsPage() {
  const [, navigate] = useLocation();
  const [showCreate, setShowCreate] = useState(false);
  const queryClient = useQueryClient();

  const { data: campaigns = [], isLoading } = useQuery({
    queryKey: ["campaigns"],
    queryFn: async () => {
      const r = await fetch(`${API_BASE}/campaigns`);
      if (!r.ok) throw new Error(`Failed to load campaigns`);
      return r.json();
    },
  });

  const createMutation = useMutation({
    mutationFn: async (brief: any) => {
      const r = await fetch(`${API_BASE}/campaigns`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(brief),
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error(err.message || `Failed to create campaign`);
      }
      return r.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["campaigns"] });
      setShowCreate(false);
    },
  });

  const statusCounts = campaigns.reduce(
    (acc: Record<string, number>, c: any) => {
      acc[c.status] = (acc[c.status] || 0) + 1;
      return acc;
    },
    {}
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Megaphone className="w-8 h-8 text-primary" />
          <div>
            <h1 className="text-2xl font-bold">Campaign Intelligence</h1>
            <p className="text-sm text-muted-foreground">
              Multi-channel investor campaigns — plan, generate, QC, and
              activate from a single brief.
            </p>
          </div>
        </div>
        <Dialog open={showCreate} onOpenChange={setShowCreate}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="w-4 h-4 mr-2" /> New Campaign
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Create Campaign Brief</DialogTitle>
            </DialogHeader>
            <CampaignBriefForm
              onSubmit={(brief) => createMutation.mutate(brief)}
              isLoading={createMutation.isPending}
            />
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
        {[
          { label: "Total", count: campaigns.length, color: "text-blue-600" },
          {
            label: "Draft",
            count: statusCounts["DRAFT"] || 0,
            color: "text-gray-600",
          },
          {
            label: "Ready",
            count: statusCounts["READY"] || 0,
            color: "text-green-600",
          },
          {
            label: "Active",
            count: statusCounts["ACTIVE"] || 0,
            color: "text-emerald-600",
          },
          {
            label: "QC Pending",
            count: statusCounts["QC_PENDING"] || 0,
            color: "text-yellow-600",
          },
          {
            label: "Completed",
            count: statusCounts["COMPLETED"] || 0,
            color: "text-slate-600",
          },
        ].map((s) => (
          <Card key={s.label} className="p-4">
            <div className={`text-2xl font-bold ${s.color}`}>{s.count}</div>
            <div className="text-xs text-muted-foreground">{s.label}</div>
          </Card>
        ))}
      </div>

      {isLoading ? (
        <Card className="p-8 text-center text-muted-foreground">
          Loading campaigns...
        </Card>
      ) : campaigns.length === 0 ? (
        <Card className="p-8 text-center">
          <Megaphone className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
          <h3 className="text-lg font-semibold mb-2">No campaigns yet</h3>
          <p className="text-muted-foreground mb-4">
            Create your first campaign brief to generate a multi-channel
            investor outreach sequence.
          </p>
          <Button onClick={() => setShowCreate(true)}>
            <Plus className="w-4 h-4 mr-2" /> Create Campaign
          </Button>
        </Card>
      ) : (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Campaign</TableHead>
                <TableHead>Cluster</TableHead>
                <TableHead>Stage</TableHead>
                <TableHead>Channels</TableHead>
                <TableHead>Assets</TableHead>
                <TableHead>QC</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {campaigns.map((campaign: any) => (
                <TableRow
                  key={campaign.id}
                  className="cursor-pointer hover:bg-muted/50"
                  onClick={() => navigate(`/campaigns/${campaign.id}`)}
                >
                  <TableCell>
                    <div className="font-medium">{campaign.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {campaign.id}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">{campaign.target_cluster}</Badge>
                  </TableCell>
                  <TableCell>
                    <div className="text-xs">
                      {campaign.entry_stage} → {campaign.target_stage}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      {((campaign.channels as string[]) || []).map(
                        (ch: string) => {
                          const Icon = CHANNEL_ICONS[ch] || Target;
                          return (
                            <Icon
                              key={ch}
                              className="w-4 h-4 text-muted-foreground"
                              title={ch}
                            />
                          );
                        }
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <span className="text-sm">
                      {campaign.assets_passed_qc}/{campaign.asset_count}
                    </span>
                  </TableCell>
                  <TableCell>
                    <QCBadge status={campaign.qc_status} />
                  </TableCell>
                  <TableCell>
                    <Badge
                      className={`${STATUS_COLORS[campaign.status] || "bg-gray-500"} text-white`}
                    >
                      {campaign.status}
                    </Badge>
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

function CampaignBriefForm({
  onSubmit,
  isLoading,
}: {
  onSubmit: (brief: any) => void;
  isLoading: boolean;
}) {
  const [form, setForm] = useState({
    campaign_id: "",
    name: "",
    target_cluster: "",
    personas: "",
    entry_stage: "Outreach",
    target_stage: "Called",
    channels: ["email", "call"],
    duration_weeks: 8,
    daily_volume: 100,
    primary_belief: "",
    secondary_beliefs: "",
    primary_cta: "report_download",
    secondary_cta: "book_call",
    compliance_constraints: "acu_capital_at_risk,acu_tax_circumstances",
    blocked_content: "",
    notes: "",
  });

  const channelOptions = [
    "email",
    "call",
    "linkedin",
    "whatsapp",
    "meta",
    "display",
  ];

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({
      ...form,
      personas: form.personas
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
      secondary_beliefs: form.secondary_beliefs
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
      compliance_constraints: form.compliance_constraints
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
      blocked_content: form.blocked_content
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label>Campaign ID</Label>
          <Input
            placeholder="cam_growth_seeker_phase1"
            value={form.campaign_id}
            onChange={(e) =>
              setForm({ ...form, campaign_id: e.target.value })
            }
            required
          />
        </div>
        <div>
          <Label>Campaign Name</Label>
          <Input
            placeholder="Phase 1 — Growth Seeker Education"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            required
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label>Target Cluster</Label>
          <Input
            placeholder="Growth Builders"
            value={form.target_cluster}
            onChange={(e) =>
              setForm({ ...form, target_cluster: e.target.value })
            }
            required
          />
        </div>
        <div>
          <Label>Target Personas (comma-separated)</Label>
          <Input
            placeholder="P003, P006, P015"
            value={form.personas}
            onChange={(e) => setForm({ ...form, personas: e.target.value })}
          />
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div>
          <Label>Entry Stage</Label>
          <Select
            value={form.entry_stage}
            onValueChange={(v) => setForm({ ...form, entry_stage: v })}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {["Cold", "Outreach", "Called", "Engaged", "Qualified"].map(
                (s) => (
                  <SelectItem key={s} value={s}>
                    {s}
                  </SelectItem>
                )
              )}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Target Stage</Label>
          <Select
            value={form.target_stage}
            onValueChange={(v) => setForm({ ...form, target_stage: v })}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {["Outreach", "Called", "Engaged", "Qualified", "Meeting"].map(
                (s) => (
                  <SelectItem key={s} value={s}>
                    {s}
                  </SelectItem>
                )
              )}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Duration (weeks)</Label>
          <Input
            type="number"
            value={form.duration_weeks}
            onChange={(e) =>
              setForm({ ...form, duration_weeks: Number(e.target.value) })
            }
          />
        </div>
      </div>

      <div>
        <Label>Channels</Label>
        <div className="flex flex-wrap gap-2 mt-1">
          {channelOptions.map((ch) => (
            <Button
              key={ch}
              type="button"
              size="sm"
              variant={form.channels.includes(ch) ? "default" : "outline"}
              onClick={() => {
                const newChannels = form.channels.includes(ch)
                  ? form.channels.filter((c) => c !== ch)
                  : [...form.channels, ch];
                setForm({ ...form, channels: newChannels });
              }}
            >
              {ch}
            </Button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label>Primary Belief</Label>
          <Input
            placeholder="U1"
            value={form.primary_belief}
            onChange={(e) =>
              setForm({ ...form, primary_belief: e.target.value })
            }
          />
        </div>
        <div>
          <Label>Secondary Beliefs (comma-separated)</Label>
          <Input
            placeholder="U4, G1"
            value={form.secondary_beliefs}
            onChange={(e) =>
              setForm({ ...form, secondary_beliefs: e.target.value })
            }
          />
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div>
          <Label>Primary CTA</Label>
          <Input
            placeholder="report_download"
            value={form.primary_cta}
            onChange={(e) =>
              setForm({ ...form, primary_cta: e.target.value })
            }
          />
        </div>
        <div>
          <Label>Secondary CTA</Label>
          <Input
            placeholder="book_call"
            value={form.secondary_cta}
            onChange={(e) =>
              setForm({ ...form, secondary_cta: e.target.value })
            }
          />
        </div>
        <div>
          <Label>Daily Volume</Label>
          <Input
            type="number"
            value={form.daily_volume}
            onChange={(e) =>
              setForm({ ...form, daily_volume: Number(e.target.value) })
            }
          />
        </div>
      </div>

      <div>
        <Label>Compliance Constraints (ACU IDs, comma-separated)</Label>
        <Input
          placeholder="acu_capital_at_risk, acu_tax_circumstances"
          value={form.compliance_constraints}
          onChange={(e) =>
            setForm({ ...form, compliance_constraints: e.target.value })
          }
        />
      </div>

      <div>
        <Label>Blocked Content (ACU IDs, comma-separated)</Label>
        <Input
          placeholder="acu_jan_2027_structure"
          value={form.blocked_content}
          onChange={(e) =>
            setForm({ ...form, blocked_content: e.target.value })
          }
        />
      </div>

      <div>
        <Label>Notes</Label>
        <Textarea
          placeholder="Cold education only. No investment ask."
          value={form.notes}
          onChange={(e) => setForm({ ...form, notes: e.target.value })}
        />
      </div>

      <Button type="submit" className="w-full" disabled={isLoading}>
        {isLoading ? "Creating..." : "Create Campaign & Generate Sequence"}
      </Button>
    </form>
  );
}
