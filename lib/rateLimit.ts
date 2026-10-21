/**
 * Tiny in-memory sliding-window limiter. Per server instance only — it blunts
 * bursts from one client hitting a warm instance; durable limits belong in the
 * DB. Returns true when the hit is allowed (and records it).
 */
const buckets = new Map<string, number[]>();

export function allowHit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const hits = (buckets.get(key) ?? []).filter((t) => now - t < windowMs);
  const allowed = hits.length < limit;
  if (allowed) hits.push(now);
  buckets.set(key, hits);

  // Keep memory bounded: drop idle keys once the map grows.
  if (buckets.size > 5000) {
    for (const [k, v] of buckets) {
      if (!v.length || now - v[v.length - 1] >= windowMs) buckets.delete(k);
    }
  }
  return allowed;
}

/** Best-effort client IP behind Vercel's proxy (which sets these headers). */
export function clientIp(headers: Headers): string {
  const real = headers.get("x-real-ip")?.trim();
  if (real) return real;
  const fwd = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return fwd || "unknown";
}
