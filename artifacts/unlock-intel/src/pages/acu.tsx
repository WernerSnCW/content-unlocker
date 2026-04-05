import { useState, useMemo, Fragment } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Search,
  Shield,
  Lock,
  CheckCircle,
  AlertTriangle,
  Clock,
  Ban,
  ChevronDown,
  ChevronRight,
  RefreshCw,
  Plus,
  Eye,
  Zap,
  AlertOctagon,
  ListChecks,
  Grid3X3,
  Loader2,
  XCircle,
  Pause,
  Copy,
  ThumbsUp,
  ThumbsDown,
  FileText,
  BookOpen,
  Star,
} from "lucide-react";

const API_BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";

async function fetchTemplates() {
  const res = await fetch(`${API_BASE}api/templates`);
  if (!res.ok) throw new Error("Failed to fetch templates");
  return res.json();
}

async function fetchTemplate(id: string) {
  const res = await fetch(`${API_BASE}api/templates/${id}`);
  if (!res.ok) throw new Error("Failed to fetch template");
  return res.json();
}

async function fetchPrompts() {
  const res = await fetch(`${API_BASE}api/prompts`);
  if (!res.ok) throw new Error("Failed to fetch prompts");
  return res.json();
}

async function fetchACUs(status?: string, type?: string) {
  const params = new URLSearchParams();
  if (status && status !== "all") params.set("status", status);
  if (type && type !== "all") params.set("type", type);
  const res = await fetch(`${API_BASE}api/acu?${params.toString()}`);
  if (!res.ok) throw new Error("Failed to fetch ACUs");
  return res.json();
}

async function approveACU(id: string, approved_by: string) {
  const res = await fetch(`${API_BASE}api/acu/${id}/approve`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ approved_by }),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || "Approve failed");
  }
  return res.json();
}

async function lockACU(id: string) {
  const res = await fetch(`${API_BASE}api/acu/${id}/lock`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || "Lock failed");
  }
  return res.json();
}

async function cascadeACU(id: string) {
  const res = await fetch(`${API_BASE}api/acu/${id}/cascade`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || "Cascade failed");
  }
  return res.json();
}

async function createNewVersion(id: string) {
  const res = await fetch(`${API_BASE}api/acu/${id}/version`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || "Version failed");
  }
  return res.json();
}

async function fetchBacklog(params?: { importance?: string; type?: string; status?: string }) {
  const p = new URLSearchParams();
  if (params?.importance) p.set("importance", params.importance);
  if (params?.type) p.set("type", params.type);
  if (params?.status) p.set("status", params.status);
  const res = await fetch(`${API_BASE}api/acu/backlog?${p.toString()}`);
  if (!res.ok) throw new Error("Failed to fetch backlog");
  return res.json();
}

async function fetchContradictions() {
  const res = await fetch(`${API_BASE}api/acu/backlog/contradictions`);
  if (!res.ok) throw new Error("Failed to fetch contradictions");
  return res.json();
}

async function fetchCoverage() {
  const res = await fetch(`${API_BASE}api/acu/coverage`);
  if (!res.ok) throw new Error("Failed to fetch coverage");
  return res.json();
}

async function triggerScan() {
  const res = await fetch(`${API_BASE}api/acu/scan`, { method: "POST" });
  if (!res.ok) throw new Error("Scan failed");
  return res.json();
}

async function backlogAction(id: string, action: string, body?: any) {
  const res = await fetch(`${API_BASE}api/acu/backlog/${id}/${action}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body || {}),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || `${action} failed`);
  }
  return res.json();
}

async function resolveContradiction(id: string, resolution: string) {
  const res = await fetch(`${API_BASE}api/acu/contradictions/${id}/resolve`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ resolution, resolved_by: "tom_king" }),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || "Resolve failed");
  }
  return res.json();
}

function getStatusBadge(status: string) {
  switch (status) {
    case "LOCKED":
      return <Badge className="bg-green-600 hover:bg-green-700 text-white"><Lock className="w-3 h-3 mr-1" />Locked</Badge>;
    case "APPROVED":
      return <Badge className="bg-blue-600 hover:bg-blue-700 text-white"><CheckCircle className="w-3 h-3 mr-1" />Approved</Badge>;
    case "DRAFT":
      return <Badge variant="outline" className="border-amber-300 text-amber-700 bg-amber-50"><Clock className="w-3 h-3 mr-1" />Draft</Badge>;
    case "LEGAL_PENDING":
      return <Badge className="bg-purple-600 hover:bg-purple-700 text-white"><AlertTriangle className="w-3 h-3 mr-1" />Legal Pending</Badge>;
    case "NAMING_PENDING":
      return <Badge className="bg-orange-600 hover:bg-orange-700 text-white"><AlertTriangle className="w-3 h-3 mr-1" />Naming Pending</Badge>;
    case "SUPERSEDED":
      return <Badge variant="outline" className="border-gray-300 text-gray-500 bg-gray-50">Superseded</Badge>;
    default:
      return <Badge variant="outline">{status}</Badge>;
  }
}

function getTypeBadge(type: string) {
  const colors: Record<string, string> = {
    fact: "bg-blue-100 text-blue-800 border-blue-200",
    framing: "bg-indigo-100 text-indigo-800 border-indigo-200",
    reference: "bg-cyan-100 text-cyan-800 border-cyan-200",
    explanation: "bg-teal-100 text-teal-800 border-teal-200",
    qualifier: "bg-amber-100 text-amber-800 border-amber-200",
    prohibited: "bg-red-100 text-red-800 border-red-200",
  };
  return (
    <Badge variant="outline" className={colors[type] || ""}>
      {type === "prohibited" && <Ban className="w-3 h-3 mr-1" />}
      {type}
    </Badge>
  );
}

function getSeverityBadge(severity: string) {
  switch (severity) {
    case "CRITICAL":
      return <Badge className="bg-red-600 text-white">CRITICAL</Badge>;
    case "HIGH":
      return <Badge className="bg-orange-600 text-white">HIGH</Badge>;
    case "MEDIUM":
      return <Badge className="bg-yellow-600 text-white">MEDIUM</Badge>;
    case "LOW":
      return <Badge variant="outline" className="border-gray-300 text-gray-600">LOW</Badge>;
    default:
      return <Badge variant="outline">{severity}</Badge>;
  }
}

function getImportanceBadge(level: number, label: string) {
  switch (level) {
    case 1:
      return <Badge className="bg-red-600 text-white text-xs">{label}</Badge>;
    case 2:
      return <Badge className="bg-orange-600 text-white text-xs">{label}</Badge>;
    case 3:
      return <Badge className="bg-blue-600 text-white text-xs">{label}</Badge>;
    case 4:
      return <Badge variant="outline" className="text-xs border-gray-300">{label}</Badge>;
    default:
      return <Badge variant="outline" className="text-xs">{label || `Level ${level}`}</Badge>;
  }
}

function getCoverageStatusDot(status: string) {
  switch (status) {
    case "COVERED":
      return <div className="w-4 h-4 rounded-full bg-green-500" title="Covered by locked ACUs" />;
    case "CANDIDATE":
      return <div className="w-4 h-4 rounded-full bg-yellow-500" title="Has candidate ACUs" />;
    case "CONFLICT":
      return <div className="w-4 h-4 rounded-full bg-red-500 animate-pulse" title="Has unresolved contradictions" />;
    case "GAP":
      return <div className="w-4 h-4 rounded-full bg-gray-300" title="No coverage" />;
    default:
      return <div className="w-4 h-4 rounded-full bg-gray-200" />;
  }
}

export default function ACUPage() {
  const [activeTab, setActiveTab] = useState<"units" | "intelligence" | "templates" | "prompts">("units");
  const [statusFilter, setStatusFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showLockModal, setShowLockModal] = useState<string | null>(null);
  const [backlogImportance, setBacklogImportance] = useState("all");
  const [backlogType, setBacklogType] = useState("all");
  const [expandedCandidate, setExpandedCandidate] = useState<string | null>(null);
  const [resolveId, setResolveId] = useState<string | null>(null);
  const [resolveText, setResolveText] = useState("");
  const [expandedTemplate, setExpandedTemplate] = useState<string | null>(null);
  const [expandedPrompt, setExpandedPrompt] = useState<string | null>(null);

  const queryClient = useQueryClient();

  const { data: acus, isLoading } = useQuery({
    queryKey: ["acus", statusFilter, typeFilter],
    queryFn: () => fetchACUs(statusFilter, typeFilter),
  });

  const { data: backlogData, isLoading: backlogLoading } = useQuery({
    queryKey: ["acu-backlog", backlogImportance, backlogType],
    queryFn: () => fetchBacklog({
      importance: backlogImportance !== "all" ? backlogImportance : undefined,
      type: backlogType !== "all" ? backlogType : undefined,
    }),
    enabled: activeTab === "intelligence",
  });

  const { data: contradictionData, isLoading: contradictionsLoading } = useQuery({
    queryKey: ["acu-contradictions"],
    queryFn: fetchContradictions,
    enabled: activeTab === "intelligence",
  });

  const { data: coverageData, isLoading: coverageLoading } = useQuery({
    queryKey: ["acu-coverage"],
    queryFn: fetchCoverage,
    enabled: activeTab === "intelligence",
  });

  const { data: templatesData, isLoading: templatesLoading } = useQuery({
    queryKey: ["templates"],
    queryFn: fetchTemplates,
    enabled: activeTab === "templates",
  });

  const { data: templateDetail } = useQuery({
    queryKey: ["template-detail", expandedTemplate],
    queryFn: () => fetchTemplate(expandedTemplate!),
    enabled: !!expandedTemplate,
  });

  const { data: promptsData, isLoading: promptsLoading } = useQuery({
    queryKey: ["prompts"],
    queryFn: fetchPrompts,
    enabled: activeTab === "prompts",
  });

  const approveMutation = useMutation({
    mutationFn: (id: string) => approveACU(id, "tom_king"),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["acus"] }),
  });

  const lockMutation = useMutation({
    mutationFn: (id: string) => lockACU(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["acus"] });
      setShowLockModal(null);
    },
  });

  const cascadeMutation = useMutation({
    mutationFn: (id: string) => cascadeACU(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["acus"] }),
  });

  const versionMutation = useMutation({
    mutationFn: (id: string) => createNewVersion(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["acus"] }),
  });

  const scanMutation = useMutation({
    mutationFn: triggerScan,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["acu-backlog"] });
      queryClient.invalidateQueries({ queryKey: ["acu-contradictions"] });
      queryClient.invalidateQueries({ queryKey: ["acu-coverage"] });
    },
  });

  const backlogApproveMutation = useMutation({
    mutationFn: ({ id, lock }: { id: string; lock: boolean }) =>
      backlogAction(id, "approve", { lock_immediately: lock, approved_by: "tom_king" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["acu-backlog"] });
      queryClient.invalidateQueries({ queryKey: ["acus"] });
    },
  });

  const backlogRejectMutation = useMutation({
    mutationFn: (id: string) => backlogAction(id, "reject", { rejected_by: "tom_king" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["acu-backlog"] }),
  });

  const backlogDeferMutation = useMutation({
    mutationFn: (id: string) => backlogAction(id, "defer"),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["acu-backlog"] }),
  });

  const backlogDuplicateMutation = useMutation({
    mutationFn: (id: string) => backlogAction(id, "duplicate"),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["acu-backlog"] }),
  });

  const contradictionResolveMutation = useMutation({
    mutationFn: ({ id, resolution }: { id: string; resolution: string }) => resolveContradiction(id, resolution),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["acu-contradictions"] });
      setResolveId(null);
      setResolveText("");
    },
  });

  const filtered = useMemo(() => {
    if (!acus) return [];
    if (!search.trim()) return acus;
    const q = search.toLowerCase();
    return acus.filter((a: any) =>
      a.id.toLowerCase().includes(q) ||
      a.content.toLowerCase().includes(q) ||
      (a.source || "").toLowerCase().includes(q) ||
      (a.notes || "").toLowerCase().includes(q)
    );
  }, [acus, search]);

  const stats = useMemo(() => {
    if (!acus) return { locked: 0, approved: 0, draft: 0, legal: 0, naming: 0, prohibited: 0, total: 0 };
    return {
      locked: acus.filter((a: any) => a.status === "LOCKED" && a.type !== "prohibited").length,
      approved: acus.filter((a: any) => a.status === "APPROVED").length,
      draft: acus.filter((a: any) => a.status === "DRAFT").length,
      legal: acus.filter((a: any) => a.status === "LEGAL_PENDING").length,
      naming: acus.filter((a: any) => a.status === "NAMING_PENDING").length,
      prohibited: acus.filter((a: any) => a.type === "prohibited").length,
      total: acus.length,
    };
  }, [acus]);

  const lockTarget = acus?.find((a: any) => a.id === showLockModal);
  const lockRefCount = lockTarget ? ((lockTarget.documents_referencing as any[]) || []).length : 0;

  return (
    <div className="flex-1 overflow-auto p-8">
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
              <Shield className="w-6 h-6 text-green-600" />
              Approved Content Units
            </h1>
            <p className="text-muted-foreground mt-1">
              Locked facts, framings, references, and qualifiers. Compliance is architectural, not instructional.
            </p>
          </div>
        </div>

        <div className="flex border-b border-border">
          <button
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === "units"
                ? "border-green-600 text-green-600"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
            onClick={() => setActiveTab("units")}
          >
            <Shield className="w-4 h-4 inline mr-1.5" />
            Content Units
          </button>
          <button
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === "intelligence"
                ? "border-green-600 text-green-600"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
            onClick={() => setActiveTab("intelligence")}
          >
            <Zap className="w-4 h-4 inline mr-1.5" />
            Intelligence
            {contradictionData?.unresolved > 0 && (
              <Badge className="ml-2 bg-red-600 text-white text-xs px-1.5 py-0">{contradictionData.unresolved}</Badge>
            )}
          </button>
          <button
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === "templates"
                ? "border-green-600 text-green-600"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
            onClick={() => setActiveTab("templates")}
          >
            <FileText className="w-4 h-4 inline mr-1.5" />
            Templates
            {templatesData && (
              <Badge className="ml-2 bg-slate-600 text-white text-xs px-1.5 py-0">{templatesData.length}</Badge>
            )}
          </button>
          <button
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === "prompts"
                ? "border-green-600 text-green-600"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
            onClick={() => setActiveTab("prompts")}
          >
            <BookOpen className="w-4 h-4 inline mr-1.5" />
            Prompts
          </button>
        </div>

        {activeTab === "units" && (
          <>
            <div className="grid grid-cols-6 gap-4">
              <Card>
                <CardContent className="pt-4 pb-3 px-4">
                  <div className="text-2xl font-bold text-green-600">{stats.locked}</div>
                  <div className="text-xs text-muted-foreground">Locked</div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4 pb-3 px-4">
                  <div className="text-2xl font-bold text-blue-600">{stats.approved}</div>
                  <div className="text-xs text-muted-foreground">Approved</div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4 pb-3 px-4">
                  <div className="text-2xl font-bold text-amber-600">{stats.draft}</div>
                  <div className="text-xs text-muted-foreground">Draft</div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4 pb-3 px-4">
                  <div className="text-2xl font-bold text-purple-600">{stats.legal}</div>
                  <div className="text-xs text-muted-foreground">Legal Pending</div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4 pb-3 px-4">
                  <div className="text-2xl font-bold text-orange-600">{stats.naming}</div>
                  <div className="text-xs text-muted-foreground">Naming Pending</div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4 pb-3 px-4">
                  <div className="text-2xl font-bold text-red-600">{stats.prohibited}</div>
                  <div className="text-xs text-muted-foreground">Prohibited</div>
                </CardContent>
              </Card>
            </div>

            <div className="flex items-center gap-4">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  placeholder="Search ACUs..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-9"
                />
              </div>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-44">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Statuses</SelectItem>
                  <SelectItem value="LOCKED">Locked</SelectItem>
                  <SelectItem value="APPROVED">Approved</SelectItem>
                  <SelectItem value="DRAFT">Draft</SelectItem>
                  <SelectItem value="LEGAL_PENDING">Legal Pending</SelectItem>
                  <SelectItem value="NAMING_PENDING">Naming Pending</SelectItem>
                  <SelectItem value="SUPERSEDED">Superseded</SelectItem>
                </SelectContent>
              </Select>
              <Select value={typeFilter} onValueChange={setTypeFilter}>
                <SelectTrigger className="w-44">
                  <SelectValue placeholder="Type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Types</SelectItem>
                  <SelectItem value="fact">Fact</SelectItem>
                  <SelectItem value="framing">Framing</SelectItem>
                  <SelectItem value="reference">Reference</SelectItem>
                  <SelectItem value="explanation">Explanation</SelectItem>
                  <SelectItem value="qualifier">Qualifier</SelectItem>
                  <SelectItem value="prohibited">Prohibited</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {isLoading ? (
              <div className="text-center py-12 text-muted-foreground">Loading ACUs...</div>
            ) : (
              <Card>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-8"></TableHead>
                      <TableHead>ID</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Source</TableHead>
                      <TableHead>Approved By</TableHead>
                      <TableHead className="text-center">Docs</TableHead>
                      <TableHead>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered.map((acu: any) => {
                      const isExpanded = expandedId === acu.id;
                      const docRefs = (acu.documents_referencing as any[]) || [];
                      return (
                        <Fragment key={acu.id}>
                          <TableRow
                            className="cursor-pointer hover:bg-muted/50"
                            onClick={() => setExpandedId(isExpanded ? null : acu.id)}
                          >
                            <TableCell>
                              {isExpanded ? (
                                <ChevronDown className="w-4 h-4 text-muted-foreground" />
                              ) : (
                                <ChevronRight className="w-4 h-4 text-muted-foreground" />
                              )}
                            </TableCell>
                            <TableCell className="font-mono text-xs">{acu.id}</TableCell>
                            <TableCell>{getTypeBadge(acu.type)}</TableCell>
                            <TableCell>{getStatusBadge(acu.status)}</TableCell>
                            <TableCell className="max-w-48 truncate text-xs text-muted-foreground">{acu.source || "\u2014"}</TableCell>
                            <TableCell className="text-xs">{acu.approved_by || "\u2014"}</TableCell>
                            <TableCell className="text-center">
                              <Badge variant="outline" className="text-xs">{docRefs.length}</Badge>
                            </TableCell>
                            <TableCell onClick={(e) => e.stopPropagation()}>
                              <div className="flex items-center gap-1">
                                {acu.status === "DRAFT" && (
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="h-7 text-xs"
                                    disabled={!acu.source || approveMutation.isPending}
                                    onClick={() => approveMutation.mutate(acu.id)}
                                    title={!acu.source ? "Source required before approval" : "Approve"}
                                  >
                                    <CheckCircle className="w-3 h-3 mr-1" />
                                    Approve
                                  </Button>
                                )}
                                {acu.status === "APPROVED" && (
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="h-7 text-xs border-green-300 text-green-700 hover:bg-green-50"
                                    onClick={() => setShowLockModal(acu.id)}
                                  >
                                    <Lock className="w-3 h-3 mr-1" />
                                    Lock
                                  </Button>
                                )}
                                {acu.status === "LOCKED" && acu.type !== "prohibited" && (
                                  <>
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      className="h-7 text-xs"
                                      disabled={versionMutation.isPending}
                                      onClick={() => versionMutation.mutate(acu.id)}
                                    >
                                      <Plus className="w-3 h-3 mr-1" />
                                      New Version
                                    </Button>
                                    {docRefs.length > 0 && (
                                      <Button
                                        size="sm"
                                        variant="outline"
                                        className="h-7 text-xs border-orange-300 text-orange-700 hover:bg-orange-50"
                                        disabled={cascadeMutation.isPending}
                                        onClick={() => cascadeMutation.mutate(acu.id)}
                                      >
                                        <RefreshCw className="w-3 h-3 mr-1" />
                                        Cascade
                                      </Button>
                                    )}
                                  </>
                                )}
                                {(acu.status === "LEGAL_PENDING" || acu.status === "NAMING_PENDING") && (
                                  <span className="text-xs text-muted-foreground flex items-center gap-1">
                                    <Eye className="w-3 h-3" /> View only
                                  </span>
                                )}
                              </div>
                            </TableCell>
                          </TableRow>
                          {isExpanded && (
                            <TableRow key={`${acu.id}-detail`}>
                              <TableCell colSpan={8}>
                                <div className="p-4 bg-muted/30 rounded-lg space-y-3">
                                  <div>
                                    <div className="text-xs font-semibold text-muted-foreground mb-1">Content</div>
                                    <div className="text-sm bg-background p-3 rounded border font-mono whitespace-pre-wrap">
                                      {acu.content}
                                    </div>
                                  </div>
                                  {acu.notes && (
                                    <div>
                                      <div className="text-xs font-semibold text-muted-foreground mb-1">Notes</div>
                                      <div className="text-sm text-orange-700 bg-orange-50 p-2 rounded border border-orange-200">
                                        {acu.notes}
                                      </div>
                                    </div>
                                  )}
                                  <div className="grid grid-cols-4 gap-4 text-xs">
                                    <div>
                                      <span className="font-semibold text-muted-foreground">Version:</span>{" "}
                                      {acu.version}
                                    </div>
                                    <div>
                                      <span className="font-semibold text-muted-foreground">Approved Date:</span>{" "}
                                      {acu.approved_date || "\u2014"}
                                    </div>
                                    <div>
                                      <span className="font-semibold text-muted-foreground">Cascade on Change:</span>{" "}
                                      {acu.cascade_on_change ? "Yes" : "No"}
                                    </div>
                                    <div>
                                      <span className="font-semibold text-muted-foreground">Documents:</span>{" "}
                                      {docRefs.length > 0 ? docRefs.join(", ") : "None"}
                                    </div>
                                  </div>
                                  {(acu.expression_variants as any[])?.length > 0 && (
                                    <div>
                                      <div className="text-xs font-semibold text-muted-foreground mb-1">Expression Variants</div>
                                      <div className="space-y-1">
                                        {(acu.expression_variants as any[]).map((v: any, i: number) => (
                                          <div key={i} className="text-xs bg-background p-2 rounded border">
                                            <span className="font-semibold">{v.audience} / {v.stage}:</span> {v.text}
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                  )}
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
          </>
        )}

        {activeTab === "intelligence" && (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="grid grid-cols-4 gap-3">
                  <Card className="bg-muted/30">
                    <CardContent className="pt-3 pb-2 px-3">
                      <div className="text-lg font-bold text-red-600">{contradictionData?.unresolved || 0}</div>
                      <div className="text-xs text-muted-foreground">Contradictions</div>
                    </CardContent>
                  </Card>
                  <Card className="bg-muted/30">
                    <CardContent className="pt-3 pb-2 px-3">
                      <div className="text-lg font-bold text-amber-600">{backlogData?.summary?.total || 0}</div>
                      <div className="text-xs text-muted-foreground">Pending Review</div>
                    </CardContent>
                  </Card>
                  <Card className="bg-muted/30">
                    <CardContent className="pt-3 pb-2 px-3">
                      <div className="text-lg font-bold text-green-600">{coverageData?.covered || 0}</div>
                      <div className="text-xs text-muted-foreground">Beliefs Covered</div>
                    </CardContent>
                  </Card>
                  <Card className="bg-muted/30">
                    <CardContent className="pt-3 pb-2 px-3">
                      <div className="text-lg font-bold text-gray-400">{coverageData?.gaps || 0}</div>
                      <div className="text-xs text-muted-foreground">Gaps</div>
                    </CardContent>
                  </Card>
                </div>
              </div>
              <Button
                onClick={() => scanMutation.mutate()}
                disabled={scanMutation.isPending}
                className="bg-green-600 hover:bg-green-700 text-white"
              >
                {scanMutation.isPending ? (
                  <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Scanning...</>
                ) : (
                  <><Zap className="w-4 h-4 mr-2" />Run Intelligence Scan</>
                )}
              </Button>
            </div>

            {scanMutation.isSuccess && (
              <Card className="border-green-200 bg-green-50">
                <CardContent className="py-3 px-4">
                  <div className="flex items-center gap-2 text-sm text-green-800">
                    <CheckCircle className="w-4 h-4" />
                    Scan complete: {(scanMutation.data as any)?.candidates_found || 0} candidates found,
                    {" "}{(scanMutation.data as any)?.new_contradictions || 0} new contradictions detected.
                    Took {((scanMutation.data as any)?.scan_duration_ms / 1000).toFixed(1)}s.
                  </div>
                </CardContent>
              </Card>
            )}

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <AlertOctagon className="w-4 h-4 text-red-600" />
                  Contradictions
                  {contradictionData?.unresolved > 0 && (
                    <Badge className="bg-red-600 text-white text-xs">{contradictionData.unresolved} unresolved</Badge>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent>
                {contradictionsLoading ? (
                  <div className="text-sm text-muted-foreground py-4 text-center">Loading...</div>
                ) : contradictionData?.contradictions?.length === 0 ? (
                  <div className="text-sm text-muted-foreground py-4 text-center">
                    No contradictions detected. Run an intelligence scan to check.
                  </div>
                ) : (
                  <div className="space-y-3">
                    {contradictionData?.contradictions?.map((c: any) => (
                      <div key={c.id} className={`border rounded-lg p-4 ${c.status === "RESOLVED" ? "opacity-50" : ""}`}>
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-2">
                            {getSeverityBadge(c.severity)}
                            <span className="text-xs font-mono text-muted-foreground">{c.id}</span>
                          </div>
                          {c.status === "UNRESOLVED" && resolveId !== c.id && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 text-xs"
                              onClick={() => setResolveId(c.id)}
                            >
                              Resolve
                            </Button>
                          )}
                          {c.status === "RESOLVED" && (
                            <Badge variant="outline" className="text-xs text-green-600 border-green-300">Resolved</Badge>
                          )}
                        </div>
                        <div className="grid grid-cols-2 gap-3 mb-2">
                          <div className="bg-muted/50 p-2 rounded text-xs">
                            <div className="font-mono text-muted-foreground mb-1">{c.unit_a_id}</div>
                            <div>{c.unit_a_content}</div>
                          </div>
                          <div className="bg-muted/50 p-2 rounded text-xs">
                            <div className="font-mono text-muted-foreground mb-1">{c.unit_b_id}</div>
                            <div>{c.unit_b_content}</div>
                          </div>
                        </div>
                        <div className="text-xs text-muted-foreground">{c.conflict_description}</div>
                        {c.resolution && (
                          <div className="text-xs text-green-700 bg-green-50 p-2 rounded mt-2 border border-green-200">
                            Resolution: {c.resolution} (by {c.resolved_by})
                          </div>
                        )}
                        {resolveId === c.id && (
                          <div className="mt-3 flex gap-2">
                            <Input
                              value={resolveText}
                              onChange={(e) => setResolveText(e.target.value)}
                              placeholder="Resolution notes..."
                              className="text-xs h-8"
                            />
                            <Button
                              size="sm"
                              className="h-8 text-xs bg-green-600 hover:bg-green-700 text-white"
                              disabled={contradictionResolveMutation.isPending || !resolveText.trim()}
                              onClick={() => contradictionResolveMutation.mutate({ id: c.id, resolution: resolveText })}
                            >
                              Confirm
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-8 text-xs"
                              onClick={() => { setResolveId(null); setResolveText(""); }}
                            >
                              Cancel
                            </Button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base flex items-center gap-2">
                    <ListChecks className="w-4 h-4 text-amber-600" />
                    Review Backlog
                    {backlogData?.summary?.total > 0 && (
                      <Badge className="bg-amber-600 text-white text-xs">{backlogData.summary.total}</Badge>
                    )}
                  </CardTitle>
                  <div className="flex items-center gap-2">
                    <Select value={backlogImportance} onValueChange={setBacklogImportance}>
                      <SelectTrigger className="w-36 h-8 text-xs">
                        <SelectValue placeholder="Importance" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Levels</SelectItem>
                        <SelectItem value="1">Foundational</SelectItem>
                        <SelectItem value="2">Structural</SelectItem>
                        <SelectItem value="3">Supporting</SelectItem>
                        <SelectItem value="4">Contextual</SelectItem>
                      </SelectContent>
                    </Select>
                    <Select value={backlogType} onValueChange={setBacklogType}>
                      <SelectTrigger className="w-32 h-8 text-xs">
                        <SelectValue placeholder="Type" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Types</SelectItem>
                        <SelectItem value="fact">Fact</SelectItem>
                        <SelectItem value="framing">Framing</SelectItem>
                        <SelectItem value="reference">Reference</SelectItem>
                        <SelectItem value="qualifier">Qualifier</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {backlogLoading ? (
                  <div className="text-sm text-muted-foreground py-4 text-center">Loading...</div>
                ) : backlogData?.candidates?.length === 0 ? (
                  <div className="text-sm text-muted-foreground py-4 text-center">
                    No candidates pending review. Run an intelligence scan to discover new content units.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {backlogData?.candidates?.map((c: any) => {
                      const isExp = expandedCandidate === c.id;
                      return (
                        <div key={c.id} className="border rounded-lg">
                          <div
                            className="flex items-center gap-3 p-3 cursor-pointer hover:bg-muted/30"
                            onClick={() => setExpandedCandidate(isExp ? null : c.id)}
                          >
                            {isExp ? <ChevronDown className="w-4 h-4 text-muted-foreground flex-shrink-0" /> : <ChevronRight className="w-4 h-4 text-muted-foreground flex-shrink-0" />}
                            {getImportanceBadge(c.importance_level, c.importance_label)}
                            {getTypeBadge(c.type)}
                            <span className="text-sm flex-1 truncate">{c.content}</span>
                            <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-6 text-xs border-green-300 text-green-700 hover:bg-green-50 px-2"
                                disabled={backlogApproveMutation.isPending}
                                onClick={() => backlogApproveMutation.mutate({ id: c.id, lock: false })}
                                title="Approve as ACU"
                              >
                                <ThumbsUp className="w-3 h-3" />
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-6 text-xs border-green-500 text-green-800 hover:bg-green-100 px-2"
                                disabled={backlogApproveMutation.isPending}
                                onClick={() => backlogApproveMutation.mutate({ id: c.id, lock: true })}
                                title="Approve & Lock"
                              >
                                <Lock className="w-3 h-3" />
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-6 text-xs border-red-300 text-red-700 hover:bg-red-50 px-2"
                                disabled={backlogRejectMutation.isPending}
                                onClick={() => backlogRejectMutation.mutate(c.id)}
                                title="Reject"
                              >
                                <ThumbsDown className="w-3 h-3" />
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-6 text-xs px-2"
                                disabled={backlogDeferMutation.isPending}
                                onClick={() => backlogDeferMutation.mutate(c.id)}
                                title="Defer"
                              >
                                <Pause className="w-3 h-3" />
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-6 text-xs px-2"
                                disabled={backlogDuplicateMutation.isPending}
                                onClick={() => backlogDuplicateMutation.mutate(c.id)}
                                title="Mark as duplicate"
                              >
                                <Copy className="w-3 h-3" />
                              </Button>
                            </div>
                          </div>
                          {isExp && (
                            <div className="px-4 pb-3 space-y-2 border-t bg-muted/20">
                              <div className="grid grid-cols-3 gap-3 pt-3 text-xs">
                                <div>
                                  <span className="font-semibold text-muted-foreground">Source Document:</span>{" "}
                                  <span className="font-mono">{c.source_document_id}</span>
                                </div>
                                <div>
                                  <span className="font-semibold text-muted-foreground">Source Context:</span>{" "}
                                  {c.source_context}
                                </div>
                                <div>
                                  <span className="font-semibold text-muted-foreground">Scanned:</span>{" "}
                                  {c.scan_date}
                                </div>
                              </div>
                              <div className="text-xs">
                                <span className="font-semibold text-muted-foreground">Importance Rationale:</span>{" "}
                                {c.importance_rationale}
                              </div>
                              <div className="text-sm bg-background p-3 rounded border font-mono whitespace-pre-wrap">
                                {c.content}
                              </div>
                              {c.existing_acu_id && (
                                <div className="text-xs text-amber-700 bg-amber-50 p-2 rounded border border-amber-200">
                                  Potential duplicate of existing ACU: <span className="font-mono">{c.existing_acu_id}</span>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Grid3X3 className="w-4 h-4 text-blue-600" />
                  Belief Coverage Map
                </CardTitle>
              </CardHeader>
              <CardContent>
                {coverageLoading ? (
                  <div className="text-sm text-muted-foreground py-4 text-center">Loading...</div>
                ) : (
                  <div className="space-y-4">
                    <div className="flex items-center gap-6 text-xs text-muted-foreground">
                      <div className="flex items-center gap-1.5"><div className="w-3 h-3 rounded-full bg-green-500" /> Covered</div>
                      <div className="flex items-center gap-1.5"><div className="w-3 h-3 rounded-full bg-yellow-500" /> Has Candidates</div>
                      <div className="flex items-center gap-1.5"><div className="w-3 h-3 rounded-full bg-red-500" /> Conflict</div>
                      <div className="flex items-center gap-1.5"><div className="w-3 h-3 rounded-full bg-gray-300" /> Gap</div>
                    </div>
                    <div className="grid grid-cols-4 gap-6">
                      {["U", "G", "P", "L", "F"].map(prefix => {
                        const group = coverageData?.coverage?.filter((c: any) => c.belief.startsWith(prefix)) || [];
                        const groupLabels: Record<string, string> = {
                          U: "Unlock Beliefs", G: "Growth Beliefs", P: "Portfolio Beliefs",
                          L: "Lifecycle Beliefs", F: "Fee Beliefs",
                        };
                        return (
                          <div key={prefix}>
                            <div className="text-xs font-semibold text-muted-foreground mb-2">{groupLabels[prefix]}</div>
                            <div className="space-y-1.5">
                              {group.map((b: any) => (
                                <div key={b.belief} className="flex items-center gap-2">
                                  {getCoverageStatusDot(b.status)}
                                  <span className="text-xs font-mono font-semibold w-6">{b.belief}</span>
                                  <span className="text-xs text-muted-foreground">
                                    {b.locked_acus > 0 && `${b.locked_acus} ACU${b.locked_acus > 1 ? "s" : ""}`}
                                    {b.candidates > 0 && ` ${b.candidates} cand.`}
                                    {b.contradictions > 0 && ` ${b.contradictions} conflict`}
                                  </span>
                                </div>
                              ))}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        )}

        {activeTab === "templates" && (
          <div className="space-y-4">
            <div className="grid grid-cols-4 gap-4">
              <Card>
                <CardContent className="pt-4 pb-3 px-4">
                  <div className="text-2xl font-bold text-green-600">{templatesData?.length || 0}</div>
                  <div className="text-xs text-muted-foreground">Total Templates</div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4 pb-3 px-4">
                  <div className="text-2xl font-bold text-blue-600">{templatesData?.filter((t: any) => t.output_type === "email").length || 0}</div>
                  <div className="text-xs text-muted-foreground">Email</div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4 pb-3 px-4">
                  <div className="text-2xl font-bold text-purple-600">{templatesData?.filter((t: any) => t.parent_template_id).length || 0}</div>
                  <div className="text-xs text-muted-foreground">With Compliance Parent</div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4 pb-3 px-4">
                  <div className="text-2xl font-bold text-amber-600">{templatesData?.filter((t: any) => t.output_type === "base").length || 0}</div>
                  <div className="text-xs text-muted-foreground">Base Templates</div>
                </CardContent>
              </Card>
            </div>

            {templatesLoading ? (
              <div className="flex items-center justify-center py-12 text-muted-foreground">
                <Loader2 className="w-5 h-5 mr-2 animate-spin" /> Loading templates...
              </div>
            ) : (
              <Card>
                <CardContent className="p-0">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-8"></TableHead>
                        <TableHead>Template ID</TableHead>
                        <TableHead>Name</TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead>Channel</TableHead>
                        <TableHead>Sections</TableHead>
                        <TableHead>Parent</TableHead>
                        <TableHead>Required ACUs</TableHead>
                        <TableHead>Prohibited</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(templatesData || []).map((tmpl: any) => (
                        <Fragment key={tmpl.id}>
                          <TableRow
                            className="cursor-pointer hover:bg-muted/50"
                            onClick={() => setExpandedTemplate(expandedTemplate === tmpl.id ? null : tmpl.id)}
                          >
                            <TableCell>
                              {expandedTemplate === tmpl.id ? (
                                <ChevronDown className="w-4 h-4 text-muted-foreground" />
                              ) : (
                                <ChevronRight className="w-4 h-4 text-muted-foreground" />
                              )}
                            </TableCell>
                            <TableCell className="font-mono text-xs">{tmpl.id}</TableCell>
                            <TableCell className="font-medium text-sm">{tmpl.name}</TableCell>
                            <TableCell>
                              <Badge variant="outline" className="text-xs">{tmpl.output_type}</Badge>
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground">{tmpl.channel || "—"}</TableCell>
                            <TableCell className="text-xs">{(tmpl.sections as any[])?.length || 0}</TableCell>
                            <TableCell className="font-mono text-xs text-muted-foreground">
                              {tmpl.parent_template_id ? (
                                <Badge className="bg-purple-100 text-purple-800 text-xs">{tmpl.parent_template_id.replace("tmpl_", "")}</Badge>
                              ) : "—"}
                            </TableCell>
                            <TableCell className="text-xs">{(tmpl.required_acus as any[])?.length || 0}</TableCell>
                            <TableCell className="text-xs">
                              {(tmpl.prohibited_acus as any[])?.length > 0 && (
                                <Badge className="bg-red-100 text-red-800 text-xs">{(tmpl.prohibited_acus as any[]).length}</Badge>
                              )}
                            </TableCell>
                          </TableRow>
                          {expandedTemplate === tmpl.id && templateDetail && (
                            <TableRow>
                              <TableCell colSpan={9} className="bg-muted/30 p-4">
                                <div className="space-y-4">
                                  <div className="grid grid-cols-2 gap-4">
                                    <div>
                                      <div className="text-xs font-semibold text-muted-foreground mb-2">SECTIONS ({templateDetail.composed_sections?.length || 0} composed)</div>
                                      <div className="space-y-2">
                                        {(templateDetail.composed_sections || templateDetail.sections || []).map((s: any, i: number) => (
                                          <div key={i} className="bg-background border rounded p-2">
                                            <div className="flex items-center gap-2">
                                              <span className="font-mono text-xs font-semibold">{s.id}</span>
                                              {s.required && <Badge className="bg-green-100 text-green-800 text-[10px]">required</Badge>}
                                              {s.max_words && <span className="text-[10px] text-muted-foreground">{s.max_words}w max</span>}
                                              {s.injection_mode && <Badge variant="outline" className="text-[10px]">{s.injection_mode}</Badge>}
                                            </div>
                                            {s.label && <div className="text-xs mt-1">{s.label}</div>}
                                            {s.narrative_guidance && <div className="text-[10px] text-muted-foreground mt-1 italic">{s.narrative_guidance}</div>}
                                            {s.required_acu_ids && (
                                              <div className="flex gap-1 mt-1 flex-wrap">
                                                {s.required_acu_ids.map((id: string) => (
                                                  <Badge key={id} className="bg-green-100 text-green-800 text-[10px]">{id}</Badge>
                                                ))}
                                              </div>
                                            )}
                                            {s.accepted_topics && (
                                              <div className="flex gap-1 mt-1 flex-wrap">
                                                {s.accepted_topics.map((t: string) => (
                                                  <Badge key={t} variant="outline" className="text-[10px]">{t}</Badge>
                                                ))}
                                              </div>
                                            )}
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                    <div className="space-y-4">
                                      <div>
                                        <div className="text-xs font-semibold text-muted-foreground mb-2">FORMATTING RULES</div>
                                        <pre className="bg-background border rounded p-2 text-[10px] overflow-auto max-h-40">
                                          {JSON.stringify(templateDetail.formatting_rules, null, 2)}
                                        </pre>
                                      </div>
                                      {(templateDetail.required_acus as any[])?.length > 0 && (
                                        <div>
                                          <div className="text-xs font-semibold text-muted-foreground mb-2">REQUIRED ACUs</div>
                                          <div className="flex gap-1 flex-wrap">
                                            {(templateDetail.required_acus as string[]).map((id: string) => (
                                              <Badge key={id} className="bg-green-100 text-green-800 text-xs">{id}</Badge>
                                            ))}
                                          </div>
                                        </div>
                                      )}
                                      {(templateDetail.prohibited_acus as any[])?.length > 0 && (
                                        <div>
                                          <div className="text-xs font-semibold text-muted-foreground mb-2">PROHIBITED ACUs</div>
                                          <div className="flex gap-1 flex-wrap">
                                            {(templateDetail.prohibited_acus as string[]).map((id: string) => (
                                              <Badge key={id} className="bg-red-100 text-red-800 text-xs">{id}</Badge>
                                            ))}
                                          </div>
                                        </div>
                                      )}
                                      {templateDetail.generation_prompt_prefix && (
                                        <div>
                                          <div className="text-xs font-semibold text-muted-foreground mb-2">GENERATION PROMPT PREFIX</div>
                                          <div className="bg-background border rounded p-2 text-[10px] text-muted-foreground italic">
                                            {templateDetail.generation_prompt_prefix}
                                          </div>
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                </div>
                              </TableCell>
                            </TableRow>
                          )}
                        </Fragment>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            )}
          </div>
        )}

        {activeTab === "prompts" && (
          <div className="space-y-4">
            <div className="grid grid-cols-4 gap-4">
              {(promptsData || []).map((p: any) => (
                <Card key={p.id} className="cursor-pointer hover:border-green-600/50 transition-colors" onClick={() => setExpandedPrompt(expandedPrompt === p.id ? null : p.id)}>
                  <CardContent className="pt-4 pb-3 px-4">
                    <div className="flex items-center justify-between mb-2">
                      <Badge variant="outline" className="font-mono text-xs">{p.id}</Badge>
                      <div className="flex items-center gap-1">
                        {Array.from({ length: 12 }, (_, i) => (
                          <Star
                            key={i}
                            className={`w-2.5 h-2.5 ${i < (p.rubric_score || 0) ? "text-amber-400 fill-amber-400" : "text-gray-200"}`}
                          />
                        ))}
                      </div>
                    </div>
                    <div className="text-sm font-medium">{p.name}</div>
                    <div className="text-xs text-muted-foreground mt-1">{p.location}</div>
                    <div className="flex items-center gap-2 mt-2">
                      <Badge className={`text-[10px] ${p.status === "ACTIVE" ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-800"}`}>
                        {p.status}
                      </Badge>
                      <span className="text-[10px] text-muted-foreground">v{p.version}</span>
                      <span className="text-[10px] text-muted-foreground">Score: {p.rubric_score}/12</span>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>

            {expandedPrompt && promptsData && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-sm">
                    <BookOpen className="w-4 h-4 text-green-600" />
                    {promptsData.find((p: any) => p.id === expandedPrompt)?.name} — Full Prompt Text
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <pre className="bg-muted rounded p-4 text-xs overflow-auto max-h-[500px] whitespace-pre-wrap font-mono">
                    {promptsData.find((p: any) => p.id === expandedPrompt)?.prompt_text}
                  </pre>
                  <div className="flex items-center gap-4 mt-4 text-xs text-muted-foreground">
                    <span>Last reviewed: {promptsData.find((p: any) => p.id === expandedPrompt)?.last_reviewed || "Never"}</span>
                    <span>Reviewed by: {promptsData.find((p: any) => p.id === expandedPrompt)?.reviewed_by || "—"}</span>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        )}

        {showLockModal && lockTarget && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <Card className="w-[520px]">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <Lock className="w-5 h-5 text-green-600" />
                  Confirm Lock
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-sm">
                  You are about to lock this content unit. <strong>This action cannot be undone.</strong>
                </p>
                <p className="text-sm">
                  Once locked, this exact text will be injected verbatim into all generated documents that reference it.
                </p>
                <div className="bg-muted p-3 rounded text-xs font-mono">
                  {lockTarget.content}
                </div>
                <p className="text-sm">
                  <strong>{lockRefCount}</strong> document{lockRefCount !== 1 ? "s" : ""} currently reference{lockRefCount === 1 ? "s" : ""} this unit.
                  {lockRefCount > 0 && " Locking a new version will flag them for review."}
                </p>
                <div className="flex justify-end gap-2 pt-2">
                  <Button variant="outline" onClick={() => setShowLockModal(null)}>
                    Cancel
                  </Button>
                  <Button
                    className="bg-green-600 hover:bg-green-700 text-white"
                    disabled={lockMutation.isPending}
                    onClick={() => lockMutation.mutate(showLockModal)}
                  >
                    <Lock className="w-4 h-4 mr-1" />
                    {lockMutation.isPending ? "Locking..." : "Confirm Lock"}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}
