import Link from "next/link";
import {
  ArrowRight,
  CalendarCheck,
  FileText,
  Megaphone,
  Target,
  MessageSquareQuote,
  KanbanSquare,
  Gem,
} from "lucide-react";
import { Button } from "@/components/ui/button";

// Where "Book a call" sends advertiser prospects. Set NEXT_PUBLIC_ADVERTISER_BOOKING_URL
// (Calendly, Google booking page, etc.) in Vercel; until then the button stays on-page.
const bookingUrl = process.env.NEXT_PUBLIC_ADVERTISER_BOOKING_URL || "#advertisers";
const bookingIsExternal = /^https?:\/\//.test(bookingUrl);

const benefits = [
  {
    icon: FileText,
    title: "Sales scripts already working in the field",
    body: "Get the same scripts Ryan uses to turn conversations into closed deals. Give yourself and your agents a clear framework for working leads and asking for the sale.",
  },
  {
    icon: Megaphone,
    title: "Ad creatives built and tested for performance",
    body: "We build AI ad creatives for your campaigns. When a creative performs well for Ryan or another advertiser, we can adapt that approach for you — including having you record your own version.",
  },
  {
    icon: Target,
    title: "Direct lead generation",
    body: "Your ad budget goes toward generating leads directly, without a lead vendor's markup. You see what your campaigns actually cost.",
  },
  {
    icon: MessageSquareQuote,
    title: "A clear sales angle before the first call",
    body: "Know exactly what your prospect saw: the creative, the message, and the offer that prompted them to respond. Connect the ad's promise to your presentation from the first minute.",
  },
  {
    icon: KanbanSquare,
    title: "CRM access to work your leads",
    body: "Keep incoming leads organized and manage follow-up in one place, so you and your team can see where every opportunity stands.",
  },
  {
    icon: Gem,
    title: "The Goldmine: more opportunities for your team",
    body: "Once you've worked a lead, move it into your Goldmine for your team to follow up. Start with manual placement for control, then switch on automatic routing when it fits your workflow.",
  },
];

export function Advertisers() {
  return (
    <section id="advertisers" className="container py-20 lg:py-28 scroll-mt-16">
      <div className="grid gap-12 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-16">
        <div className="lg:sticky lg:top-24 lg:self-start">
          <div className="inline-flex items-center gap-2 mb-5">
            <span className="h-px w-8 bg-brand-red" />
            <span className="bg-brand-red text-white text-[10px] uppercase tracking-[0.22em] font-semibold px-2 py-0.5 rounded-sm">
              For advertisers
            </span>
          </div>
          <h2 className="font-serif text-3xl md:text-5xl font-medium tracking-tight leading-[1.1]">
            The Producer Playbook.
          </h2>
          <p className="mt-4 text-muted-foreground">
            Build your own lead flow. We give you the ads, the sales scripts, and the follow-up
            system to turn prospects into business.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link
              href={bookingUrl}
              {...(bookingIsExternal ? { target: "_blank", rel: "noopener noreferrer" } : {})}
            >
              <Button size="lg">
                <CalendarCheck className="h-4 w-4" /> Book a call <ArrowRight className="h-4 w-4" />
              </Button>
            </Link>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            A short call to see if your agency is a fit and map out your first campaigns.
          </p>
        </div>

        <ol className="grid gap-4 sm:grid-cols-2">
          {benefits.map((b, i) => {
            const Icon = b.icon;
            return (
              <li
                key={b.title}
                className="relative rounded-xl border border-slate-200 bg-white p-5 hover:border-slate-300 transition-colors"
              >
                <div className="absolute top-4 right-4 text-[10px] font-mono text-muted-foreground/60">
                  {String(i + 1).padStart(2, "0")}
                </div>
                <div className="h-10 w-10 grid place-items-center rounded-lg bg-slate-100 border border-slate-300 text-brand-red">
                  <Icon className="h-5 w-5" />
                </div>
                <div className="mt-4 font-medium tracking-tight">{b.title}</div>
                <p className="mt-1 text-sm text-muted-foreground">{b.body}</p>
              </li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}
