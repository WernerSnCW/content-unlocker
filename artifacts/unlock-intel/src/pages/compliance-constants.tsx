import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Loader2, ShieldCheck, ShieldAlert, AlertTriangle, CheckCircle, ArrowLeft, History } from "lucide-react";

const API_BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";

function fetchConstants() {
  return fetch(`${API_BASE}api/compliance-constants`).then((r) => {
    if (!r.ok) throw new Error("Failed to load constants");
    return r.json();
  });
}

function fetchCategories() {
  return fetch(`${API_BASE}api/compliance-constants/categories`).then((r) => {
    if (!r.ok) throw new Error("Failed to load categories");
    return r.json();
  });
}

function fetchKeyHistory(key: string) {
  return fetch(`${API_BASE}api/compliance-constants/key/${key}`).then((r) => {
    if (!r.ok) throw new Error("Failed to load history");
    return r.json();
  });
}

function getStatusBadge(status: string) {
  switch (status) {
    case "ACTIVE":
      return <Badge className="bg-emerald-600 text-white">{status}</Badge>;
    case "DRAFT":
      return <Badge className="bg-amber-500 text-white">{status}</Badge>;
    case "SUPERSEDED":
      return <Badge variant="secondary">{status}</Badge>;
    default:
      return <Badge>{status}</Badge>;
  }
}

function getCategoryBadge(category: string) {
  const colors: Record<string, string> = {
    tax_relief: "bg-blue-600 text-white",
    prohibited: "bg-red-600 text-white",
    limits: "bg-violet-600 text-white",
    instrument: "bg-teal-600 text-white",
    messaging: "bg-slate-600 text-white",
  };
  return <Badge className={colors[category] || "bg-gray-500 text-white"}>{category}</Badge>;
}

export default function ComplianceConstants() {
  const queryClient = useQueryClient();
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [selectedConstant, setSelectedConstant] = useState<any | null>(null);
  const [showProposeModal, setShowProposeModal] = useState(false);
  const [proposeStep, setProposeStep] = useState<1 | 2>(1);
  const [newValue, setNewValue] = useState("");
  const [reason, setReason] = useState("");
  const [actor, setActor] = useState("");
  const [confirmText, setConfirmText] = useState("");
  const [draftResult, setDraftResult] = useState<any>(null);
  const [proposeError, setProposeError] = useState<string | null>(null);

  const { data: constantsData, isLoading } = useQuery({
    queryKey: ["compliance-constants"],
    queryFn: fetchConstants,
  });

  const { data: categoriesData } = useQuery({
    queryKey: ["compliance-constants-categories"],
    queryFn: fetchCategories,
  });

  const { data: historyData, isLoading: historyLoading } = useQuery({
    queryKey: ["compliance-constants-history", selectedConstant?.key],
    queryFn: () => fetchKeyHistory(selectedConstant.key),
    enabled: !!selectedConstant,
  });

  const proposeMutation = useMutation({
    mutationFn: (body: { key: string; newValue: string; reason: string; actor: string }) =>
      fetch(`${API_BASE}api/compliance-constants/propose`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }).then(async (r) => {
        const data = await r.json();
        if (!r.ok) throw new Error(data.error || "Propose failed");
        return data;
      }),
    onSuccess: (data) => {
      setDraftResult(data);
      setProposeError(null);
      setProposeStep(2);
    },
    onError: (err: any) => {
      setProposeError(err.message);
    },
  });

  const confirmMutation = useMutation({
    mutationFn: (body: { draft_id: string; confirmation_text: string }) =>
      fetch(`${API_BASE}api/compliance-constants/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }).then(async (r) => {
        const data = await r.json();
        if (!r.ok) throw new Error(data.error || "Confirm failed");
        return data;
      }),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["compliance-constants"] });
      queryClient.invalidateQueries({ queryKey: ["compliance-constants-history"] });
      setShowProposeModal(false);
      resetModal();
      setSelectedConstant(null);
      alert(`Constant updated. ${data.documents_flagged} document(s) flagged for review.`);
    },
    onError: (err: any) => {
      setProposeError(err.message);
    },
  });

  function resetModal() {
    setProposeStep(1);
    setNewValue("");
    setReason("");
    setActor("");
    setConfirmText("");
    setDraftResult(null);
    setProposeError(null);
  }

  const constants = constantsData?.constants || [];
  const categories = categoriesData?.categories || [];

  const filtered = useMemo(() => {
    if (categoryFilter === "all") return constants;
    return constants.filter((c: any) => c.category === categoryFilter);
  }, [constants, categoryFilter]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (selectedConstant) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="sm" onClick={() => setSelectedConstant(null)}>
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to list
          </Button>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-3">
              <ShieldCheck className="w-5 h-5 text-emerald-500" />
              {selectedConstant.label}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Key</p>
                <p className="font-mono text-sm">{selectedConstant.key}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Current Value</p>
                <p className="text-lg font-semibold">{selectedConstant.value}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Category</p>
                {getCategoryBadge(selectedConstant.category)}
              </div>
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Status</p>
                {getStatusBadge(selectedConstant.status)}
              </div>
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Value Type</p>
                <p className="text-sm">{selectedConstant.value_type}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Qualifier Required</p>
                <p className="text-sm">{selectedConstant.subject_to_qualifier ? "Yes" : "No"}</p>
              </div>
            </div>
            {selectedConstant.notes && (
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Notes</p>
                <p className="text-sm text-muted-foreground">{selectedConstant.notes}</p>
              </div>
            )}
            {selectedConstant.qualifier_text && (
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Qualifier Text</p>
                <p className="text-sm italic">{selectedConstant.qualifier_text}</p>
              </div>
            )}

            {!selectedConstant.is_prohibited && (
              <Button
                onClick={() => {
                  resetModal();
                  setShowProposeModal(true);
                }}
                className="bg-emerald-600 hover:bg-emerald-700"
              >
                Propose Change
              </Button>
            )}
            {selectedConstant.is_prohibited && (
              <div className="flex items-center gap-2 text-red-400 text-sm">
                <ShieldAlert className="w-4 h-4" />
                This is a prohibited value — editing is disabled.
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <History className="w-4 h-4" />
              History
            </CardTitle>
          </CardHeader>
          <CardContent>
            {historyLoading ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : historyData?.records?.length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Value</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Source</TableHead>
                    <TableHead>Actor</TableHead>
                    <TableHead>Activated</TableHead>
                    <TableHead>Reason</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {historyData.records.map((r: any) => (
                    <TableRow key={r.id}>
                      <TableCell className="font-mono">{r.value}</TableCell>
                      <TableCell>{getStatusBadge(r.status)}</TableCell>
                      <TableCell>{r.source}</TableCell>
                      <TableCell>{r.actor || "—"}</TableCell>
                      <TableCell>{r.activated_at ? new Date(r.activated_at).toLocaleDateString() : "—"}</TableCell>
                      <TableCell className="max-w-[200px] truncate">{r.override_reason || "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <p className="text-sm text-muted-foreground">No history records.</p>
            )}
          </CardContent>
        </Card>

        <Dialog open={showProposeModal} onOpenChange={(open) => { if (!open) { setShowProposeModal(false); resetModal(); } }}>
          <DialogContent className="max-w-lg">
            {proposeStep === 1 && (
              <>
                <DialogHeader>
                  <DialogTitle>Propose Override — {selectedConstant.label}</DialogTitle>
                  <DialogDescription>
                    Current value: <strong>{selectedConstant.value}</strong>
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-2">
                  <div>
                    <label className="text-sm font-medium mb-1 block">New Value</label>
                    <Input value={newValue} onChange={(e) => setNewValue(e.target.value)} placeholder="Enter new value" />
                  </div>
                  <div>
                    <label className="text-sm font-medium mb-1 block">Reason (required)</label>
                    <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why is this change needed?" rows={3} />
                  </div>
                  <div>
                    <label className="text-sm font-medium mb-1 block">Actor</label>
                    <Input value={actor} onChange={(e) => setActor(e.target.value)} placeholder="Your name" />
                  </div>
                  {proposeError && (
                    <div className="flex items-center gap-2 text-red-500 text-sm bg-red-950/30 p-3 rounded">
                      <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                      {proposeError === "Prohibited value"
                        ? `This value is prohibited. Correction: ${selectedConstant.notes || "see compliance documentation"}`
                        : proposeError}
                    </div>
                  )}
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => { setShowProposeModal(false); resetModal(); }}>Cancel</Button>
                  <Button
                    disabled={!newValue.trim() || !reason.trim() || proposeMutation.isPending}
                    onClick={() => proposeMutation.mutate({ key: selectedConstant.key, newValue, reason, actor })}
                    className="bg-emerald-600 hover:bg-emerald-700"
                  >
                    {proposeMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                    Propose
                  </Button>
                </DialogFooter>
              </>
            )}

            {proposeStep === 2 && draftResult && (
              <>
                <DialogHeader>
                  <DialogTitle>Confirm Override</DialogTitle>
                  <DialogDescription>Review the proposed change carefully.</DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-2">
                  <div className="bg-amber-950/30 border border-amber-800/50 rounded p-3">
                    <div className="flex items-center gap-2 text-amber-400 text-sm font-medium mb-2">
                      <AlertTriangle className="w-4 h-4" />
                      This will update a compliance-critical value and flag affected documents for review.
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <p className="text-muted-foreground mb-1">Key</p>
                      <p className="font-mono">{draftResult.key}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground mb-1">Reason</p>
                      <p>{reason}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground mb-1">Current Value</p>
                      <p className="font-semibold text-red-400">{draftResult.currentValue}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground mb-1">Proposed Value</p>
                      <p className="font-semibold text-emerald-400">{draftResult.proposedValue}</p>
                    </div>
                  </div>
                  <div>
                    <label className="text-sm font-medium mb-1 block">Type "CONFIRM" to activate this override</label>
                    <Input value={confirmText} onChange={(e) => setConfirmText(e.target.value)} placeholder='Type "CONFIRM"' />
                  </div>
                  {proposeError && (
                    <div className="flex items-center gap-2 text-red-500 text-sm">
                      <AlertTriangle className="w-4 h-4" />
                      {proposeError}
                    </div>
                  )}
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => { setProposeStep(1); setProposeError(null); }}>Back</Button>
                  <Button
                    disabled={confirmText.trim() !== "CONFIRM" || confirmMutation.isPending}
                    onClick={() => confirmMutation.mutate({ draft_id: draftResult.draft_id, confirmation_text: confirmText.trim() })}
                    className="bg-red-600 hover:bg-red-700"
                  >
                    {confirmMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                    Confirm Override
                  </Button>
                </DialogFooter>
              </>
            )}
          </DialogContent>
        </Dialog>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Compliance Constants</h1>
          <p className="text-muted-foreground mt-1">
            {constants.length} active constants — governed lifecycle with audit trail
          </p>
        </div>
      </div>

      <div className="flex items-center gap-4">
        <Select value={categoryFilter} onValueChange={setCategoryFilter}>
          <SelectTrigger className="w-48">
            <SelectValue placeholder="Filter by category" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All categories</SelectItem>
            {categories.map((cat: string) => (
              <SelectItem key={cat} value={cat}>{cat}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Label</TableHead>
                <TableHead>Key</TableHead>
                <TableHead>Value</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Qualifier</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-[80px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((c: any) => (
                <TableRow key={c.id || c.key}>
                  <TableCell className="font-medium">{c.label}</TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">{c.key}</TableCell>
                  <TableCell>
                    <span className="font-mono">{c.value}</span>
                  </TableCell>
                  <TableCell>{getCategoryBadge(c.category)}</TableCell>
                  <TableCell>
                    {c.subject_to_qualifier ? (
                      <Badge variant="outline" className="text-amber-400 border-amber-600">Required</Badge>
                    ) : (
                      <span className="text-muted-foreground text-xs">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {c.is_prohibited ? (
                      <Badge className="bg-red-600 text-white">PROHIBITED</Badge>
                    ) : (
                      getStatusBadge(c.status)
                    )}
                  </TableCell>
                  <TableCell>
                    {!c.is_prohibited ? (
                      <Button variant="ghost" size="sm" onClick={() => setSelectedConstant(c)}>
                        Edit
                      </Button>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
