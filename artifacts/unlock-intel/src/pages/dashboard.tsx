import { useGetDashboardSummary, useGetRecentActivity } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Link } from "wouter";
import { ArrowRight, FileText, Users, AlertCircle, Clock, CheckCircle2, AlertTriangle } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";

export default function Dashboard() {
  const { data: summary, isLoading: isSummaryLoading } = useGetDashboardSummary();
  const { data: recentActivity, isLoading: isActivityLoading } = useGetRecentActivity({ limit: 10 });

  return (
    <div className="space-y-8 max-w-7xl mx-auto">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-foreground">Command Centre</h1>
        <p className="text-muted-foreground mt-2">Platform overview and recent intelligence activity.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="bg-card">
          <CardHeader className="pb-2">
            <CardDescription>Total Leads</CardDescription>
            <CardTitle className="text-3xl">
              {isSummaryLoading ? <Skeleton className="h-8 w-16" /> : summary?.total_leads}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Link href="/leads" className="text-sm text-primary hover:underline flex items-center gap-1">
                View all leads <ArrowRight className="w-3 h-3" />
            </Link>
          </CardContent>
        </Card>

        <Card className="bg-card">
          <CardHeader className="pb-2">
            <CardDescription>Total Documents</CardDescription>
            <CardTitle className="text-3xl">
              {isSummaryLoading ? <Skeleton className="h-8 w-16" /> : summary?.total_documents}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Link href="/registry" className="text-sm text-primary hover:underline flex items-center gap-1">
                View registry <ArrowRight className="w-3 h-3" />
            </Link>
          </CardContent>
        </Card>

        <Card className="bg-card">
          <CardHeader className="pb-2">
            <CardDescription>Docs Sent This Week</CardDescription>
            <CardTitle className="text-3xl">
              {isSummaryLoading ? <Skeleton className="h-8 w-16" /> : summary?.documents_sent_this_week}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-sm text-muted-foreground flex items-center gap-1">
              <CheckCircle2 className="w-4 h-4 text-green-500" /> active outreach
            </div>
          </CardContent>
        </Card>

        <Card className="bg-card border-destructive/50">
          <CardHeader className="pb-2">
            <CardDescription className="text-destructive">Action Required</CardDescription>
            <CardTitle className="text-3xl text-destructive">
              {isSummaryLoading ? <Skeleton className="h-8 w-16" /> : summary?.documents_requiring_review}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Link href="/registry?review_state=REQUIRES_REVIEW" className="text-sm text-destructive hover:underline flex items-center gap-1">
                Review documents <ArrowRight className="w-3 h-3" />
            </Link>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Recent Activity</CardTitle>
              <CardDescription>Latest interactions and document sends</CardDescription>
            </CardHeader>
            <CardContent>
              {isSummaryLoading ? (
                <div className="space-y-4">
                  <Skeleton className="h-12 w-full" />
                  <Skeleton className="h-12 w-full" />
                  <Skeleton className="h-12 w-full" />
                </div>
              ) : summary?.recent_sends?.length === 0 ? (
                <div className="py-8 text-center text-muted-foreground border border-dashed rounded-lg">
                  No recent activity
                </div>
              ) : (
                <div className="space-y-4">
                  {summary?.recent_sends?.map((send, i) => (
                    <div key={i} className="flex items-start gap-4 p-4 rounded-lg border bg-muted/20">
                      <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                        <FileText className="w-4 h-4 text-primary" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between">
                          <Link href={`/leads/${send.lead_id}`} className="font-medium hover:underline truncate">{send.lead_name}</Link>
                          <span className="text-xs text-muted-foreground flex items-center gap-1 flex-shrink-0">
                            <Clock className="w-3 h-3" /> {format(new Date(send.date), "MMM d, HH:mm")}
                          </span>
                        </div>
                        <div className="text-sm text-muted-foreground mt-1 line-clamp-2">
                          Sent {send.document_count || 0} document{(send.document_count || 0) !== 1 ? 's' : ''}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card className="bg-primary text-primary-foreground border-none">
            <CardHeader>
              <CardTitle className="text-primary-foreground">Quick Actions</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <Link href="/recommend" className="w-full flex items-center justify-between p-3 rounded-md bg-white/10 hover:bg-white/20 transition-colors">
                  <span className="font-medium">Start Recommendation</span>
                  <ArrowRight className="w-4 h-4" />
              </Link>
              <Link href="/leads" className="w-full flex items-center justify-between p-3 rounded-md bg-white/10 hover:bg-white/20 transition-colors">
                  <span className="font-medium">Add New Lead</span>
                  <Users className="w-4 h-4" />
              </Link>
              <Link href="/generate" className="w-full flex items-center justify-between p-3 rounded-md bg-white/10 hover:bg-white/20 transition-colors">
                  <span className="font-medium">Generate Content</span>
                  <FileText className="w-4 h-4" />
              </Link>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Pipeline Breakdown</CardTitle>
            </CardHeader>
            <CardContent>
              {isSummaryLoading ? (
                <div className="space-y-2">
                  <Skeleton className="h-8 w-full" />
                  <Skeleton className="h-8 w-full" />
                  <Skeleton className="h-8 w-full" />
                </div>
              ) : (
                <div className="space-y-3">
                  {Object.entries(summary?.pipeline_breakdown || {}).map(([stage, count]) => (
                    <div key={stage} className="flex items-center justify-between">
                      <span className="text-sm font-medium">{stage}</span>
                      <span className="text-sm bg-muted px-2 py-0.5 rounded-full">{count as number}</span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {(summary as any)?.coverage_gap_count > 0 ? (
            <Card className="border-amber-500/30">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <AlertTriangle className="w-4 h-4 text-amber-400" />
                  Coverage Gaps
                </CardTitle>
                <CardDescription>{(summary as any).coverage_gap_count} stage-archetype combinations have no content</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                {((summary as any).coverage_gaps || []).slice(0, 5).map((gap: any, i: number) => (
                  <div key={i} className="flex items-center justify-between text-sm">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="text-xs">{gap.stage}</Badge>
                      <span className="text-muted-foreground">×</span>
                      <Badge variant="outline" className="text-xs">{gap.archetype}</Badge>
                    </div>
                    <span className="text-xs text-red-400">0 docs</span>
                  </div>
                ))}
                {(summary as any)?.coverage_gap_count > 5 && (
                  <p className="text-xs text-muted-foreground">+{(summary as any).coverage_gap_count - 5} more</p>
                )}
                <Link href="/gaps" className="text-sm text-primary hover:underline flex items-center gap-1 pt-2">
                    View full analysis <ArrowRight className="w-3 h-3" />
                </Link>
              </CardContent>
            </Card>
          ) : summary && (
            <Card className="border-emerald-500/30">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                  Full Coverage
                </CardTitle>
                <CardDescription>All stage-archetype combinations have content assigned</CardDescription>
              </CardHeader>
              <CardContent>
                <Link href="/gaps" className="text-sm text-primary hover:underline flex items-center gap-1">
                  View coverage details <ArrowRight className="w-3 h-3" />
                </Link>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
