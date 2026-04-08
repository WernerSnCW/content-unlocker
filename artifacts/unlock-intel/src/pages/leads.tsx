import { useListLeads } from "@workspace/api-client-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useState } from "react";
import { Search, Plus, Loader2, Upload, Trash2, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Link } from "wouter";
import { format } from "date-fns";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useQueryClient } from "@tanstack/react-query";

const API_BASE = (import.meta.env.BASE_URL?.replace(/\/$/, "") || "") + "/api";

const PIPELINE_STAGES = ["Outreach", "Called", "Demo Booked", "Demo Complete", "Decision"];

function splitCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
      else { inQuotes = !inQuotes; }
    } else if (ch === "," && !inQuotes) {
      result.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
}

function parseCsv(text: string): Record<string, string>[] {
  const lines = text.trim().split("\n").filter(l => l.trim());
  if (lines.length < 2) return [];
  const headers = splitCsvLine(lines[0]).map(h => h.toLowerCase().replace(/\s+/g, "_"));
  return lines.slice(1).map(line => {
    const values = splitCsvLine(line);
    const obj: Record<string, string> = {};
    headers.forEach((h, i) => { if (values[i]) obj[h] = values[i]; });
    return obj;
  }).filter(obj => obj.name);
}

export default function Leads() {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const pageSize = 25;
  const { data: response, isLoading } = useListLeads({ search, page, page_size: pageSize });
  const leads = response?.data;
  const pagination = response?.pagination;
  const queryClient = useQueryClient();

  const [modalOpen, setModalOpen] = useState(false);
  const [formName, setFormName] = useState("");
  const [formCompany, setFormCompany] = useState("");
  const [formStage, setFormStage] = useState("");
  const [formSource, setFormSource] = useState("");
  const [nameError, setNameError] = useState("");
  const [submitError, setSubmitError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkCsv, setBulkCsv] = useState("");
  const [bulkSubmitting, setBulkSubmitting] = useState(false);
  const [bulkResult, setBulkResult] = useState<{ created: number; errors: number } | null>(null);
  const [bulkError, setBulkError] = useState("");

  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);
  const [deleting, setDeleting] = useState(false);

  const resetForm = () => {
    setFormName("");
    setFormCompany("");
    setFormStage("");
    setFormSource("");
    setNameError("");
    setSubmitError("");
  };

  const handleOpenModal = () => { resetForm(); setModalOpen(true); };
  const handleCloseModal = () => { resetForm(); setModalOpen(false); };

  const handleSubmitLead = async () => {
    setNameError("");
    setSubmitError("");

    if (!formName.trim()) {
      setNameError("Name is required.");
      return;
    }

    const body: Record<string, string> = { name: formName.trim() };
    if (formCompany.trim()) body.company = formCompany.trim();
    if (formStage) body.pipeline_stage = formStage;
    if (formSource.trim()) body.source = formSource.trim();

    setSubmitting(true);
    try {
      const res = await fetch(`${API_BASE}/leads`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error("failed");
      setModalOpen(false);
      resetForm();
      queryClient.invalidateQueries({ queryKey: ["/api/leads"] });
    } catch {
      setSubmitError("Could not create lead. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleBulkUpload = async () => {
    setBulkError("");
    setBulkResult(null);
    const rows = parseCsv(bulkCsv);
    if (rows.length === 0) {
      setBulkError("No valid rows found. Ensure CSV has a header row with at least a 'name' column.");
      return;
    }

    setBulkSubmitting(true);
    try {
      const res = await fetch(`${API_BASE}/leads/bulk`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leads: rows }),
      });
      if (!res.ok) throw new Error("failed");
      const data = await res.json();
      setBulkResult({ created: data.created, errors: data.errors });
      queryClient.invalidateQueries({ queryKey: ["/api/leads"] });
    } catch {
      setBulkError("Bulk upload failed. Please try again.");
    } finally {
      setBulkSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const res = await fetch(`${API_BASE}/leads/${deleteTarget.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("failed");
      queryClient.invalidateQueries({ queryKey: ["/api/leads"] });
    } catch {
    } finally {
      setDeleting(false);
      setDeleteTarget(null);
    }
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Lead Management</h1>
          <p className="text-muted-foreground mt-1">Manage and track investor outreach.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" className="gap-2" onClick={() => { setBulkCsv(""); setBulkResult(null); setBulkError(""); setBulkOpen(true); }}>
            <Upload className="w-4 h-4" /> Bulk Upload
          </Button>
          <Button className="gap-2" onClick={handleOpenModal}>
            <Plus className="w-4 h-4" /> New Lead
          </Button>
        </div>
      </div>

      <Dialog open={modalOpen} onOpenChange={(open) => { if (!open) handleCloseModal(); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Create New Lead</DialogTitle>
            <DialogDescription>Add a new investor lead to the pipeline.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1">
              <label className="text-sm font-medium">Name <span className="text-destructive">*</span></label>
              <Input
                placeholder="Full name"
                value={formName}
                onChange={(e) => { setFormName(e.target.value); if (nameError) setNameError(""); }}
              />
              {nameError && <p className="text-sm text-destructive">{nameError}</p>}
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">Company</label>
              <Input
                placeholder="Company name"
                value={formCompany}
                onChange={(e) => setFormCompany(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">Pipeline Stage</label>
              <Select value={formStage} onValueChange={setFormStage}>
                <SelectTrigger>
                  <SelectValue placeholder="Select stage..." />
                </SelectTrigger>
                <SelectContent>
                  {PIPELINE_STAGES.map((s) => (
                    <SelectItem key={s} value={s}>{s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">Source</label>
              <Input
                placeholder="e.g. Referral, LinkedIn"
                value={formSource}
                onChange={(e) => setFormSource(e.target.value)}
              />
            </div>
          </div>
          {submitError && <p className="text-sm text-destructive">{submitError}</p>}
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={handleCloseModal} disabled={submitting}>Cancel</Button>
            <Button onClick={handleSubmitLead} disabled={submitting}>
              {submitting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Create Lead
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={bulkOpen} onOpenChange={setBulkOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Bulk Upload Leads</DialogTitle>
            <DialogDescription>
              Paste CSV data with columns: name, company, pipeline_stage, source.
              The first row must be headers.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <Textarea
              placeholder={"name,company,pipeline_stage,source\nJohn Smith,Acme Corp,Outreach,LinkedIn\nJane Doe,Beta Ltd,Called,Referral"}
              value={bulkCsv}
              onChange={(e) => setBulkCsv(e.target.value)}
              rows={8}
              className="font-mono text-sm"
            />
            {bulkCsv && (
              <p className="text-sm text-muted-foreground">
                {parseCsv(bulkCsv).length} valid row(s) detected
              </p>
            )}
            {bulkError && <p className="text-sm text-destructive">{bulkError}</p>}
            {bulkResult && (
              <p className="text-sm text-green-600">
                {bulkResult.created} lead(s) created{bulkResult.errors > 0 ? `, ${bulkResult.errors} error(s)` : ""}.
              </p>
            )}
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setBulkOpen(false)}>Close</Button>
            <Button onClick={handleBulkUpload} disabled={bulkSubmitting || !bulkCsv.trim()}>
              {bulkSubmitting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Upload
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Lead</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete <strong>{deleteTarget?.name}</strong>? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} disabled={deleting} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {deleting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <div className="flex items-center gap-4 bg-card p-4 rounded-lg border shadow-sm">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input 
            placeholder="Search by name or company..." 
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            className="pl-9"
          />
        </div>
      </div>

      <div className="border rounded-lg bg-card overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Company</TableHead>
              <TableHead>Stage</TableHead>
              <TableHead>Persona</TableHead>
              <TableHead>Sends</TableHead>
              <TableHead>Last Contact</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">Loading leads...</TableCell>
              </TableRow>
            ) : leads?.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">No leads found.</TableCell>
              </TableRow>
            ) : (
              leads?.map((lead) => (
                <TableRow key={lead.id}>
                  <TableCell className="font-medium">
                    <Link href={`/leads/${lead.id}`} className="hover:underline">{lead.name}</Link>
                  </TableCell>
                  <TableCell>{lead.company || "-"}</TableCell>
                  <TableCell>
                    <Badge variant="outline">{lead.pipeline_stage}</Badge>
                  </TableCell>
                  <TableCell>{lead.detected_persona || "-"}</TableCell>
                  <TableCell>{lead.send_count}</TableCell>
                  <TableCell>{format(new Date(lead.last_contact), "MMM d, yyyy")}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-2">
                      <Link href={`/leads/${lead.id}`} className="text-sm text-primary hover:underline">View</Link>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-muted-foreground hover:text-destructive"
                        onClick={() => setDeleteTarget({ id: lead.id, name: lead.name })}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {pagination && pagination.total_pages > 1 && (
        <div className="flex items-center justify-between bg-card p-3 rounded-lg border">
          <p className="text-sm text-muted-foreground">
            Showing {((pagination.page - 1) * pagination.page_size) + 1}–{Math.min(pagination.page * pagination.page_size, pagination.total)} of {pagination.total} leads
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={pagination.page <= 1}
              onClick={() => setPage(page - 1)}
            >
              <ChevronLeft className="w-4 h-4 mr-1" /> Previous
            </Button>
            <span className="text-sm text-muted-foreground px-2">
              Page {pagination.page} of {pagination.total_pages}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={pagination.page >= pagination.total_pages}
              onClick={() => setPage(page + 1)}
            >
              Next <ChevronRight className="w-4 h-4 ml-1" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
