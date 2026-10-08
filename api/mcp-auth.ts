interface AccountUser {
  id?: unknown;
}

interface TokenClaims {
  iss?: unknown;
  sub?: unknown;
  exp?: unknown;
  client_id?: unknown;
  scope?: unknown;
  aud?: unknown;
  resource?: unknown;
}

const REQUIRED_SCOPES = [
  "openid",
  "email",
  "profile",
  "offline_access",
] as const;

export interface VerifiedRecipeMcpIdentity {
  token: string;
  userId: string;
  clientId: string;
  scopes: readonly string[];
}

function env(name: string): string {
  const value = (
    globalThis as {
      process?: { env?: Record<string, string | undefined> };
    }
  ).process?.env?.[name]?.trim();

  if (!value) throw new Error(`Missing server environment variable ${name}`);
  return value;
}

function base64UrlDecode(input: string): string {
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  return atob(padded);
}

function tokenClaims(token: string): TokenClaims | null {
  const parts = token.split(".");
  if (parts.length !== 3 || !parts[1]) return null;

  try {
    const value = JSON.parse(base64UrlDecode(parts[1])) as unknown;
    return value && typeof value === "object"
      ? (value as TokenClaims)
      : null;
  } catch {
    return null;
  }
}

function audienceIncludes(value: unknown, expected: string): boolean {
  if (typeof value === "string") return value === expected;
  return (
    Array.isArray(value) &&
    value.some((item) => typeof item === "string" && item === expected)
  );
}

function scopes(value: unknown): readonly string[] {
  if (typeof value === "string") {
    return value
      .split(/\s+/)
      .map((item) => item.trim())
      .filter(Boolean);
  }
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string");
  }
  return [];
}

function uuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  );
}

function unavailable(): Response {
  return Response.json(
    {
      error: "temporarily_unavailable",
      error_description: "THIEPN Account authentication is unavailable.",
    },
    {
      status: 503,
      headers: {
        "Cache-Control": "no-store",
        "Retry-After": "5",
      },
    },
  );
}

function unauthorized(request: Request, code = "invalid_token"): Response {
  const resourceMetadata = new URL("/.well-known/oauth-protected-resource", request.url).href;

  return Response.json(
    {
      error: code,
      error_description: "A valid THIEPN Account Recipe OAuth token is required.",
    },
    {
      status: 401,
      headers: {
        "Cache-Control": "no-store",
        "WWW-Authenticate": `Bearer resource_metadata="${resourceMetadata}", scope="openid email profile offline_access", error="${code}"`,
      },
    },
  );
}

export async function verifyRecipeMcpRequest(
  request: Request,
): Promise<VerifiedRecipeMcpIdentity | Response> {
  const header = request.headers.get("Authorization")?.trim() ?? "";
  if (!header.startsWith("Bearer ") || header.length <= 7) {
    return unauthorized(request);
  }

  const token = header.slice(7).trim();
  if (!token || token.length > 16_384) return unauthorized(request);

  const claims = tokenClaims(token);
  if (!claims) return unauthorized(request);

  let accountUrl: string;
  let publishableKey: string;
  try {
    accountUrl = env("THIEPN_ACCOUNT_URL").replace(/\/$/, "");
    publishableKey = env("THIEPN_ACCOUNT_PUBLISHABLE_KEY");
  } catch {
    return unavailable();
  }

  const expectedIssuer = `${accountUrl}/auth/v1`;
  const expectedResource = env("RECIPE_MCP_RESOURCE_URL");
  if (new URL(request.url).origin !== new URL(expectedResource).origin || new URL(request.url).pathname !== new URL(expectedResource).pathname) return unauthorized(request);
  const grantedScopes = scopes(claims.scope);

  if (
    claims.iss !== expectedIssuer ||
    !audienceIncludes(claims.aud, expectedResource) ||
    claims.resource !== expectedResource ||
    !uuid(claims.sub) ||
    !uuid(claims.client_id) ||
    typeof claims.exp !== "number" ||
    claims.exp <= Math.floor(Date.now() / 1000)
  ) {
    return unauthorized(request);
  }

  if (!REQUIRED_SCOPES.every((scope) => grantedScopes.includes(scope))) {
    return unauthorized(request, "insufficient_scope");
  }

  try {
    const response = await fetch(new URL("/auth/v1/user", accountUrl), {
      method: "GET",
      headers: {
        Accept: "application/json",
        apikey: publishableKey,
        Authorization: `Bearer ${token}`,
      },
      redirect: "manual",
      signal: AbortSignal.timeout(5_000),
    });

    if (!response.ok) return unauthorized(request);

    const user = (await response.json()) as AccountUser;
    if (!uuid(user.id) || user.id !== claims.sub) {
      return unauthorized(request);
    }

    return {
      token,
      userId: user.id,
      clientId: claims.client_id,
      scopes: grantedScopes,
    };
  } catch {
    return unavailable();
  }
}
