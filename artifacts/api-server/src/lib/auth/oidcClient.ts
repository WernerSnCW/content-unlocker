import * as client from "openid-client";
import { logger } from "../logger";

/**
 * Google OIDC client configuration.
 *
 * Env vars required:
 *   GOOGLE_CLIENT_ID        OAuth 2.0 Client ID from GCP Console
 *   GOOGLE_CLIENT_SECRET    OAuth 2.0 Client Secret
 *   APP_URL                 Base URL (e.g., https://content-unlocker.replit.app)
 *                           Used to build redirect_uri.
 * Optional:
 *   GOOGLE_WORKSPACE_DOMAIN Hint (hd=) to constrain sign-in to one Workspace
 *                           domain. Our access gate (email ∈ agents.email)
 *                           enforces the real rule; this just makes the UI
 *                           cleaner for users.
 */

export interface OidcContext {
  config: client.Configuration;
  redirectUri: string;
  workspaceDomain: string | null;
}

let cached: OidcContext | null = null;

export async function getOidcContext(): Promise<OidcContext> {
  if (cached) return cached;

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const appUrl = process.env.APP_URL;

  if (!clientId || !clientSecret || !appUrl) {
    throw new Error(
      "Missing required auth env vars: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, APP_URL",
    );
  }

  const issuer = new URL("https://accounts.google.com");
  const config = await client.discovery(issuer, clientId, clientSecret);

  const redirectUri = `${appUrl.replace(/\/$/, "")}/api/auth/callback`;

  cached = {
    config,
    redirectUri,
    workspaceDomain: process.env.GOOGLE_WORKSPACE_DOMAIN || null,
  };

  logger.info({ redirectUri, workspaceDomain: cached.workspaceDomain }, "OIDC client ready");
  return cached;
}

/**
 * Build the Google consent URL with state + PKCE verifier.
 * Caller is responsible for persisting { state, codeVerifier, nonce } in the
 * session so the callback handler can validate them.
 */
export async function buildAuthorizationUrl(): Promise<{
  url: string;
  state: string;
  codeVerifier: string;
  nonce: string;
}> {
  const ctx = await getOidcContext();
  const state = client.randomState();
  const nonce = client.randomNonce();
  const codeVerifier = client.randomPKCECodeVerifier();
  const codeChallenge = await client.calculatePKCECodeChallenge(codeVerifier);

  const params: Record<string, string> = {
    redirect_uri: ctx.redirectUri,
    scope: "openid email profile",
    state,
    nonce,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    // access_type=offline + prompt=consent would grant a refresh_token but are
    // NOT needed for MVP (just logging in). Add them when Calendar scope lands.
  };

  if (ctx.workspaceDomain) {
    params.hd = ctx.workspaceDomain;
  }

  const url = client.buildAuthorizationUrl(ctx.config, params);
  return { url: url.href, state, codeVerifier, nonce };
}

/**
 * Exchange the authorization code for tokens and verify the ID token.
 * Returns the validated token claims + raw tokens.
 */
export async function exchangeCode(
  currentUrl: URL,
  expected: { state: string; codeVerifier: string; nonce: string },
): Promise<{
  sub: string;
  email: string;
  email_verified: boolean;
  name?: string;
  picture?: string;
  hd?: string; // Workspace domain
  accessToken?: string;
  refreshToken?: string;
  expiresIn?: number;
  scopes?: string;
}> {
  const ctx = await getOidcContext();

  const tokens = await client.authorizationCodeGrant(ctx.config, currentUrl, {
    pkceCodeVerifier: expected.codeVerifier,
    expectedState: expected.state,
    expectedNonce: expected.nonce,
  });

  const claims = tokens.claims();
  if (!claims) throw new Error("No ID token claims returned");

  const email = claims.email as string | undefined;
  const emailVerified = claims.email_verified as boolean | undefined;
  if (!email) throw new Error("No email in ID token");
  if (!emailVerified) throw new Error("Email not verified by Google");

  return {
    sub: String(claims.sub),
    email: email.toLowerCase(),
    email_verified: !!emailVerified,
    name: claims.name as string | undefined,
    picture: claims.picture as string | undefined,
    hd: claims.hd as string | undefined,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    expiresIn: tokens.expires_in,
    scopes: tokens.scope,
  };
}
