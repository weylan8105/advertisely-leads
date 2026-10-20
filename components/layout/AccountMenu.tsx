"use client";
import Link from "next/link";
import { ChevronDown } from "lucide-react";
import { signOut, useSession } from "next-auth/react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { currentUser } from "@/data/user";
import { initials, cn } from "@/lib/utils";

/**
 * The signed-in account chip (avatar + name/email + menu). Shared so the public
 * marketplace header matches the in-app topbar — a logged-in visitor always sees
 * which account they're on, not a logged-out-looking page.
 */
export function AccountMenu({ className }: { className?: string }) {
  const { data: session } = useSession();
  const displayName = session?.user?.name ?? currentUser.name;
  const displayEmail = session?.user?.email ?? currentUser.email;
  const avatarUrl = session?.user?.image;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className={cn(
            "flex items-center gap-2 rounded-md border border-slate-300 pl-1 pr-2.5 py-1 hover:bg-slate-100",
            className,
          )}
        >
          <Avatar className="h-7 w-7">
            {avatarUrl && <AvatarImage src={avatarUrl} alt={displayName} />}
            <AvatarFallback className="text-[10px]">{initials(displayName)}</AvatarFallback>
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
          <Link href="/dashboard">Go to dashboard</Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/settings">Settings</Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/orders">Billing &amp; orders</Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={() => signOut({ callbackUrl: "/login" })}
          className="cursor-pointer text-rose-600 focus:text-rose-600"
        >
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
