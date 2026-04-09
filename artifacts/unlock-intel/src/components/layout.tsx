import { useState, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { Badge } from "@/components/ui/badge";
import { 
  LayoutDashboard, 
  Users, 
  FileText, 
  Library, 
  History, 
  Sparkles,
  Search,
  Settings,
  Bell,
  Grid3X3,
  RefreshCw,
  Phone,
  BarChart3,
  Shield,
  Megaphone,
  ShieldCheck,
  Upload,
  CheckSquare,
  Zap,
  FileSearch,
} from "lucide-react";

const API_BASE =
  (import.meta.env.BASE_URL?.replace(/\/$/, "") || "") + "/api";

export function AppLayout({ children }: { children: React.ReactNode }) {
  const [location, setLocation] = useLocation();
  const [openReviewCount, setOpenReviewCount] = useState<number>(0);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [searchOpen, setSearchOpen] = useState(false);

  useEffect(() => {
    const fetchCount = async () => {
      try {
        const res = await fetch(`${API_BASE}/tasks`);
        const data = await res.json();
        const count = (data.tasks || []).filter(
          (t: any) => t.status === "Open" && t.type === "Review"
        ).length;
        setOpenReviewCount(count);
      } catch { /* silent */ }
    };
    fetchCount();
  }, []);

  const handleSearch = async (query: string) => {
    setSearchQuery(query);
    if (!query.trim()) {
      setSearchResults([]);
      setSearchOpen(false);
      return;
    }
    setSearchOpen(true);
    try {
      const [leadsRes, docsRes] = await Promise.all([
        fetch(`${API_BASE}/leads`),
        fetch(`${API_BASE}/documents`),
      ]);
      const leadsData = await leadsRes.json();
      const docsData = await docsRes.json();
      const q = query.toLowerCase();
      const matchedLeads = (leadsData.leads || [])
        .filter((l: any) => l.name?.toLowerCase().includes(q) || l.company?.toLowerCase().includes(q))
        .slice(0, 5)
        .map((l: any) => ({ type: "lead", id: l.id, label: l.name, sub: l.company || l.pipeline_stage, href: `/leads/${l.id}` }));
      const matchedDocs = (docsData || [])
        .filter((d: any) => d.name?.toLowerCase().includes(q) || d.file_code?.toLowerCase().includes(q))
        .slice(0, 5)
        .map((d: any) => ({ type: "document", id: d.id, label: d.name, sub: d.type, href: `/registry/${d.id}` }));
      setSearchResults([...matchedLeads, ...matchedDocs]);
    } catch { setSearchResults([]); }
  };

  const navGroups = [
    {
      label: "Operations",
      items: [
        { href: "/", label: "Dashboard", icon: LayoutDashboard },
        { href: "/recommend", label: "Recommendation Engine", icon: Sparkles },
        { href: "/call-prep", label: "Call Prep", icon: Phone },
        { href: "/leads", label: "Lead Management", icon: Users },
        { href: "/tasks", label: "Task Board", icon: CheckSquare },
        { href: "/work-queue", label: "Work Queue", icon: Zap },
      ],
    },
    {
      label: "Content",
      items: [
        { href: "/content-bank", label: "Content Bank", icon: Library },
        { href: "/gaps", label: "Content Gaps", icon: Grid3X3 },
        { href: "/generate", label: "Content Generation", icon: FileText },
        { href: "/registry", label: "Document Registry", icon: FileText },
        { href: "/document-health", label: "Document Health", icon: FileSearch },
        { href: "/import", label: "Import Content", icon: Upload },
        { href: "/feature-updates", label: "Feature Updates", icon: RefreshCw },
      ],
    },
    {
      label: "Governance",
      items: [
        { href: "/acu", label: "Content Units", icon: Shield },
        { href: "/campaigns", label: "Campaigns", icon: Megaphone },
        { href: "/analytics/personas", label: "Persona Analytics", icon: BarChart3 },
      ],
    },
    {
      label: "System",
      items: [
        { href: "/changelog", label: "Changelog", icon: History },
        { href: "/compliance-constants", label: "Compliance Constants", icon: ShieldCheck },
      ],
    },
  ];

  return (
    <div className="min-h-screen w-full bg-background text-foreground flex">
      {/* Sidebar */}
      <aside className="w-64 flex-shrink-0 bg-sidebar border-r border-sidebar-border flex flex-col">
        <div className="h-16 flex items-center px-6 border-b border-sidebar-border">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 bg-sidebar-primary rounded flex items-center justify-center">
              <span className="text-sidebar-primary-foreground font-bold text-xs">U</span>
            </div>
            <span className="font-semibold text-sidebar-foreground tracking-tight">Unlock</span>
          </div>
        </div>

        <nav className="flex-1 py-4 px-3 space-y-4 overflow-y-auto">
          {navGroups.map((group) => (
            <div key={group.label}>
              <p className="px-3 mb-1 text-xs font-semibold uppercase tracking-wider text-sidebar-foreground/40">
                {group.label}
              </p>
              <div className="space-y-0.5">
                {group.items.map((item) => {
                  const isActive = location === item.href || (item.href !== "/" && location.startsWith(item.href));
                  const Icon = item.icon;
                  return (
                    <Link key={item.href} href={item.href} className={`flex items-center gap-3 px-3 py-2 text-sm font-medium rounded-md transition-colors ${
                        isActive
                          ? "bg-sidebar-accent text-sidebar-accent-foreground"
                          : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
                      }`}>
                        <Icon className="w-4 h-4" />
                        {item.label}
                        {item.href === "/work-queue" && openReviewCount > 0 && (
                          <Badge variant="destructive" className="ml-auto text-xs px-1.5 py-0">
                            {openReviewCount}
                          </Badge>
                        )}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        <div className="p-4 border-t border-sidebar-border">
          <div className="flex items-center gap-3 px-3 py-2 text-sm font-medium text-sidebar-foreground/70">
            <div className="w-8 h-8 bg-sidebar-accent rounded-full flex items-center justify-center">
              JD
            </div>
            <div className="flex flex-col">
              <span className="text-sidebar-foreground">John Doe</span>
              <span className="text-xs opacity-70">john@unlock.com</span>
            </div>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col h-screen overflow-hidden">
        {/* Header */}
        <header className="h-16 flex-shrink-0 border-b bg-card flex items-center justify-between px-8">
          <div className="flex items-center gap-4 flex-1">
            <div className="relative w-96">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <input 
                type="text" 
                placeholder="Search leads, documents, or content..." 
                className="w-full bg-muted/50 border-none rounded-md pl-10 pr-4 py-1.5 text-sm focus:ring-1 focus:ring-primary focus:bg-background transition-colors"
                value={searchQuery}
                onChange={(e) => handleSearch(e.target.value)}
                onBlur={() => setTimeout(() => setSearchOpen(false), 200)}
                onFocus={() => searchQuery.trim() && setSearchOpen(true)}
              />
              {searchOpen && searchResults.length > 0 && (
                <div className="absolute top-full left-0 w-full mt-1 bg-popover border rounded-md shadow-lg z-50 max-h-72 overflow-y-auto">
                  {searchResults.map(r => (
                    <button
                      key={`${r.type}-${r.id}`}
                      className="w-full px-3 py-2 text-left text-sm hover:bg-accent flex items-center gap-3 border-b last:border-0"
                      onMouseDown={() => {
                        setLocation(r.href);
                        setSearchOpen(false);
                        setSearchQuery("");
                      }}
                    >
                      {r.type === "lead" ? <Users className="w-4 h-4 text-muted-foreground shrink-0" /> : <FileText className="w-4 h-4 text-muted-foreground shrink-0" />}
                      <div className="min-w-0">
                        <div className="font-medium truncate">{r.label}</div>
                        <div className="text-xs text-muted-foreground truncate">{r.sub}</div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
              {searchOpen && searchResults.length === 0 && searchQuery.trim() && (
                <div className="absolute top-full left-0 w-full mt-1 bg-popover border rounded-md shadow-lg z-50 px-3 py-2 text-sm text-muted-foreground">
                  No results found
                </div>
              )}
            </div>
          </div>
          
          <div className="flex items-center gap-4">
            <Link href="/tasks" className="p-2 text-muted-foreground hover:text-foreground transition-colors relative">
              <Bell className="w-5 h-5" />
              {openReviewCount > 0 && (
                <span className="absolute top-1 right-1 min-w-[14px] h-[14px] bg-destructive rounded-full text-[9px] text-white flex items-center justify-center font-bold">
                  {openReviewCount}
                </span>
              )}
            </Link>
            <Link href="/settings" className="p-2 text-muted-foreground hover:text-foreground transition-colors">
              <Settings className="w-5 h-5" />
            </Link>
          </div>
        </header>

        {/* Scrollable Area */}
        <div className="flex-1 overflow-auto p-8">
          {children}
        </div>
      </main>
    </div>
  );
}
