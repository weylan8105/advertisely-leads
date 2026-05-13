import { SidebarNav } from "@/components/layout/SidebarNav";
import { DashboardTopbar } from "@/components/layout/DashboardTopbar";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex bg-brand-deepnavy">
      <SidebarNav />
      <div className="flex-1 min-w-0 flex flex-col">
        <DashboardTopbar />
        <main className="flex-1 px-6 md:px-8 py-8">{children}</main>
      </div>
    </div>
  );
}
