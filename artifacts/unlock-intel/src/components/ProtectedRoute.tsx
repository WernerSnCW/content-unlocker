import { useEffect, type ReactNode } from "react";
import { useLocation } from "wouter";
import { useCurrentUser } from "@/hooks/useCurrentUser";

/**
 * Gate that renders children only when an authenticated session exists.
 * On first mount, probes /api/auth/me:
 *   - authed   → renders children
 *   - unauthed → redirects to /login?returnTo=<current path>
 *   - loading  → renders a subtle placeholder
 *   - error    → renders an error message (rare; network issue)
 */
export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { data, isLoading, error } = useCurrentUser();
  const [location, setLocation] = useLocation();

  useEffect(() => {
    if (!isLoading && !data && !error) {
      const returnTo = encodeURIComponent(location);
      setLocation(`/login?returnTo=${returnTo}`);
    }
  }, [isLoading, data, error, location, setLocation]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[40vh] text-sm text-muted-foreground">
        Checking session…
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-[40vh] text-sm text-destructive">
        Couldn't verify session. Please refresh or try logging in again.
      </div>
    );
  }

  if (!data) {
    // Redirect effect is firing; render nothing briefly.
    return null;
  }

  return <>{children}</>;
}
