import { randomBytes, scrypt, timingSafeEqual } from "crypto";
import { promisify } from "util";

// Password hashing without a third-party dependency. Node's built-in scrypt is
// a memory-hard KDF suitable for password storage and runs in the standard Node
// serverless runtime (no native builds, works on Vercel). Stored format is
// `salt:derivedKey`, both hex-encoded.

const scryptAsync = promisify(scrypt);
const KEY_LENGTH = 64;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const derived = (await scryptAsync(password, salt, KEY_LENGTH)) as Buffer;
  return `${salt}:${derived.toString("hex")}`;
}

export async function verifyPassword(
  password: string,
  stored: string,
): Promise<boolean> {
  const [salt, key] = stored.split(":");
  if (!salt || !key) return false;
  const derived = (await scryptAsync(password, salt, KEY_LENGTH)) as Buffer;
  const keyBuffer = Buffer.from(key, "hex");
  // Guard against length mismatch — timingSafeEqual throws on unequal lengths.
  if (keyBuffer.length !== derived.length) return false;
  return timingSafeEqual(keyBuffer, derived);
}
