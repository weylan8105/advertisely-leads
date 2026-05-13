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
      { href: "#", label: "About" },
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
    <footer className="border-t border-white/[0.06] bg-brand-deepnavy">
      <div className="container py-16">
        <div className="grid gap-10 lg:grid-cols-6">
          <div className="lg:col-span-2 max-w-sm">
            <Logo />
            <p className="mt-4 text-sm text-muted-foreground">
              High-intent IUL leads built for agents who actually close. Premium lead
              marketplace for GFI agents, agency builders, and life insurance professionals.
            </p>
          </div>
          {cols.map((col) => (
            <div key={col.title}>
              <div className="text-sm font-semibold mb-3">{col.title}</div>
              <ul className="space-y-2">
                {col.links.map((l) => (
                  <li key={l.label}>
                    <Link href={l.href} className="text-sm text-muted-foreground hover:text-foreground">
                      {l.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="mt-12 pt-6 border-t border-white/[0.06] flex flex-col md:flex-row justify-between gap-4 text-xs text-muted-foreground">
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
