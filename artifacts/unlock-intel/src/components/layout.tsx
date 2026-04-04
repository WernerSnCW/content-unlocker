import { Link, useLocation } from "wouter";
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
} from "lucide-react";

export function AppLayout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();

  const navItems = [
    { href: "/", label: "Dashboard", icon: LayoutDashboard },
    { href: "/recommend", label: "Recommendation Engine", icon: Sparkles },
    { href: "/call-prep", label: "Call Prep", icon: Phone },
    { href: "/leads", label: "Lead Management", icon: Users },
    { href: "/registry", label: "Document Registry", icon: FileText },
    { href: "/content-bank", label: "Content Bank", icon: Library },
    { href: "/changelog", label: "Changelog", icon: History },
    { href: "/generate", label: "Content Generation", icon: FileText },
    { href: "/gaps", label: "Content Gaps", icon: Grid3X3 },
    { href: "/feature-updates", label: "Feature Updates", icon: RefreshCw },
    { href: "/analytics/personas", label: "Persona Analytics", icon: BarChart3 },
    { href: "/acu", label: "Content Units", icon: Shield },
    { href: "/campaigns", label: "Campaigns", icon: Megaphone },
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

        <nav className="flex-1 py-6 px-3 space-y-1">
          {navItems.map((item) => {
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
              </Link>
            );
          })}
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
              />
            </div>
          </div>
          
          <div className="flex items-center gap-4">
            <button className="p-2 text-muted-foreground hover:text-foreground transition-colors relative">
              <Bell className="w-5 h-5" />
              <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-destructive rounded-full"></span>
            </button>
            <button className="p-2 text-muted-foreground hover:text-foreground transition-colors">
              <Settings className="w-5 h-5" />
            </button>
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
