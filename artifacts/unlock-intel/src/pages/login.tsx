import { useEffect } from "react";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { Button } from "@/components/ui/button";

/**
 * Minimal login screen. The "Sign in with Google" button links to
 * /api/auth/google, which initiates the OIDC redirect flow. Everything
 * (state, nonce, PKCE) is handled on the server.
 *
 * If already authed, bounces to returnTo (or /).
 */
export default function LoginPage() {
  const { data, isLoading } = useCurrentUser();

  // One-time localStorage cleanup — removes leftover agent-picker state
  // from the pre-SSO era so there's nothing stale to confuse us.
  useEffect(() => {
    try {
      localStorage.removeItem("activeAgentId");
    } catch { /* ignore */ }
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
      </div>
    </div>
  );
}
