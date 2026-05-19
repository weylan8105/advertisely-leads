import Link from "next/link";
import { Logo } from "@/components/layout/Logo";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen relative overflow-hidden bg-white">
      <div className="absolute inset-0 bg-radial-glow pointer-events-none" />
      <div className="absolute inset-0 bg-grid-light [background-size:32px_32px] opacity-30 pointer-events-none" />
      <div className="relative">
        <header className="container h-16 flex items-center justify-between">
          <Logo />
          <Link href="/" className="text-xs text-muted-foreground hover:text-foreground">
            ← Back to home
          </Link>
        </header>
        <div className="container py-10 lg:py-16">{children}</div>
      </div>
    </div>
  );
}
