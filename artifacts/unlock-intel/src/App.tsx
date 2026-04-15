import { AppLayout } from "./components/layout";
import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { AdminOnlyRoute } from "@/components/AdminOnlyRoute";
import NotFound from "@/pages/not-found";
import LoginPage from "@/pages/login";
import AdminAgentsPage from "@/pages/admin-agents";

import Dashboard from "./pages/dashboard";
import Recommend from "./pages/recommend";
import Leads from "./pages/leads";
import LeadDetail from "./pages/lead-detail";
import Registry from "./pages/registry";
import DocumentDetail from "./pages/document-detail";
import ContentBank from "./pages/content-bank";
import Changelog from "./pages/changelog";
import Generate from "./pages/generate";
import GapAnalysis from "./pages/gaps";
import FeatureUpdates from "./pages/feature-updates";
import CallPrep from "./pages/call-prep";
import PersonaAnalytics from "./pages/persona-analytics";
import ACUPage from "./pages/acu";
import CampaignsPage from "./pages/campaigns";
import CampaignDetailPage from "./pages/campaign-detail";
import ComplianceConstants from "./pages/compliance-constants";
import ImportPage from "./pages/import";
import TasksPage from "./pages/tasks";
import WorkQueue from "./pages/work-queue";
import DocumentHealth from "./pages/document-health";
import IntegrationSettings from "./pages/settings";
import ContactIngestion from "./pages/contact-ingestion";
import CallList from "./pages/call-list";
import CallCommand from "./pages/call-command";
import WebhookLog from "./pages/webhook-log";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      refetchOnWindowFocus: false,
    },
  },
});

function Router() {
  return (
    <Switch>
      {/* Public — /login is accessible without auth */}
      <Route path="/login" component={LoginPage} />

      {/* Everything else is gated: ProtectedRoute probes /api/auth/me and
          redirects to /login when unauthed. */}
      <Route>
        <ProtectedRoute>
          <AppLayout>
            <Switch>
              <Route path="/" component={CallCommand} />
              <Route path="/dashboard" component={Dashboard} />
              <Route path="/recommend" component={Recommend} />
              <Route path="/leads" component={Leads} />
              <Route path="/leads/:id" component={LeadDetail} />
              <Route path="/registry" component={Registry} />
              <Route path="/registry/:id" component={DocumentDetail} />
              <Route path="/content-bank" component={ContentBank} />
              <Route path="/changelog" component={Changelog} />
              <Route path="/generate" component={Generate} />
              <Route path="/gaps" component={GapAnalysis} />
              <Route path="/feature-updates" component={FeatureUpdates} />
              <Route path="/call-prep" component={CallPrep} />
              <Route path="/analytics/personas" component={PersonaAnalytics} />
              <Route path="/acu" component={ACUPage} />
              <Route path="/campaigns" component={CampaignsPage} />
              <Route path="/campaigns/:id" component={CampaignDetailPage} />
              <Route path="/compliance-constants" component={ComplianceConstants} />
              <Route path="/import" component={ImportPage} />
              <Route path="/tasks" component={TasksPage} />
              <Route path="/work-queue" component={WorkQueue} />
              <Route path="/document-health" component={DocumentHealth} />
              <Route path="/settings">
                <AdminOnlyRoute><IntegrationSettings /></AdminOnlyRoute>
              </Route>
              <Route path="/admin/agents">
                <AdminOnlyRoute><AdminAgentsPage /></AdminOnlyRoute>
              </Route>
              <Route path="/contacts/upload" component={ContactIngestion} />
              <Route path="/call-list" component={CallList} />
              <Route path="/webhook-log" component={WebhookLog} />
              <Route component={NotFound} />
            </Switch>
          </AppLayout>
        </ProtectedRoute>
      </Route>
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL?.replace(/\/$/, "") || ""}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
