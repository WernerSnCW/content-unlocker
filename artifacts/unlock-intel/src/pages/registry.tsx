import { useListDocuments } from "@workspace/api-client-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { useState, useMemo } from "react";
import { Search, FileText, Download } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Link } from "wouter";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function Registry() {
  const [lifecycleStatus, setLifecycleStatus] = useState<string>("all");
  const [reviewState, setReviewState] = useState<string>("all");
  const [search, setSearch] = useState("");

  const queryParams: any = {};
  if (lifecycleStatus !== "all") queryParams.lifecycle_status = lifecycleStatus;
  if (reviewState !== "all") queryParams.review_state = reviewState;

  const { data: documents, isLoading } = useListDocuments(queryParams);

  const filtered = useMemo(() => {
    if (!documents) return [];
    if (!search.trim()) return documents;
    const q = search.toLowerCase();
    return documents.filter(d =>
      d.name.toLowerCase().includes(q) ||
      d.file_code.toLowerCase().includes(q) ||
      d.category.toLowerCase().includes(q) ||
      (d.description || "").toLowerCase().includes(q)
    );
  }, [documents, search]);

  const groupedByTier = useMemo(() => {
    const tiers: Record<number, typeof filtered> = { 1: [], 2: [], 3: [] };
    filtered.forEach(d => {
      if (!tiers[d.tier]) tiers[d.tier] = [];
      tiers[d.tier].push(d);
    });
    return tiers;
  }, [filtered]);

  const tierLabels: Record<number, { label: string; desc: string; color: string }> = {
    1: { label: "Tier 1 — Core", desc: "Foundational documents. Updates cascade to Tier 2 and Tier 3.", color: "bg-red-500" },
    2: { label: "Tier 2 — Derived", desc: "Built from Tier 1. Updates cascade to Tier 3.", color: "bg-amber-500" },
    3: { label: "Tier 3 — Output", desc: "Final deliverables derived from upstream tiers.", color: "bg-blue-500" },
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "CURRENT": return <Badge className="bg-green-600 hover:bg-green-700">Current</Badge>;
      case "DRAFT": return <Badge className="bg-amber-500 hover:bg-amber-600">Draft</Badge>;
      case "SUPERSEDED": return <Badge variant="secondary">Superseded</Badge>;
      default: return <Badge variant="outline">{status}</Badge>;
    }
  };

  const getReviewBadge = (state: string) => {
    switch (state) {
      case "CLEAN": return <Badge variant="outline" className="border-green-200 text-green-700 bg-green-50">Clean</Badge>;
      case "REQUIRES_REVIEW": return <Badge variant="destructive" className="bg-orange-500 hover:bg-orange-600">Needs Review</Badge>;
      case "REVIEWED": return <Badge variant="outline" className="border-blue-200 text-blue-700 bg-blue-50">Reviewed</Badge>;
      default: return null;
    }
  };

  const stats = useMemo(() => {
    if (!documents) return { total: 0, current: 0, draft: 0, needsReview: 0 };
    return {
      total: documents.length,
      current: documents.filter(d => d.lifecycle_status === "CURRENT").length,
      draft: documents.filter(d => d.lifecycle_status === "DRAFT").length,
      needsReview: documents.filter(d => d.review_state === "REQUIRES_REVIEW").length,
    };
  }, [documents]);

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-12">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Document Registry</h1>
        <p className="text-muted-foreground mt-1">Master index of all approved and draft collateral, organised by dependency tier.</p>
      </div>

      <div className="grid grid-cols-4 gap-4">
        <Card className="bg-card">
          <CardContent className="pt-4 pb-3">
            <div className="text-2xl font-bold">{stats.total}</div>
            <div className="text-xs text-muted-foreground">Total Documents</div>
          </CardContent>
        </Card>
        <Card className="bg-card">
          <CardContent className="pt-4 pb-3">
            <div className="text-2xl font-bold text-green-600">{stats.current}</div>
            <div className="text-xs text-muted-foreground">Current</div>
          </CardContent>
        </Card>
        <Card className="bg-card">
          <CardContent className="pt-4 pb-3">
            <div className="text-2xl font-bold text-amber-500">{stats.draft}</div>
            <div className="text-xs text-muted-foreground">Draft</div>
          </CardContent>
        </Card>
        <Card className="bg-card">
          <CardContent className="pt-4 pb-3">
            <div className="text-2xl font-bold text-orange-500">{stats.needsReview}</div>
            <div className="text-xs text-muted-foreground">Needs Review</div>
          </CardContent>
        </Card>
      </div>

      <div className="flex flex-col sm:flex-row items-center gap-4 bg-card p-4 rounded-lg border shadow-sm">
        <div className="relative flex-1 w-full">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search by name, file code, or category..."
            className="pl-9"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto">
          <Select value={lifecycleStatus} onValueChange={setLifecycleStatus}>
            <SelectTrigger className="w-[160px]">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              <SelectItem value="CURRENT">Current</SelectItem>
              <SelectItem value="DRAFT">Draft</SelectItem>
              <SelectItem value="SUPERSEDED">Superseded</SelectItem>
            </SelectContent>
          </Select>

          <Select value={reviewState} onValueChange={setReviewState}>
            <SelectTrigger className="w-[160px]">
              <SelectValue placeholder="Review State" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All States</SelectItem>
              <SelectItem value="CLEAN">Clean</SelectItem>
              <SelectItem value="REQUIRES_REVIEW">Requires Review</SelectItem>
              <SelectItem value="REVIEWED">Reviewed</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {isLoading ? (
        <div className="text-center py-12 text-muted-foreground">Loading documents...</div>
      ) : (
        <div className="space-y-8">
          {[1, 2, 3].map(tier => {
            const docs = groupedByTier[tier] || [];
            if (docs.length === 0) return null;
            const info = tierLabels[tier];
            return (
              <div key={tier} className="space-y-3">
                <div className="flex items-center gap-3">
                  <div className={`w-2 h-2 rounded-full ${info.color}`} />
                  <h2 className="text-lg font-semibold">{info.label}</h2>
                  <span className="text-xs text-muted-foreground">{info.desc}</span>
                  <Badge variant="secondary" className="ml-auto text-xs">{docs.length} docs</Badge>
                </div>
                <div className="border rounded-lg bg-card overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-[100px]">File Code</TableHead>
                        <TableHead className="w-[300px]">Name</TableHead>
                        <TableHead>Category</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Review</TableHead>
                        <TableHead>Version</TableHead>
                        <TableHead className="w-[50px]"></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {docs.map((doc) => (
                        <TableRow key={doc.id}>
                          <TableCell className="font-mono text-xs">{doc.file_code}</TableCell>
                          <TableCell>
                            <Link href={`/registry/${doc.id}`} className="font-medium hover:underline text-primary/90 flex items-center gap-1.5">
                              <FileText className="w-3.5 h-3.5 text-muted-foreground" />
                              {doc.name}
                            </Link>
                            {doc.description && (
                              <p className="text-xs text-muted-foreground mt-0.5 truncate max-w-[280px]">{doc.description}</p>
                            )}
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">{doc.category}</TableCell>
                          <TableCell>{getStatusBadge(doc.lifecycle_status)}</TableCell>
                          <TableCell>{getReviewBadge(doc.review_state)}</TableCell>
                          <TableCell className="text-muted-foreground text-sm">v{doc.version}</TableCell>
                          <TableCell>
                            <Link href={`/registry/${doc.id}`} className="text-xs text-muted-foreground hover:text-foreground">
                              View
                            </Link>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
