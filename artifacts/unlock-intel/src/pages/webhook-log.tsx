import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { RefreshCw, Loader2 } from "lucide-react";

const API_BASE = (import.meta.env.BASE_URL?.replace(/\/$/, "") || "") + "/api";

interface LogEntry {
  timestamp: string;
  event: string;
  status: string;
  contact_match: string | null;
  data_summary: Record<string, any>;
  raw_body: any;
}

export default function WebhookLog() {
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);

  const fetchLog = async () => {
    try {
      const res = await fetch(`${API_BASE}/aircall/webhook-log`);
      const data = await res.json();
      setEntries(data.entries || []);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  };

  useEffect(() => { fetchLog(); }, []);

  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(fetchLog, 3000);
    return () => clearInterval(interval);
  }, [autoRefresh]);

  const statusColor = (status: string) => {
    if (status === "processed") return "default";
    if (status === "ignored") return "secondary";
    return "destructive";
  };

  const eventColor = (event: string) => {
    if (event === "call.ended") return "text-blue-400";
    if (event === "call.tagged") return "text-green-400";
    if (event === "call.commented") return "text-yellow-400";
    if (event === "transcription.created") return "text-purple-400";
    return "text-muted-foreground";
  };

  return (
    <div className="space-y-4 max-w-6xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Webhook Log</h1>
          <p className="text-sm text-muted-foreground">Live view of incoming Aircall webhook events (in-memory, resets on server restart)</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant={autoRefresh ? "default" : "outline"} size="sm"
            onClick={() => setAutoRefresh(!autoRefresh)}>
            {autoRefresh ? "Auto-refresh ON" : "Auto-refresh OFF"}
          </Button>
          <Button variant="outline" size="sm" onClick={fetchLog}>
            <RefreshCw className="w-4 h-4 mr-1" /> Refresh
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">{entries.length} event{entries.length !== 1 ? "s" : ""} received</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="py-8 text-center"><Loader2 className="w-6 h-6 animate-spin mx-auto" /></div>
          ) : entries.length === 0 ? (
            <div className="py-8 text-center text-muted-foreground">
              <p>No webhook events received yet.</p>
              <p className="text-xs mt-1">Make a call from the Command Centre and tag it in Aircall to see events here.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[160px]">Time</TableHead>
                  <TableHead>Event</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Contact Match</TableHead>
                  <TableHead>Details</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {entries.map((entry, i) => (
                  <>
                    <TableRow key={i} className="cursor-pointer hover:bg-muted/50" onClick={() => setExpanded(expanded === i ? null : i)}>
                      <TableCell className="font-mono text-xs">
                        {new Date(entry.timestamp).toLocaleTimeString()}
                      </TableCell>
                      <TableCell>
                        <span className={`font-medium text-sm ${eventColor(entry.event)}`}>{entry.event}</span>
                      </TableCell>
                      <TableCell>
                        <Badge variant={statusColor(entry.status) as any} className="text-xs">{entry.status}</Badge>
                      </TableCell>
                      <TableCell className="text-sm">
                        {entry.contact_match || <span className="text-muted-foreground">—</span>}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {entry.data_summary.raw_digits && <span>Phone: {String(entry.data_summary.raw_digits)} </span>}
                        {entry.data_summary.tag && <span>Tag: {typeof entry.data_summary.tag === "object" ? JSON.stringify(entry.data_summary.tag) : String(entry.data_summary.tag)} </span>}
                        {entry.data_summary.duration != null && <span>Duration: {entry.data_summary.duration}s </span>}
                        {entry.data_summary.comment && <span>Note: {typeof entry.data_summary.comment === "object" ? JSON.stringify(entry.data_summary.comment).slice(0, 50) : String(entry.data_summary.comment).slice(0, 50)} </span>}
                      </TableCell>
                    </TableRow>
                    {expanded === i && (
                      <TableRow key={`${i}-detail`}>
                        <TableCell colSpan={5}>
                          <pre className="text-xs bg-muted p-3 rounded-lg overflow-auto max-h-[300px] whitespace-pre-wrap">
                            {JSON.stringify(entry.raw_body, null, 2)}
                          </pre>
                        </TableCell>
                      </TableRow>
                    )}
                  </>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
