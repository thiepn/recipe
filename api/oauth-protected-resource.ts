function env(name: string): string {
  const value = (
    globalThis as {
      process?: { env?: Record<string, string | undefined> };
    }
  ).process?.env?.[name]?.trim();

  if (!value) throw new Error(`Missing server environment variable ${name}`);
  return value;
}

export async function GET(request: Request): Promise<Response> {
  const accountUrl = env("THIEPN_ACCOUNT_URL").replace(/\/$/, "");
  const resource = env("RECIPE_MCP_RESOURCE_URL");

  return Response.json(
    {
      resource,
      authorization_servers: [`${accountUrl}/auth/v1`],
      bearer_methods_supported: ["header"],
      scopes_supported: ["openid", "email", "profile", "offline_access"],
    },
    {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "public, max-age=300",
      },
    },
  );
}

export async function OPTIONS(): Promise<Response> {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Max-Age": "86400",
    },
  });
}
