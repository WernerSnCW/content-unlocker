import { useListLeads } from "@workspace/api-client-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { useState } from "react";
import { Search, Plus, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Link } from "wouter";
import { format } from "date-fns";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useQueryClient } from "@tanstack/react-query";

const API_BASE = import.meta.env.VITE_API_URL || "/api";

const PIPELINE_STAGES = ["Outreach", "Called", "Demo Booked", "Demo Complete", "Decision"];

export default function Leads() {
  const [search, setSearch] = useState("");
  const { data: leads, isLoading } = useListLeads({ search });
  const queryClient = useQueryClient();

  const [modalOpen, setModalOpen] = useState(false);
  const [formName, setFormName] = useState("");
  const [formCompany, setFormCompany] = useState("");
  const [formStage, setFormStage] = useState("");
  const [formSource, setFormSource] = useState("");
  const [nameError, setNameError] = useState("");
  const [submitError, setSubmitError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const resetForm = () => {
    setFormName("");
    setFormCompany("");
    setFormStage("");
    setFormSource("");
    setNameError("");
    setSubmitError("");
  };

  const handleOpenModal = () => {
    resetForm();
    setModalOpen(true);
  };

  const handleCloseModal = () => {
    resetForm();
    setModalOpen(false);
  };

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

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Lead Management</h1>
          <p className="text-muted-foreground mt-1">Manage and track investor outreach.</p>
        </div>
        <Button className="gap-2" onClick={handleOpenModal}>
          <Plus className="w-4 h-4" /> New Lead
        </Button>
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

      <div className="flex items-center gap-4 bg-card p-4 rounded-lg border shadow-sm">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input 
            placeholder="Search by name or company..." 
            value={search}
            onChange={(e) => setSearch(e.target.value)}
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
                    <Link href={`/leads/${lead.id}`} className="text-sm text-primary hover:underline">View</Link>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
