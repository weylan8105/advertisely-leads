"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { cn } from "@/lib/utils";

/** localStorage key holding "dark" | "light". Read by the no-flash script in app/layout. */
export const THEME_KEY = "adv-theme";

export function applyTheme(theme: "dark" | "light") {
  document.documentElement.classList.toggle("dark", theme === "dark");
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    /* private mode — the choice just won't persist */
  }
  window.dispatchEvent(new CustomEvent("adv-theme", { detail: theme }));
}

/** Current theme, kept in sync across every toggle on the page. */
export function useTheme(): ["dark" | "light", (t: "dark" | "light") => void] {
  const [theme, setTheme] = useState<"dark" | "light">("light");
  useEffect(() => {
    setTheme(document.documentElement.classList.contains("dark") ? "dark" : "light");
    const on = (e: Event) => setTheme((e as CustomEvent).detail);
    window.addEventListener("adv-theme", on);
    return () => window.removeEventListener("adv-theme", on);
  }, []);
  return [theme, applyTheme];
}

/** Sun/moon button that flips between light and dark mode. */
export function ThemeToggle({ className }: { className?: string }) {
  const [theme, setTheme] = useTheme();
  const dark = theme === "dark";
  return (
    <button
      type="button"
      onClick={() => setTheme(dark ? "light" : "dark")}
      title={dark ? "Switch to light mode" : "Switch to dark mode"}
      aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
      className={cn(
        "grid h-9 w-9 place-items-center rounded-md border border-slate-300 text-muted-foreground hover:bg-slate-100 hover:text-foreground",
        className,
      )}
    >
      {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </button>
  );
}
