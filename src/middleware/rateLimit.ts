// Per-IP rate limiting: RL binding (primary) → KV counter (fallback) + daily cap.
// Returns a 429 Response when over limit, or null to continue.

import type { Env } from "../types.js";

const PER_MINUTE_LIMIT = 30;
const DAILY_LIMIT = 5000;

/**
 * Check rate limits for the incoming request.
 * Returns a 429 Response if the caller is over limit, or null if the request should proceed.
 */
export async function checkRateLimit(request: Request, env: Env): Promise<Response | null> {
  const ip = request.headers.get("cf-connecting-ip") ?? "unknown";

  // Primary: Workers Rate Limiting binding
  if ("RL" in env && typeof (env as RLEnv).RL?.limit === "function") {
    try {
      const result = await (env as RLEnv).RL.limit({ key: ip });
      if (!result.success) return tooMany();
    } catch {
      // Binding unavailable — fall through to KV
    }
  }

  // Fallback: KV per-minute counter
  if (env.RL_KV) {
    const minuteKey = `rl:${ip}:${Math.floor(Date.now() / 60_000)}`;
    const count = Number(await env.RL_KV.get(minuteKey)) || 0;
    if (count >= PER_MINUTE_LIMIT) return tooMany();
    await env.RL_KV.put(minuteKey, String(count + 1), { expirationTtl: 120 });

    // Daily cap (one KV write per IP per day max)
    const day = new Date().toISOString().slice(0, 10);
    const dailyKey = `rl:daily:${ip}:${day}`;
    const daily = Number(await env.RL_KV.get(dailyKey)) || 0;
    if (daily >= DAILY_LIMIT) return tooMany();
    if (daily === 0 || count === 0) {
      // Only write daily counter on first request or first of the minute
      await env.RL_KV.put(dailyKey, String(daily + 1), { expirationTtl: 86400 });
    }
  }

  return null;
}

function tooMany(): Response {
  return new Response(
    JSON.stringify({ error: "Rate limit exceeded" }),
    {
      status: 429,
      headers: {
        "content-type": "application/json",
        "retry-after": "60",
      },
    },
  );
}

// The RL binding type isn't in @cloudflare/workers-types yet on all plans.
interface RLEnv extends Env {
  RL: { limit: (opts: { key: string }) => Promise<{ success: boolean }> };
}
