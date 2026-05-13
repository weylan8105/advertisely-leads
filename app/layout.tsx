import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://advertisely.io"),
  title: "Advertisely Leads — High-Intent IUL Leads for Agents Who Close",
  description:
    "Premium IUL lead marketplace for GFI agents and life insurance professionals. Real-time delivery, TCPA compliant, CRM-ready.",
  openGraph: {
    title: "Advertisely Leads — High-Intent IUL Leads for Agents Who Close",
    description:
      "Premium IUL lead marketplace for GFI agents and life insurance professionals.",
    url: "https://advertisely.io",
    siteName: "Advertisely Leads",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Advertisely Leads",
    description:
      "High-intent IUL leads built for agents who actually close.",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-background text-foreground">{children}</body>
    </html>
  );
}
