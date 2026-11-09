import type { NextAuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import CredentialsProvider from "next-auth/providers/credentials";
import { PrismaAdapter } from "@next-auth/prisma-adapter";
import { prisma, isDatabaseConfigured } from "@/lib/prisma";
import { verifyPassword } from "@/lib/password";
import { UPLINE_COOKIE } from "@/lib/uplineCookie";
import { ADVERTISER_COOKIE, isAdvertiserInviteToken } from "@/lib/advertiserInvite";
import { USER_MODE_COOKIE, isUserModeActive } from "@/lib/userMode";
import { VIEW_AS_COOKIE, viewAsTargetId } from "@/lib/viewAs";

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
  events: {
    // Leaving client view on sign-out, so its read-only lock never follows the
    // next person who signs in on this browser.
    async signOut() {
      try {
        const { cookies } = await import("next/headers");
        if (cookies().get(VIEW_AS_COOKIE)) cookies().delete(VIEW_AS_COOKIE);
      } catch (e) {
        console.warn("[auth] clearing client view on sign-out failed", e);
      }
    },
    // "Sign up with Google" with an upline code: the signup page leaves the
    // code in a short-lived cookie; join their team once the account exists.
    async createUser({ user }) {
      // Same for the advertiser invite link: mark the new account an advertiser.
      try {
        const { cookies } = await import("next/headers");
        const adv = cookies().get(ADVERTISER_COOKIE)?.value;
        if (adv && user.id && prisma && isAdvertiserInviteToken(decodeURIComponent(adv))) {
          await prisma.user.update({ where: { id: user.id }, data: { isAdvertiser: true } });
        }
        if (adv) cookies().delete(ADVERTISER_COOKIE);
      } catch (e) {
        console.warn("[auth] advertiser flag after Google signup failed", e);
      }
      try {
        const { cookies } = await import("next/headers");
        const code = cookies().get(UPLINE_COOKIE)?.value;
        if (!code || !user.id) return;
        const { joinUplineTeam } = await import("@/lib/upline");
        await joinUplineTeam(user.id, decodeURIComponent(code));
        cookies().delete(UPLINE_COOKIE);
      } catch (e) {
        console.warn("[auth] upline join after Google signup failed", e);
      }
    },
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
      // Bootstrap admins without database access: any email listed in the
      // ADMIN_EMAILS env var (comma-separated) is granted the ADMIN role.
      const adminEmails = (process.env.ADMIN_EMAILS ?? "")
        .split(",")
        .map((e) => e.trim().toLowerCase())
        .filter(Boolean);
      const email = ((user as { email?: string })?.email ?? token.email)?.toLowerCase();
      if (email && adminEmails.includes(email)) {
        token.role = "ADMIN";
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        (session.user as any).id = token.id ?? token.sub;
        (session.user as any).role = token.role;
        if (token.picture) session.user.image = token.picture as string;
        // Admin user mode: every role check reads this session, so reporting a
        // client role here makes the whole app treat them as one.
        if (token.role === "ADMIN") {
          try {
            const { cookies } = await import("next/headers");
            // View as client: the session becomes that client's, so every page
            // and API shows their account. middleware.ts keeps it read-only.
            const targetId = viewAsTargetId(token.role, cookies().get(VIEW_AS_COOKIE)?.value);
            const target =
              targetId && prisma
                ? await prisma.user.findUnique({
                    where: { id: targetId },
                    select: { id: true, name: true, email: true, image: true, role: true },
                  })
                : null;
            if (target) {
              (session.user as any).id = target.id;
              // Never hand out admin through someone else's account.
              (session.user as any).role = target.role === "ADMIN" ? "AGENT" : target.role;
              session.user.name = target.name;
              session.user.email = target.email;
              session.user.image = target.image;
              (session.user as any).viewingAs = true;
              return session;
            }
            // Cookie points at an account that's gone: keep the admin's own
            // session but still flag it, so the banner offers the way out of
            // the read-only lock instead of leaving them stuck in it.
            if (targetId) {
              (session.user as any).viewingAs = true;
              return session;
            }
            if (isUserModeActive(token.role, cookies().get(USER_MODE_COOKIE)?.value)) {
              (session.user as any).role = "AGENT";
              (session.user as any).userMode = true;
            }
          } catch (e) {
            console.warn("[auth] user mode check failed", e);
          }
        }
      }
      return session;
    },
  },
};

export const isGoogleAuthConfigured =
  !!process.env.GOOGLE_CLIENT_ID && !!process.env.GOOGLE_CLIENT_SECRET;
