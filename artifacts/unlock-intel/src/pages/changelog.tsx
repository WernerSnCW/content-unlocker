import { useListChangelog } from "@workspace/api-client-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";
import { FileEdit, ShieldAlert, ArrowRight, User } from "lucide-react";
import { Link } from "wouter";

export default function Changelog() {
  const { data: logs, isLoading } = useListChangelog({ limit: 50 });

  const getActionIcon = (action: string) => {
    if (action.includes('REVIEW')) return <ShieldAlert className="w-4 h-4 text-orange-500" />;
    return <FileEdit className="w-4 h-4 text-blue-500" />;
  };

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">System Changelog</h1>
        <p className="text-muted-foreground mt-1">Audit trail of all system state changes.</p>
      </div>

      <div className="border rounded-lg bg-card overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[180px]">Timestamp</TableHead>
              <TableHead>Action</TableHead>
              <TableHead>Details</TableHead>
              <TableHead>Reference</TableHead>
              <TableHead className="text-right">User</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">Loading audit log...</TableCell>
              </TableRow>
            ) : logs?.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">No entries found.</TableCell>
              </TableRow>
            ) : (
              logs?.map((log) => (
                <TableRow key={log.id}>
                  <TableCell className="text-muted-foreground text-sm">
                    {format(new Date(log.timestamp), "MMM d, yyyy HH:mm:ss")}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      {getActionIcon(log.action)}
                      <Badge variant="outline" className="font-mono text-xs">{log.action}</Badge>
                    </div>
                  </TableCell>
                  <TableCell className="text-sm">{log.details}</TableCell>
                  <TableCell>
                    {log.document_id && (
                      <Link href={`/registry/${log.document_id}`} className="text-xs font-mono text-primary hover:underline flex items-center gap-1">
                          DOC <ArrowRight className="w-3 h-3" />
                      </Link>
                    )}
                    {log.lead_id && (
                      <Link href={`/leads/${log.lead_id}`} className="text-xs text-primary hover:underline flex items-center gap-1">
                          LEAD <ArrowRight className="w-3 h-3" />
                      </Link>
                    )}
                  </TableCell>
                  <TableCell className="text-right text-sm text-muted-foreground flex items-center justify-end gap-2">
                    <User className="w-3 h-3" /> {log.triggered_by || "System"}
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
