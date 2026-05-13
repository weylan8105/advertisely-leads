import type { NextAuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";

// Only register Google provider if credentials are present.
// Lets the app build/run cleanly before env vars are configured.
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
  providers,
  session: { strategy: "jwt" },
  pages: {
    signIn: "/login",
  },
  callbacks: {
    async redirect({ url, baseUrl }) {
      // Allow relative callback URLs
      if (url.startsWith("/")) return `${baseUrl}${url}`;
      // Allow same-origin URLs
      if (new URL(url).origin === baseUrl) return url;
      // Default landing after Google sign-in
      return `${baseUrl}/dashboard`;
    },
    async jwt({ token, account, profile }) {
      if (account && profile) {
        token.picture = (profile as { picture?: string }).picture;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user && token.picture) {
        session.user.image = token.picture as string;
      }
      return session;
    },
  },
};

export const isGoogleAuthConfigured =
  !!process.env.GOOGLE_CLIENT_ID && !!process.env.GOOGLE_CLIENT_SECRET;
