import { createHmac, randomBytes } from "crypto";
import { AppEnv } from "../config";

export type OAuthProvider = "gmail" | "outlook";

interface OAuthStatePayload {
  businessId: string;
  provider: OAuthProvider;
  nonce: string;
  issuedAt: number;
}

interface OAuthTokenResult {
  accessToken: string;
  refreshToken: string | null;
  tokenType: string | null;
  scope: string | null;
  expiresAt: string | null;
}

interface OAuthProfileResult {
  email: string;
  externalAccountId: string | null;
  displayName: string | null;
}

function base64UrlEncode(value: string): string {
  return Buffer.from(value, "utf-8").toString("base64url");
}

function base64UrlDecode(value: string): string {
  return Buffer.from(value, "base64url").toString("utf-8");
}

function oauthConfig(provider: OAuthProvider, env: AppEnv) {
  if (provider === "gmail") {
    return {
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
      authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
      tokenUrl: "https://oauth2.googleapis.com/token",
      profileUrl: "https://www.googleapis.com/oauth2/v2/userinfo",
      scopes: [
        "openid",
        "email",
        "profile",
        "https://www.googleapis.com/auth/gmail.readonly",
      ],
    };
  }

  return {
    clientId: env.MICROSOFT_CLIENT_ID,
    clientSecret: env.MICROSOFT_CLIENT_SECRET,
    authorizeUrl: `https://login.microsoftonline.com/${env.MICROSOFT_TENANT_ID}/oauth2/v2.0/authorize`,
    tokenUrl: `https://login.microsoftonline.com/${env.MICROSOFT_TENANT_ID}/oauth2/v2.0/token`,
    profileUrl: "https://graph.microsoft.com/v1.0/me?$select=id,displayName,mail,userPrincipalName",
    scopes: [
      "openid",
      "profile",
      "email",
      "offline_access",
      "User.Read",
      "Mail.Read",
    ],
  };
}

export function isOAuthConfigured(provider: OAuthProvider, env: AppEnv): boolean {
  const config = oauthConfig(provider, env);
  return Boolean(config.clientId && config.clientSecret);
}

export function buildOAuthState(businessId: string, provider: OAuthProvider, env: AppEnv): string {
  const payload: OAuthStatePayload = {
    businessId,
    provider,
    nonce: randomBytes(12).toString("hex"),
    issuedAt: Date.now(),
  };
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signature = createHmac("sha256", env.OAUTH_STATE_SECRET).update(encodedPayload).digest("base64url");
  return `${encodedPayload}.${signature}`;
}

export function parseOAuthState(state: string, env: AppEnv): OAuthStatePayload | null {
  const [encodedPayload, signature] = state.split(".");
  if (!encodedPayload || !signature) {
    return null;
  }
  const expected = createHmac("sha256", env.OAUTH_STATE_SECRET).update(encodedPayload).digest("base64url");
  if (signature !== expected) {
    return null;
  }
  try {
    const payload = JSON.parse(base64UrlDecode(encodedPayload)) as OAuthStatePayload;
    const maxAgeMs = 10 * 60 * 1000;
    if (Date.now() - payload.issuedAt > maxAgeMs) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

export function buildOAuthStartUrl(provider: OAuthProvider, businessId: string, env: AppEnv): string {
  const config = oauthConfig(provider, env);
  if (!config.clientId) {
    throw new Error(`${provider} OAuth client id is not configured`);
  }
  const state = buildOAuthState(businessId, provider, env);
  const redirectUri = `${env.API_PUBLIC_BASE_URL}/api/oauth/${provider}/callback`;

  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: config.scopes.join(" "),
    state,
  });

  if (provider === "gmail") {
    params.set("access_type", "offline");
    params.set("prompt", "consent");
    params.set("include_granted_scopes", "true");
  }

  return `${config.authorizeUrl}?${params.toString()}`;
}

export async function exchangeOAuthCode(
  provider: OAuthProvider,
  code: string,
  env: AppEnv,
): Promise<OAuthTokenResult> {
  const config = oauthConfig(provider, env);
  if (!config.clientId || !config.clientSecret) {
    throw new Error(`${provider} OAuth credentials are not configured`);
  }
  const redirectUri = `${env.API_PUBLIC_BASE_URL}/api/oauth/${provider}/callback`;

  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    code,
    grant_type: "authorization_code",
    redirect_uri: redirectUri,
  });

  const response = await fetch(config.tokenUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`${provider} token exchange failed: ${text}`);
  }

  const payload = await response.json() as {
    access_token: string;
    refresh_token?: string;
    token_type?: string;
    scope?: string;
    expires_in?: number;
  };

  const expiresAt = payload.expires_in
    ? new Date(Date.now() + payload.expires_in * 1000).toISOString()
    : null;

  return {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token ?? null,
    tokenType: payload.token_type ?? null,
    scope: payload.scope ?? null,
    expiresAt,
  };
}

export async function fetchOAuthProfile(
  provider: OAuthProvider,
  accessToken: string,
  env: AppEnv,
): Promise<OAuthProfileResult> {
  const config = oauthConfig(provider, env);
  const response = await fetch(config.profileUrl, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`${provider} profile fetch failed: ${text}`);
  }

  if (provider === "gmail") {
    const payload = await response.json() as { id?: string; email?: string; name?: string };
    if (!payload.email) {
      throw new Error("Gmail profile missing email");
    }
    return {
      email: payload.email,
      externalAccountId: payload.id ?? null,
      displayName: payload.name ?? null,
    };
  }

  const payload = await response.json() as { id?: string; displayName?: string; mail?: string; userPrincipalName?: string };
  const email = payload.mail ?? payload.userPrincipalName;
  if (!email) {
    throw new Error("Outlook profile missing email");
  }
  return {
    email,
    externalAccountId: payload.id ?? null,
    displayName: payload.displayName ?? null,
  };
}

// ─── token refresh ───

export async function refreshAccessToken(
  provider: OAuthProvider,
  refreshToken: string,
  env: AppEnv,
): Promise<OAuthTokenResult> {
  const config = oauthConfig(provider, env);
  if (!config.clientId || !config.clientSecret) {
    throw new Error(`${provider} OAuth credentials are not configured`);
  }
  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });

  const response = await fetch(config.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`${provider} token refresh failed: ${text}`);
  }

  const payload = await response.json() as {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
  };

  return {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token ?? null,
    tokenType: null,
    scope: null,
    expiresAt: payload.expires_in
      ? new Date(Date.now() + payload.expires_in * 1000).toISOString()
      : null,
  };
}

export async function getValidAccessToken(
  oauthConnection: {
    id: string;
    provider: OAuthProvider;
    accessToken: string;
    refreshToken: string | null;
    expiresAt: string | null;
  },
  storeInstance: {
    updateOAuthTokens: (id: string, tokens: { accessToken: string; refreshToken: string | null; expiresAt: string | null }) => any;
  },
  appEnv: AppEnv,
): Promise<string> {
  if (oauthConnection.expiresAt) {
    const expiryMs = new Date(oauthConnection.expiresAt).getTime();
    if (Date.now() < expiryMs - 5 * 60 * 1000) {
      return oauthConnection.accessToken;
    }
  }

  if (!oauthConnection.refreshToken) {
    throw new Error("Token expired and no refresh token available");
  }

  const refreshed = await refreshAccessToken(
    oauthConnection.provider,
    oauthConnection.refreshToken,
    appEnv,
  );

  await storeInstance.updateOAuthTokens(oauthConnection.id, {
    accessToken: refreshed.accessToken,
    refreshToken: refreshed.refreshToken ?? oauthConnection.refreshToken,
    expiresAt: refreshed.expiresAt,
  });

  return refreshed.accessToken;
}
