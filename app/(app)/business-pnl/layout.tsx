import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

// Server-side gate: the business P&L is ADMIN-only (see ADMIN_EMAILS), same as
// /admin. Everyone else is redirected away before any of it renders.
export default async function BusinessPnlLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getServerSession(authOptions);
  const role = (session?.user as { role?: string } | undefined)?.role;
  if (role !== "ADMIN") {
    redirect("/dashboard");
  }
  return <>{children}</>;
}
