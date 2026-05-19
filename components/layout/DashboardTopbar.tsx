"use client";
import Link from "next/link";
import { Search, Bell, ChevronDown } from "lucide-react";
import { signOut, useSession } from "next-auth/react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { currentUser } from "@/data/user";
import { initials } from "@/lib/utils";

export function DashboardTopbar() {
  const { data: session } = useSession();
  const displayName = session?.user?.name ?? currentUser.name;
  const displayEmail = session?.user?.email ?? currentUser.email;
  const avatarUrl = session?.user?.image;

  return (
    <header className="sticky top-0 z-30 h-16 border-b border-slate-200 bg-white/95 backdrop-blur">
      <div className="h-full px-6 flex items-center justify-between gap-6">
        <div className="hidden md:flex items-center gap-2 max-w-md w-full">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Search leads, orders, contacts…" className="pl-9 h-9" />
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button className="relative h-9 w-9 grid place-items-center rounded-md border border-slate-300 hover:bg-slate-100">
            <Bell className="h-4 w-4 text-muted-foreground" />
            <span className="absolute top-2 right-2 h-1.5 w-1.5 rounded-full bg-brand-red" />
          </button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="flex items-center gap-2 rounded-md border border-slate-300 pl-1 pr-2.5 py-1 hover:bg-slate-100">
                <Avatar className="h-7 w-7">
                  {avatarUrl && <AvatarImage src={avatarUrl} alt={displayName} />}
                  <AvatarFallback className="text-[10px]">
                    {initials(displayName)}
                  </AvatarFallback>
                </Avatar>
                <div className="hidden sm:block leading-tight text-left">
                  <div className="text-xs font-medium">{displayName}</div>
                  <div className="text-[10px] text-muted-foreground">{displayEmail}</div>
                </div>
                <ChevronDown className="h-3 w-3 text-muted-foreground" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel>Account</DropdownMenuLabel>
              <DropdownMenuItem asChild>
                <Link href="/settings">Profile & agency</Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link href="/settings">Integrations</Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link href="/orders">Billing & orders</Link>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => signOut({ callbackUrl: "/" })}
                className="cursor-pointer"
              >
                Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </header>
  );
}
