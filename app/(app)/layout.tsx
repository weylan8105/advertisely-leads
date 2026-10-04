import { SidebarNav } from "@/components/layout/SidebarNav";
import { DashboardTopbar } from "@/components/layout/DashboardTopbar";
import { MobileNav } from "@/components/layout/MobileNav";
import { PhonePrompt } from "@/components/account/PhonePrompt";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex bg-slate-50">
      <SidebarNav />
      <div className="flex-1 min-w-0 flex flex-col">
        <DashboardTopbar />
        {/* Extra bottom padding on mobile so content clears the fixed tab bar. */}
        <main className="flex-1 px-4 sm:px-6 md:px-8 py-6 md:py-8 pb-24 lg:pb-8">{children}</main>
      </div>
      <MobileNav />
      <PhonePrompt />
    </div>
  );
}
