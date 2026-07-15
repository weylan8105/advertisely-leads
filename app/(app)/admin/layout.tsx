import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

// Server-side gate: only ADMINs (see ADMIN_EMAILS) can reach anything under
// /admin. Everyone else is redirected away before any admin content renders.
export default async function AdminLayout({
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
