import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, UserPlus, RefreshCw, Pencil, Trash2 } from "lucide-react";
import { apiFetch, apiPost } from "@/lib/apiClient";

interface AdminAgent {
  id: string;
  name: string;
  email: string | null;
  aircall_user_id: number | null;
  dialer_mode: "manual" | "power_dialer";
  active: boolean;
  user_id: string | null;
  user_email: string | null;
  user_role: "agent" | "admin" | null;
  user_last_login_at: string | null;
  created_at: string;
  updated_at: string;
}

interface AircallUser {
  id: number;
  email: string;
  name: string;
  available: boolean;
}

const API_BASE = (import.meta.env.BASE_URL?.replace(/\/$/, "") || "") + "/api";

export default function AdminAgentsPage() {
  const [agents, setAgents] = useState<AdminAgent[]>([]);
  const [aircallUsers, setAircallUsers] = useState<AircallUser[]>([]);
  const [aircallError, setAircallError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Per-agent PD queue clear state — tracked by agent id so buttons show
  // their own spinner without blocking the rest of the table.
  const [clearingPdFor, setClearingPdFor] = useState<string | null>(null);
  const [clearPdResult, setClearPdResult] = useState<Record<string, string>>({});

  const handleClearPdQueue = async (agent: AdminAgent) => {
    if (agent.aircall_user_id == null) return;
    if (!window.confirm(`Clear ${agent.name}'s Aircall Power Dialer queue? Anything currently queued in Aircall for this agent will be removed.`)) {
      return;
    }
    setClearingPdFor(agent.id);
    try {
      const res = await apiPost(
        `${API_BASE}/admin/agents/${agent.id}/clear-power-dialer-queue`,
        {},
        { redirectOn401: false },
      );
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setClearPdResult(prev => ({ ...prev, [agent.id]: `Failed: ${body.message || body.error || res.status}` }));
      } else {
        setClearPdResult(prev => ({ ...prev, [agent.id]: `Cleared ${body.deleted} numbers` }));
        // Auto-clear the inline message after 4s
        setTimeout(() => {
          setClearPdResult(prev => {
            const next = { ...prev };
            delete next[agent.id];
            return next;
          });
        }, 4000);
      }
    } catch (err: any) {
      setClearPdResult(prev => ({ ...prev, [agent.id]: `Error: ${err?.message || "unknown"}` }));
    } finally {
      setClearingPdFor(null);
    }
  };

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<AdminAgent | null>(null);
  const [fName, setFName] = useState("");
  const [fEmail, setFEmail] = useState("");
  const [fAircall, setFAircall] = useState<string>("");
  const [fActive, setFActive] = useState(true);
  const [fDialerMode, setFDialerMode] = useState<"manual" | "power_dialer">("manual");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const loadAll = async () => {
    setLoading(true);
    try {
      const [agentsRes, usersRes] = await Promise.all([
        apiFetch(`${API_BASE}/admin/agents`),
        apiFetch(`${API_BASE}/admin/aircall/users`, { redirectOn401: false }),
      ]);
      const agentsData = await agentsRes.json();
      setAgents(agentsData.agents || []);

      if (usersRes.ok) {
        const usersData = await usersRes.json();
        setAircallUsers(usersData.users || []);
        setAircallError(null);
      } else {
        const body = await usersRes.json().catch(() => ({}));
        setAircallError(
          body.error === "aircall_not_configured"
            ? "Aircall integration not configured — set it up in Settings first."
            : body.error === "aircall_credentials_missing"
              ? "Aircall credentials missing — save them in Settings."
              : `Could not fetch Aircall users (${body.error || usersRes.status})`,
        );
        setAircallUsers([]);
      }
    } catch (err: any) {
      // apiFetch surfaced a generic failure — leave counts as-is
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadAll(); }, []);

  const openCreate = () => {
    setEditing(null);
    setFName("");
    setFEmail("");
    setFAircall("");
    setFActive(true);
    setFDialerMode("manual");
    setSubmitError(null);
    setDialogOpen(true);
  };

  const openEdit = (a: AdminAgent) => {
    setEditing(a);
    setFName(a.name);
    setFEmail(a.email || "");
    setFAircall(a.aircall_user_id ? String(a.aircall_user_id) : "");
    setFActive(a.active);
    setFDialerMode(a.dialer_mode || "manual");
    setSubmitError(null);
    setDialogOpen(true);
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    setSubmitError(null);
    try {
      const aircallValue =
        !fAircall || fAircall === "__none__" ? null : fAircall;
      const payload: any = {
        name: fName.trim(),
        aircall_user_id: aircallValue,
        active: fActive,
        dialer_mode: fDialerMode,
      };
      if (!editing) payload.email = fEmail.trim().toLowerCase();

      const res = editing
        ? await apiFetch(`${API_BASE}/admin/agents/${editing.id}`, {
            method: "PATCH",
            body: JSON.stringify(payload),
          })
        : await apiPost(`${API_BASE}/admin/agents`, payload);

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        const label: Record<string, string> = {
          name_required: "Name is required",
          valid_email_required: "A valid email is required",
          aircall_user_id_invalid: "Aircall user ID must be a positive number",
          email_already_exists: "An agent with that email already exists",
        };
        setSubmitError(label[body.error] || body.error || `Request failed (${res.status})`);
        return;
      }
      setDialogOpen(false);
      await loadAll();
    } catch (err: any) {
      setSubmitError(err?.message || "Request failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-5 max-w-5xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Agents</h1>
          <p className="text-sm text-muted-foreground">
            Manage the people who can sign in and make calls.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="gap-1.5" onClick={loadAll} disabled={loading}>
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} /> Refresh
          </Button>
          <Button size="sm" className="gap-1.5" onClick={openCreate}>
            <UserPlus className="w-3.5 h-3.5" /> Add Agent
          </Button>
        </div>
      </div>

      {aircallError && (
        <Card className="border-amber-500/60 bg-amber-500/5">
          <CardContent className="py-3 px-4">
            <p className="text-xs text-amber-700 dark:text-amber-400">
              <strong>Aircall user dropdown unavailable:</strong> {aircallError}
              {" "}You can still add agents — just enter the numeric Aircall user ID manually (or leave blank).
            </p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Registered agents ({agents.length})</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="py-12 text-center text-sm text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin inline mr-2" /> Loading…
            </div>
          ) : agents.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">
              No agents yet. Click <strong>Add Agent</strong> to register someone.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Aircall user</TableHead>
                  <TableHead>Dialer</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Last login</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-12"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {agents.map(a => {
                  const aircall = a.aircall_user_id
                    ? aircallUsers.find(u => u.id === a.aircall_user_id)
                    : null;
                  return (
                    <TableRow key={a.id}>
                      <TableCell className="font-medium">{a.name}</TableCell>
                      <TableCell className="text-muted-foreground text-sm">{a.email || "—"}</TableCell>
                      <TableCell className="text-sm">
                        {a.aircall_user_id ? (
                          <span>
                            {aircall ? aircall.name : `#${a.aircall_user_id}`}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {a.dialer_mode === "power_dialer" ? (
                          <Badge variant="outline" className="bg-blue-500/10 text-blue-700 border-blue-500/30 text-[10px]">
                            Power Dialer
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-[10px]">Manual</Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        {a.user_role === "admin" ? (
                          <Badge variant="default" className="text-[10px]">Admin</Badge>
                        ) : a.user_role === "agent" ? (
                          <Badge variant="outline" className="text-[10px]">Agent</Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground">not linked</span>
                        )}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {a.user_last_login_at
                          ? new Date(a.user_last_login_at).toLocaleString("en-GB", {
                              day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
                            })
                          : "—"}
                      </TableCell>
                      <TableCell>
                        {a.active ? (
                          <Badge variant="outline" className="bg-green-500/10 text-green-700 border-green-500/30 text-[10px]">
                            Active
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-[10px]">Inactive</Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1 justify-end">
                          {a.dialer_mode === "power_dialer" && a.aircall_user_id != null && (
                            <Button
                              variant="ghost"
                              size="sm"
                              title="Clear this agent's Aircall Power Dialer queue"
                              onClick={() => handleClearPdQueue(a)}
                              disabled={clearingPdFor === a.id}
                            >
                              {clearingPdFor === a.id
                                ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                : <Trash2 className="w-3.5 h-3.5" />
                              }
                            </Button>
                          )}
                          <Button variant="ghost" size="sm" onClick={() => openEdit(a)}>
                            <Pencil className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                        {clearPdResult[a.id] && (
                          <p className={`text-[10px] mt-1 ${clearPdResult[a.id].startsWith("Cleared") ? "text-green-600" : "text-destructive"}`}>
                            {clearPdResult[a.id]}
                          </p>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? `Edit ${editing.name}` : "Add Agent"}</DialogTitle>
            <DialogDescription>
              {editing
                ? "Update the agent's name, Aircall mapping, or active status. Email cannot be changed — delete and recreate if needed."
                : "Add a new agent. Their email must match the Google Workspace account they'll sign in with."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-1">
              <label className="text-sm font-medium">Name</label>
              <Input value={fName} onChange={e => setFName(e.target.value)} placeholder="e.g. Marie Jones" />
            </div>

            <div className="space-y-1">
              <label className="text-sm font-medium">Email</label>
              <Input
                value={fEmail}
                onChange={e => setFEmail(e.target.value)}
                placeholder="marie@cloudworkz.com"
                disabled={!!editing}
              />
              {editing && (
                <p className="text-xs text-muted-foreground">Email is locked after creation.</p>
              )}
            </div>

            <div className="space-y-1">
              <label className="text-sm font-medium">Aircall user</label>
              {aircallUsers.length > 0 ? (
                <Select value={fAircall} onValueChange={setFAircall}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select Aircall user..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">None — no Aircall mapping</SelectItem>
                    {aircallUsers.map(u => (
                      <SelectItem key={u.id} value={String(u.id)}>
                        {u.name} ({u.email})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Input
                  type="number"
                  value={fAircall}
                  onChange={e => setFAircall(e.target.value)}
                  placeholder="Numeric Aircall user ID (optional)"
                />
              )}
              <p className="text-xs text-muted-foreground">
                Used to attribute calls and drive the mismatch warning. Optional — can be set later.
              </p>
            </div>

            <div className="space-y-1">
              <label className="text-sm font-medium">Dialer mode</label>
              <Select value={fDialerMode} onValueChange={(v: any) => setFDialerMode(v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="manual">Manual — one-at-a-time via the app's dial button</SelectItem>
                  <SelectItem value="power_dialer">Power Dialer — batch push to Aircall queue</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Power Dialer requires an Aircall Professional plan. The agent must manually click
                "Start session" in the Aircall Workspace after a queue is pushed.
              </p>
            </div>

            {editing && (
              <div className="flex items-center gap-2">
                <input
                  id="active"
                  type="checkbox"
                  checked={fActive}
                  onChange={e => setFActive(e.target.checked)}
                  className="h-4 w-4"
                />
                <label htmlFor="active" className="text-sm">Active (can sign in and dial)</label>
              </div>
            )}

            {submitError && (
              <p className="text-sm text-destructive">{submitError}</p>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={submitting}>
              Cancel
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={submitting || !fName.trim() || (!editing && !fEmail.trim())}
            >
              {submitting ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
              {editing ? "Save" : "Add Agent"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
