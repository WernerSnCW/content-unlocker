import { useListDocuments } from "@workspace/api-client-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { useState } from "react";
import { Search, Filter } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Link } from "wouter";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { format } from "date-fns";

export default function Registry() {
  const [lifecycleStatus, setLifecycleStatus] = useState<string>("all");
  const [reviewState, setReviewState] = useState<string>("all");
  
  const queryParams: any = {};
  if (lifecycleStatus !== "all") queryParams.lifecycle_status = lifecycleStatus;
  if (reviewState !== "all") queryParams.review_state = reviewState;

  const { data: documents, isLoading } = useListDocuments(queryParams);

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
      case "REQUIRES_REVIEW": return <Badge variant="destructive" className="bg-orange-500 hover:bg-orange-600">Requires Review</Badge>;
      case "REVIEWED": return <Badge variant="outline" className="border-blue-200 text-blue-700 bg-blue-50">Reviewed</Badge>;
      default: return null;
    }
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Document Registry</h1>
        <p className="text-muted-foreground mt-1">Master index of all approved and draft collateral.</p>
      </div>

      <div className="flex flex-col sm:flex-row items-center gap-4 bg-card p-4 rounded-lg border shadow-sm">
        <div className="relative flex-1 w-full">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input 
            placeholder="Search by name, file code, or category..." 
            className="pl-9"
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

      <div className="border rounded-lg bg-card overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>File Code</TableHead>
              <TableHead className="w-[300px]">Name</TableHead>
              <TableHead>Tier</TableHead>
              <TableHead>Category</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Review State</TableHead>
              <TableHead>Version</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">Loading documents...</TableCell>
              </TableRow>
            ) : documents?.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">No documents found.</TableCell>
              </TableRow>
            ) : (
              documents?.map((doc) => (
                <TableRow key={doc.id}>
                  <TableCell className="font-mono text-xs">{doc.file_code}</TableCell>
                  <TableCell className="font-medium">
                    <Link href={`/registry/${doc.id}`} className="hover:underline">{doc.name}</Link>
                  </TableCell>
                  <TableCell>T{doc.tier}</TableCell>
                  <TableCell>{doc.category}</TableCell>
                  <TableCell>{getStatusBadge(doc.lifecycle_status)}</TableCell>
                  <TableCell>{getReviewBadge(doc.review_state)}</TableCell>
                  <TableCell className="text-muted-foreground">v{doc.version}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
