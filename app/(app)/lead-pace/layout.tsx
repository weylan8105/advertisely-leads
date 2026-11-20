import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

// Server-side gate: Lead Pace shows every client's deliveries and budget, so it's ADMIN-only,
// same as /admin. Everyone else is redirected away before any of it renders.
export default async function LeadPaceLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession(authOptions);
  const role = (session?.user as { role?: string } | undefined)?.role;
  if (role !== "ADMIN") {
    redirect("/dashboard");
  }
  return <>{children}</>;
}
