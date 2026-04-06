import { useState, useEffect, useCallback } from "react";
import { Trash2, Pencil, X, Check, MessageSquare } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";

const API_BASE = (import.meta.env.BASE_URL?.replace(/\/$/, "") || "") + "/api";

interface TaskItem {
  id: string;
  title: string;
  status: string;
  type: string;
  linked_document_id: string | null;
  linked_document_name: string | null;
  context: string | null;
  created_at: string;
  updated_at: string;
}

const STATUSES = ["Open", "In Progress", "Done"];
const TYPES = ["Review", "Build", "Import", "General"];

export default function TasksPage() {
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const [statusFilter, setStatusFilter] = useState("All");
  const [typeFilter, setTypeFilter] = useState("All");

  const [newTitle, setNewTitle] = useState("");
  const [newType, setNewType] = useState("General");
  const [newDocId, setNewDocId] = useState("");
  const [titleError, setTitleError] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editContext, setEditContext] = useState("");
  const [saving, setSaving] = useState(false);

  const [contextExpandedId, setContextExpandedId] = useState<string | null>(null);

  const fetchTasks = useCallback(async () => {
    try {
      const r = await fetch(`${API_BASE}/tasks`);
      if (!r.ok) throw new Error();
      const data = await r.json();
      setTasks(data.tasks);
      setError(false);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTasks();
  }, [fetchTasks]);

  const filteredTasks = tasks.filter((t) => {
    if (statusFilter !== "All" && t.status !== statusFilter) return false;
    if (typeFilter !== "All" && t.type !== typeFilter) return false;
    return true;
  });

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setTitleError(false);
    if (!newTitle.trim()) {
      setTitleError(true);
      return;
    }
    const body: any = { title: newTitle.trim(), type: newType };
    if (newDocId.trim()) body.linked_document_id = newDocId.trim();
    try {
      const r = await fetch(`${API_BASE}/tasks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (r.ok) {
        setNewTitle("");
        setNewType("General");
        setNewDocId("");
        await fetchTasks();
      }
    } catch {}
  };

  const handleStatusChange = async (id: string, status: string) => {
    try {
      const r = await fetch(`${API_BASE}/tasks/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (r.ok) await fetchTasks();
    } catch {}
  };

  const handleDelete = async (id: string) => {
    try {
      const r = await fetch(`${API_BASE}/tasks/${id}`, { method: "DELETE" });
      if (r.ok) await fetchTasks();
    } catch {}
  };

  const startEditing = (task: TaskItem) => {
    setEditingId(task.id);
    setEditTitle(task.title);
    setEditContext(task.context || "");
  };

  const cancelEditing = () => {
    setEditingId(null);
    setEditTitle("");
    setEditContext("");
  };

  const saveEdit = async () => {
    if (!editingId || !editTitle.trim()) return;
    setSaving(true);
    try {
      const r = await fetch(`${API_BASE}/tasks/${editingId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: editTitle.trim(),
          context: editContext.trim() || null,
        }),
      });
      if (r.ok) {
        setEditingId(null);
        await fetchTasks();
      }
    } catch {} finally {
      setSaving(false);
    }
  };

  const quickAddContext = (task: TaskItem) => {
    setEditingId(task.id);
    setEditTitle(task.title);
    setEditContext(task.context || "");
  };

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-foreground">Task Board</h1>
        <p className="text-muted-foreground mt-2">Manage review, build, and import tasks.</p>
      </div>

      <div className="rounded-lg border p-4" style={{ backgroundColor: "#2D2D3F" }}>
        <form onSubmit={handleCreate} className="flex items-end gap-3 flex-wrap">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-muted-foreground">Title</label>
            <input
              type="text"
              value={newTitle}
              onChange={(e) => { setNewTitle(e.target.value); setTitleError(false); }}
              placeholder="Task title"
              className="bg-background border rounded-md px-3 py-2 text-sm w-64"
            />
            {titleError && <span className="text-xs text-red-400">Title is required</span>}
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-muted-foreground">Type</label>
            <select
              value={newType}
              onChange={(e) => setNewType(e.target.value)}
              className="bg-background border rounded-md px-3 py-2 text-sm"
            >
              {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-muted-foreground">Linked Document ID</label>
            <input
              type="text"
              value={newDocId}
              onChange={(e) => setNewDocId(e.target.value)}
              placeholder="Document ID (optional)"
              autoComplete="off"
              className="bg-background border rounded-md px-3 py-2 text-sm w-64"
            />
          </div>
          <button
            type="submit"
            className="px-4 py-2 rounded-md text-sm font-medium text-white"
            style={{ backgroundColor: "#00C853" }}
          >
            Add Task
          </button>
        </form>
      </div>

      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <label className="text-xs font-medium text-muted-foreground">Status:</label>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="bg-background border rounded-md px-3 py-1.5 text-sm"
          >
            <option value="All">All</option>
            {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs font-medium text-muted-foreground">Type:</label>
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="bg-background border rounded-md px-3 py-1.5 text-sm"
          >
            <option value="All">All</option>
            {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
      </div>

      {loading ? (
        <div className="space-y-3">
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-14 w-full" />
        </div>
      ) : error ? (
        <p className="text-muted-foreground text-sm">Failed to load tasks</p>
      ) : filteredTasks.length === 0 ? (
        <p className="text-muted-foreground text-sm">No tasks found</p>
      ) : (
        <div className="space-y-2">
          {filteredTasks.map((task) => (
            <div key={task.id}>
              {editingId === task.id ? (
                <div
                  className="rounded-lg border p-4 space-y-3"
                  style={{ backgroundColor: "#2D2D3F" }}
                >
                  <div className="flex items-center gap-3">
                    <input
                      type="text"
                      value={editTitle}
                      onChange={(e) => setEditTitle(e.target.value)}
                      className="flex-1 bg-background border rounded-md px-3 py-2 text-sm"
                      placeholder="Task title"
                    />
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={saving}
                      onClick={saveEdit}
                      className="text-green-400 hover:text-green-300"
                    >
                      <Check className="w-4 h-4" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={cancelEditing}
                    >
                      <X className="w-4 h-4" />
                    </Button>
                  </div>
                  <div>
                    <label className="text-xs font-medium text-muted-foreground block mb-1">
                      Context / additional guidance
                    </label>
                    <textarea
                      value={editContext}
                      onChange={(e) => setEditContext(e.target.value)}
                      className="w-full bg-background border rounded-md px-3 py-2 text-sm min-h-[80px] resize-y"
                      placeholder="Add context for this task — this gets passed to the Work Queue analysis when Claude reviews the linked document. E.g. 'Check the pricing section specifically — we suspect £99 is still in there.'"
                    />
                    <p className="text-xs text-muted-foreground/60 mt-1">
                      This context is included in the Work Queue compliance analysis for the linked document.
                    </p>
                  </div>
                </div>
              ) : (
                <div
                  className="rounded-lg border"
                  style={{ backgroundColor: "#2D2D3F" }}
                >
                  <div className="flex items-center gap-4 p-3">
                    <div className="flex-1 min-w-0">
                      <span className="text-sm font-medium">{task.title}</span>
                      {task.linked_document_name && (
                        <span className="ml-2 text-xs text-muted-foreground">
                          ({task.linked_document_name})
                        </span>
                      )}
                      {task.context && (
                        <button
                          onClick={() =>
                            setContextExpandedId(
                              contextExpandedId === task.id ? null : task.id
                            )
                          }
                          className="ml-2 inline-flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300"
                        >
                          <MessageSquare className="w-3 h-3" />
                          context
                        </button>
                      )}
                    </div>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground whitespace-nowrap">
                      {task.type}
                    </span>
                    <select
                      value={task.status}
                      onChange={(e) => handleStatusChange(task.id, e.target.value)}
                      className="bg-background border rounded-md px-2 py-1 text-xs"
                    >
                      {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                    <button
                      onClick={() => startEditing(task)}
                      className="p-1.5 text-muted-foreground hover:text-blue-400 transition-colors"
                      title="Edit task"
                    >
                      <Pencil className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => handleDelete(task.id)}
                      className="p-1.5 text-muted-foreground hover:text-red-400 transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                  {contextExpandedId === task.id && task.context && (
                    <div className="px-3 pb-3 border-t border-border/50 pt-2">
                      <p className="text-xs text-muted-foreground/60 mb-1 font-medium">Operator context:</p>
                      <p className="text-sm text-muted-foreground whitespace-pre-wrap">{task.context}</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
