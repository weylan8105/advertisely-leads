"use client";
import Link from "next/link";
import { useState } from "react";
import { Menu, X } from "lucide-react";
import { useSession, signOut } from "next-auth/react";
import { Logo } from "./Logo";
import { AccountMenu } from "./AccountMenu";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ThemeToggle } from "@/components/layout/ThemeToggle";

const navItems = [
  { href: "/marketplace", label: "Marketplace" },
  { href: "/#how-it-works", label: "How it works" },
  { href: "/about", label: "About Us" },
  { href: "/#compliance", label: "Compliance" },
  { href: "/#faq", label: "FAQ" },
];

export function Navbar() {
  const [open, setOpen] = useState(false);
  // Reflect auth state (any login method) so signed-in visitors don't see
  // "Sign in / Create account" and mistake it for having been logged out.
  const { data: session, status } = useSession();
  const isAuthed = status === "authenticated";
  const acctName = session?.user?.name ?? session?.user?.email ?? "Your account";
  const acctEmail = session?.user?.email;
  return (
    <header className="sticky top-0 z-40 w-full border-b border-slate-200 bg-white/95 backdrop-blur">
      <div className="container flex h-16 items-center justify-between">
        <div className="flex items-center gap-10">
          <Logo />
          <nav className="hidden md:flex items-center gap-7">
            {navItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </div>
        <div className="hidden md:flex items-center gap-3">
          <ThemeToggle />
          {isAuthed ? (
            <>
              <Link href="/dashboard">
                <Button variant="outline" size="sm">Dashboard</Button>
              </Link>
              <AccountMenu />
            </>
          ) : (
            <>
              <Link href="/login">
                <Button variant="ghost" size="sm">
                  Sign in
                </Button>
              </Link>
              <Link href="/signup">
                <Button size="sm">Create account</Button>
              </Link>
            </>
          )}
        </div>
        <ThemeToggle className="md:hidden ml-auto mr-1" />
        <button
          className="md:hidden p-2 text-foreground"
          onClick={() => setOpen(!open)}
          aria-label="Toggle menu"
        >
          {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </div>
      <div
        className={cn(
          "md:hidden overflow-hidden border-t border-slate-200 transition-all",
          open ? "max-h-96" : "max-h-0",
        )}
      >
        <div className="container py-4 flex flex-col gap-3">
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="text-sm text-muted-foreground hover:text-foreground"
              onClick={() => setOpen(false)}
            >
              {item.label}
            </Link>
          ))}
          {isAuthed && (
            <div className="mt-1 border-t border-slate-200 pt-3">
              <div className="text-xs font-medium">{acctName}</div>
              {acctEmail && acctEmail !== acctName && (
                <div className="text-[11px] text-muted-foreground">{acctEmail}</div>
              )}
            </div>
          )}
          <div className="flex gap-2 pt-2">
            {isAuthed ? (
              <>
                <Link href="/dashboard" className="flex-1" onClick={() => setOpen(false)}>
                  <Button size="sm" className="w-full">
                    Dashboard
                  </Button>
                </Link>
                <Button
                  variant="outline"
                  size="sm"
                  className="flex-1"
                  onClick={() => {
                    setOpen(false);
                    signOut({ callbackUrl: "/login" });
                  }}
                >
                  Sign out
                </Button>
              </>
            ) : (
              <>
                <Link href="/login" className="flex-1" onClick={() => setOpen(false)}>
                  <Button variant="outline" size="sm" className="w-full">
                    Sign in
                  </Button>
                </Link>
                <Link href="/signup" className="flex-1" onClick={() => setOpen(false)}>
                  <Button size="sm" className="w-full">
                    Create account
                  </Button>
                </Link>
              </>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
