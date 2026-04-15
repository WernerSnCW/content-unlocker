import { useEffect, useState } from "react";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { apiFetch, apiPost } from "@/lib/apiClient";

interface DevModeResponse {
  enabled: boolean;
  agents?: Array<{ id: string; name: string; email: string | null }>;
}

/**
 * Minimal login screen. The "Sign in with Google" button links to
 * /api/auth/google, which initiates the OIDC redirect flow. Everything
 * (state, nonce, PKCE) is handled on the server.
 *
 * If already authed, bounces to returnTo (or /).
 */
export default function LoginPage() {
  const { data, isLoading } = useCurrentUser();
  const [devMode, setDevMode] = useState<DevModeResponse>({ enabled: false });
  const [devAgentId, setDevAgentId] = useState<string>("");
  const [devSubmitting, setDevSubmitting] = useState(false);
  const [devError, setDevError] = useState<string | null>(null);

  // One-time localStorage cleanup — removes leftover agent-picker state
  // from the pre-SSO era so there's nothing stale to confuse us.
  useEffect(() => {
    try {
      localStorage.removeItem("activeAgentId");
    } catch { /* ignore */ }
  }, []);

  // Probe dev-mode to decide whether to render the quick-login form.
  // Returns { enabled: false } in production regardless — safe to call always.
  useEffect(() => {
    (async () => {
      try {
        const res = await apiFetch("/api/auth/dev-mode", { redirectOn401: false });
        if (res.ok) {
          const body = (await res.json()) as DevModeResponse;
          setDevMode(body);
          if (body.enabled && body.agents && body.agents.length > 0) {
            setDevAgentId(body.agents[0].id);
          }
        }
      } catch { /* ignore */ }
    })();
  }, []);

  useEffect(() => {
    if (data) {
      const params = new URLSearchParams(window.location.search);
      const returnTo = params.get("returnTo") || "/";
      window.location.href = returnTo;
    }
  }, [data]);

  const returnToParam = (() => {
    const params = new URLSearchParams(window.location.search);
    const rt = params.get("returnTo");
    return rt ? `?returnTo=${encodeURIComponent(rt)}` : "";
  })();

  const handleDevLogin = async () => {
    if (!devAgentId) return;
    setDevSubmitting(true);
    setDevError(null);
    try {
      const res = await apiPost("/api/auth/dev-login", { agent_id: devAgentId }, { redirectOn401: false });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setDevError(body?.error || `Dev login failed (${res.status})`);
        return;
      }
      const params = new URLSearchParams(window.location.search);
      const returnTo = params.get("returnTo") || "/";
      window.location.href = returnTo;
    } catch (err: any) {
      setDevError(err?.message || "Dev login failed");
    } finally {
      setDevSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-6">
      <div className="w-full max-w-sm space-y-6 rounded-lg border border-border bg-card p-8 shadow-sm">
        <div className="space-y-2 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">Sign in</h1>
          <p className="text-sm text-muted-foreground">
            Use your work Google account to sign in.
          </p>
        </div>

        <Button
          asChild
          size="lg"
          className="w-full"
          disabled={isLoading}
        >
          <a href={`/api/auth/google${returnToParam}`}>
            <svg className="mr-2 h-4 w-4" viewBox="0 0 24 24" aria-hidden="true">
              <path
                fill="currentColor"
                d="M21.35 11.1h-9.17v2.73h6.51c-.33 3.81-3.5 5.44-6.5 5.44C8.36 19.27 5 16.25 5 12c0-4.1 3.2-7.27 7.2-7.27 3.09 0 4.9 1.97 4.9 1.97l1.9-1.97C17.45 3.58 15.03 2.5 12.2 2.5 6.95 2.5 2.5 6.95 2.5 12c0 4.95 4.15 9.5 9.75 9.5 5.41 0 9.25-3.71 9.25-9.26 0-.73-.1-1.14-.15-1.14Z"
              />
            </svg>
            Sign in with Google
          </a>
        </Button>

        <p className="text-center text-xs text-muted-foreground">
          Only registered agent emails are permitted. If your email isn't
          recognised, ask an admin to add you.
        </p>

        {devMode.enabled && (
          <div className="mt-2 pt-5 border-t border-dashed border-amber-500/40 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wide text-amber-600">
                Dev quick login
              </span>
              <span className="text-[10px] rounded bg-amber-500/15 text-amber-700 px-1.5 py-0.5">
                not for production
              </span>
            </div>
            <p className="text-xs text-muted-foreground">
              Pick an agent to sign in as without Google. Enabled by
              <code className="mx-1 rounded bg-muted px-1 py-0.5 font-mono text-[10px]">
                ALLOW_DEV_LOGIN=true
              </code>
              in this environment.
            </p>

            <Select value={devAgentId} onValueChange={setDevAgentId}>
              <SelectTrigger>
                <SelectValue placeholder="Select agent..." />
              </SelectTrigger>
              <SelectContent>
                {(devMode.agents || []).map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.name} {a.email ? `(${a.email})` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Button
              type="button"
              variant="outline"
              className="w-full border-amber-500/60 hover:bg-amber-500/10"
              onClick={handleDevLogin}
              disabled={!devAgentId || devSubmitting}
            >
              {devSubmitting ? "Signing in…" : "Sign in as selected agent"}
            </Button>

            {devError && (
              <p className="text-xs text-destructive">{devError}</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
