import crypto from "crypto";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";

// Plaintext token shape: adv_live_sk_<43 url-safe chars>. We store only the
// SHA-256 hash; the plaintext is returned to the creator exactly once.
const TOKEN_PREFIX = "adv_live_sk_";

export function generateApiKey(): { token: string; prefix: string; hashedKey: string } {
  const secret = crypto.randomBytes(32).toString("base64url"); // 43 chars
  const token = `${TOKEN_PREFIX}${secret}`;
  return { token, prefix: token.slice(0, 16), hashedKey: hashApiKey(token) };
}

export function hashApiKey(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

/** Pull the bearer token from Authorization / x-api-key / ?key=. */
export function extractApiKey(req: NextRequest): string | null {
  const auth = req.headers.get("authorization");
  if (auth?.startsWith("Bearer ")) return auth.slice(7).trim();
  const header = req.headers.get("x-api-key");
  if (header) return header.trim();
  const q = new URL(req.url).searchParams.get("key");
  return q ? q.trim() : null;
}

export type AuthedKey = {
  id: string;
  name: string;
  scopes: string[];
};

/**
 * Authenticate a request by its API key. Returns the key record (with scopes)
 * on success, or null if missing/invalid/revoked. Touches lastUsedAt.
 */
export async function authenticateApiKey(req: NextRequest): Promise<AuthedKey | null> {
  const token = extractApiKey(req);
  if (!token || !prisma) return null;

  const hashedKey = hashApiKey(token);
  const key = await prisma.apiKey.findUnique({ where: { hashedKey } });
  if (!key || key.revokedAt) return null;

  // Fire-and-forget usage stamp; never let it block the request.
  prisma.apiKey
    .update({ where: { id: key.id }, data: { lastUsedAt: new Date() } })
    .catch(() => {});

  return { id: key.id, name: key.name, scopes: key.scopes };
}

export function hasScope(key: AuthedKey, scope: string): boolean {
  return key.scopes.includes(scope) || key.scopes.includes("*");
}
