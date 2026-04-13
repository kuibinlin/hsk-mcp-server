// Per-IP rate limiting via Cloudflare Workers Rate Limiting binding.
// Returns a 429 Response when over limit, or null to continue.

import type { Env } from "../types.js";

export async function checkRateLimit(request: Request, env: Env): Promise<Response | null> {
  const ip = request.headers.get("cf-connecting-ip") ?? "unknown";

  const result = await env.RL.limit({ key: ip });
  if (!result.success) {
    return new Response(JSON.stringify({ error: "Rate limit exceeded" }), {
      status: 429,
      headers: {
        "content-type": "application/json",
        "retry-after": "60",
      },
    });
  }

  return null;
}
