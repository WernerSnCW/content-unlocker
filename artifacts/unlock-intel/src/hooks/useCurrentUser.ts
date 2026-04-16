import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/apiClient";

export interface CurrentUser {
  user: {
    id: string;
    email: string;
    name: string | null;
    picture: string | null;
    role: "agent" | "admin";
  };
  agent: {
    id: string;
    name: string;
    email: string | null;
    aircall_user_id: number | null;
    dialer_mode: "manual" | "power_dialer";
    active: boolean;
  };
}

export function isAdmin(data: CurrentUser | null | undefined): boolean {
  return data?.user?.role === "admin";
}

/**
 * Session probe. Returns:
 *   data     — { user, agent } when authed
 *   isLoading — initial probe in flight
 *   error    — only for non-401 errors (401 returns data = null, no throw)
 *
 * Suppresses the global 401 redirect so ProtectedRoute can render a
 * redirect-to-/login instead (avoids redirect loops if /login itself mounts
 * this hook).
 */
export function useCurrentUser() {
  return useQuery<CurrentUser | null>({
    queryKey: ["currentUser"],
    queryFn: async () => {
      const res = await apiFetch("/api/auth/me", { redirectOn401: false });
      if (res.status === 401) return null;
      if (!res.ok) throw new Error(`auth/me returned ${res.status}`);
      return (await res.json()) as CurrentUser;
    },
    staleTime: 60_000,
    retry: false,
  });
}
