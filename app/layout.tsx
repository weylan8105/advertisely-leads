import type { Metadata } from "next";
import "./globals.css";
import { AuthProvider } from "@/components/providers/AuthProvider";

export const metadata: Metadata = {
  metadataBase: new URL("https://advertisely.io"),
  title: "Advertisely Leads — High-Intent IUL Leads for Agents Who Close",
  description:
    "Premium IUL lead marketplace for life insurance agents and IUL producers. Real-time delivery, TCPA compliant, CRM-ready.",
  openGraph: {
    title: "Advertisely Leads — High-Intent IUL Leads for Agents Who Close",
    description:
      "Premium IUL lead marketplace for life insurance agents and IUL producers.",
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
    <html lang="en">
      <body className="min-h-screen bg-background text-foreground">
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
