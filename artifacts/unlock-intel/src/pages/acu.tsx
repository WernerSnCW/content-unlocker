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
} from "lucide-react";

const API_BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";

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

export default function ACUPage() {
  const [statusFilter, setStatusFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showLockModal, setShowLockModal] = useState<string | null>(null);

  const queryClient = useQueryClient();

  const { data: acus, isLoading } = useQuery({
    queryKey: ["acus", statusFilter, typeFilter],
    queryFn: () => fetchACUs(statusFilter, typeFilter),
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
                        <TableCell className="max-w-48 truncate text-xs text-muted-foreground">{acu.source || "—"}</TableCell>
                        <TableCell className="text-xs">{acu.approved_by || "—"}</TableCell>
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
                                  {acu.approved_date || "—"}
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
