import { useEffect, type ReactNode } from "react";
import { useLocation } from "wouter";
import { useCurrentUser, isAdmin } from "@/hooks/useCurrentUser";

/**
 * Gate for admin-only pages. Assumes ProtectedRoute has already run, so by
 * the time we get here the session probe has a result. Non-admins get
 * redirected to / with a small flash; admins see children.
 */
export function AdminOnlyRoute({ children }: { children: ReactNode }) {
  const { data, isLoading } = useCurrentUser();
  const [, setLocation] = useLocation();

  useEffect(() => {
    if (!isLoading && data && !isAdmin(data)) {
      setLocation("/");
    }
  }, [isLoading, data, setLocation]);

  if (isLoading || !data) {
    return (
      <div className="flex items-center justify-center min-h-[40vh] text-sm text-muted-foreground">
        Checking access…
      </div>
    );
  }

  if (!isAdmin(data)) {
    return null;
  }

  return <>{children}</>;
}
