import { AppLayout } from "./components/layout";
import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";

import Dashboard from "./pages/dashboard";
import Recommend from "./pages/recommend";
import Leads from "./pages/leads";
import LeadDetail from "./pages/lead-detail";
import Registry from "./pages/registry";
import DocumentDetail from "./pages/document-detail";
import ContentBank from "./pages/content-bank";
import Changelog from "./pages/changelog";
import Generate from "./pages/generate";

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
    <AppLayout>
      <Switch>
        <Route path="/" component={Dashboard} />
        <Route path="/recommend" component={Recommend} />
        <Route path="/leads" component={Leads} />
        <Route path="/leads/:id" component={LeadDetail} />
        <Route path="/registry" component={Registry} />
        <Route path="/registry/:id" component={DocumentDetail} />
        <Route path="/content-bank" component={ContentBank} />
        <Route path="/changelog" component={Changelog} />
        <Route path="/generate" component={Generate} />
        <Route component={NotFound} />
      </Switch>
    </AppLayout>
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
