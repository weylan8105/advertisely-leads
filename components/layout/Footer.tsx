import Link from "next/link";
import { Logo } from "./Logo";

const cols = [
  {
    title: "Product",
    links: [
      { href: "/marketplace", label: "Marketplace" },
      { href: "/#how-it-works", label: "How it works" },
      { href: "/#pricing", label: "Pricing" },
      { href: "/#compliance", label: "Compliance" },
    ],
  },
  {
    title: "Agents",
    links: [
      { href: "/dashboard", label: "Dashboard" },
      { href: "/leads", label: "Leads CRM" },
      { href: "/orders", label: "Orders" },
      { href: "/settings", label: "Integrations" },
    ],
  },
  {
    title: "Company",
    links: [
      { href: "/about", label: "About" },
      { href: "#", label: "Careers" },
      { href: "#", label: "Contact" },
      { href: "#", label: "Press" },
    ],
  },
  {
    title: "Legal",
    links: [
      { href: "#", label: "Privacy" },
      { href: "#", label: "Terms" },
      { href: "#", label: "TCPA Policy" },
      { href: "#", label: "Replacement Policy" },
    ],
  },
];

export function Footer() {
  return (
    <footer className="relative bg-black text-white overflow-hidden">
      <div className="absolute -top-32 right-1/4 h-[400px] w-[400px] rounded-full bg-brand-red/10 blur-3xl pointer-events-none" />
      <div className="relative container py-20">
        <div className="grid gap-10 lg:grid-cols-6">
          <div className="lg:col-span-2 max-w-sm">
            <Logo tone="dark" />
            <p className="mt-5 text-sm text-white/60 leading-relaxed">
              High-intent IUL leads built for agents who actually close. Premium lead
              marketplace for life insurance agents, agency builders, and IUL producers.
            </p>
          </div>
          {cols.map((col) => (
            <div key={col.title}>
              <div className="text-[11px] uppercase tracking-[0.18em] text-brand-red font-semibold mb-4">
                {col.title}
              </div>
              <ul className="space-y-2.5">
                {col.links.map((l) => (
                  <li key={l.label}>
                    <Link
                      href={l.href}
                      className="text-sm text-white/70 hover:text-white transition-colors"
                    >
                      {l.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="mt-16 pt-6 border-t border-white/10 flex flex-col md:flex-row justify-between gap-4 text-xs text-white/50">
          <div>© {new Date().getFullYear()} Advertisely Leads. All rights reserved.</div>
          <div className="max-w-2xl">
            Advertisely Leads does not guarantee sales outcomes. Lead availability varies by
            state and campaign volume. All leads include documented consent and timestamped
            source tracking. Replacement eligibility subject to quality review.
          </div>
        </div>
      </div>
    </footer>
  );
}
