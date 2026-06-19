import type { NextAuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import { PrismaAdapter } from "@next-auth/prisma-adapter";
import { prisma, isDatabaseConfigured } from "@/lib/prisma";

const providers: NextAuthOptions["providers"] = [];

if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
  providers.push(
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    }),
  );
}

export const authOptions: NextAuthOptions = {
  // Use Prisma adapter only when a DB is configured. Otherwise fall back to
  // JWT-only sessions so the site keeps working before infrastructure is set up.
  ...(isDatabaseConfigured && prisma
    ? { adapter: PrismaAdapter(prisma) as any }
    : {}),
  providers,
  session: { strategy: isDatabaseConfigured ? "database" : "jwt" },
  pages: {
    signIn: "/login",
  },
  callbacks: {
    async redirect({ url, baseUrl }) {
      if (url.startsWith("/")) return `${baseUrl}${url}`;
      if (new URL(url).origin === baseUrl) return url;
      return `${baseUrl}/dashboard`;
    },
    async session({ session, token, user }) {
      // With DB sessions, `user` is the Prisma User. With JWT, use `token`.
      if (user && session.user) {
        (session.user as any).id = user.id;
        (session.user as any).role = (user as any).role;
      } else if (token && session.user) {
        if (token.picture) session.user.image = token.picture as string;
      }
      return session;
    },
    async jwt({ token, account, profile }) {
      if (account && profile) {
        token.picture = (profile as { picture?: string }).picture;
      }
      return token;
    },
  },
};

export const isGoogleAuthConfigured =
  !!process.env.GOOGLE_CLIENT_ID && !!process.env.GOOGLE_CLIENT_SECRET;
