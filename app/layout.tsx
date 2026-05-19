import type { Metadata } from "next";
import { Inter, Fraunces } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "@/components/providers/AuthProvider";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

const fraunces = Fraunces({
  subsets: ["latin"],
  variable: "--font-serif",
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

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
    <html lang="en" className={`${inter.variable} ${fraunces.variable}`}>
      <body className="min-h-screen bg-background text-foreground font-sans">
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
