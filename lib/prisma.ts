import { PrismaClient } from "@prisma/client";

declare global {
  // eslint-disable-next-line no-var
  var prismaGlobal: PrismaClient | undefined;
}

export const isDatabaseConfigured =
  !!process.env.DATABASE_URL || !!process.env.POSTGRES_PRISMA_URL;

// Singleton — avoid recreating client on every hot reload in dev.
// Returns null if no database is configured, so callers can fall back gracefully.
export const prisma = isDatabaseConfigured
  ? (global.prismaGlobal ??
    (global.prismaGlobal = new PrismaClient({
      log: process.env.NODE_ENV === "development" ? ["query", "error"] : ["error"],
    })))
  : null;
