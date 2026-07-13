import type { DefaultSession } from "next-auth";

// Augment NextAuth types so the id/role we thread through the jwt + session
// callbacks (lib/auth.ts) are typed rather than cast to `any`.

declare module "next-auth" {
  interface Session {
    user: {
      id?: string;
      role?: string;
    } & DefaultSession["user"];
  }

  interface User {
    role?: string;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id?: string;
    role?: string;
  }
}
