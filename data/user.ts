/**
 * Mock user data — DEPRECATED.
 * The current user is now read from the NextAuth session (useSession / getServerSession).
 * This file is kept only for type compatibility during the transition.
 */

import type { User } from "@/types";

// Deprecated — use useSession() or getServerSession(authOptions) instead
export const currentUser: User = {
  id: "",
  name: "",
  email: "",
  agency: "",
  role: "agent",
  state: "",
  joinedAt: "",
};
