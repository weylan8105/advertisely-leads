import type { NextAuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import CredentialsProvider from "next-auth/providers/credentials";
import { PrismaAdapter } from "@next-auth/prisma-adapter";
import { prisma, isDatabaseConfigured } from "@/lib/prisma";
import { verifyPassword } from "@/lib/password";

const providers: NextAuthOptions["providers"] = [];

if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
  providers.push(
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    }),
  );
}

// Email/password sign-in. Only registered when a database is configured, since
// it needs to look up the stored password hash. Users are created via
// /api/auth/register.
if (isDatabaseConfigured && prisma) {
  providers.push(
    CredentialsProvider({
      name: "Email and password",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        const email = credentials?.email?.toLowerCase().trim();
        const password = credentials?.password;
        if (!email || !password) return null;

        const user = await prisma!.user.findUnique({ where: { email } });
        // No user, or an OAuth-only account with no password set.
        if (!user || !user.passwordHash) return null;

        const valid = await verifyPassword(password, user.passwordHash);
        if (!valid) return null;

        return {
          id: user.id,
          name: user.name,
          email: user.email,
          image: user.image,
          role: user.role,
        } as { id: string; name: string | null; email: string; image: string | null; role: string };
      },
    }),
  );
}

export const authOptions: NextAuthOptions = {
  // Keep the Prisma adapter (when a DB is configured) so OAuth users persist,
  // but use JWT sessions: the Credentials provider is incompatible with the
  // database session strategy. JWT sessions work for both Google and
  // email/password sign-in.
  ...(isDatabaseConfigured && prisma
    ? { adapter: PrismaAdapter(prisma) as any }
    : {}),
  providers,
  session: { strategy: "jwt" },
  pages: {
    signIn: "/login",
  },
  callbacks: {
    async redirect({ url, baseUrl }) {
      if (url.startsWith("/")) return `${baseUrl}${url}`;
      if (new URL(url).origin === baseUrl) return url;
      return `${baseUrl}/dashboard`;
    },
    async jwt({ token, user, profile }) {
      // On sign-in `user` is present (adapter user for OAuth, or the object
      // returned from authorize() for credentials). Persist id + role so they
      // survive on subsequent requests where only the token is available.
      if (user) {
        token.id = (user as { id?: string }).id ?? token.sub;
        const role = (user as { role?: string }).role;
        if (role) token.role = role;
      }
      if (profile && (profile as { picture?: string }).picture) {
        token.picture = (profile as { picture?: string }).picture;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        (session.user as any).id = token.id ?? token.sub;
        (session.user as any).role = token.role;
        if (token.picture) session.user.image = token.picture as string;
      }
      return session;
    },
  },
};

export const isGoogleAuthConfigured =
  !!process.env.GOOGLE_CLIENT_ID && !!process.env.GOOGLE_CLIENT_SECRET;
