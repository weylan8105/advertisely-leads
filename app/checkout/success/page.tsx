import Link from "next/link";
import { CheckCircle2, AlertCircle, Loader2, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/layout/Logo";
import { Card } from "@/components/ui/card";
import { stripe, isStripeConfigured } from "@/lib/stripe";

interface CheckoutSuccessPageProps {
  searchParams?: {
    payment_intent?: string;
    payment_intent_client_secret?: string;
    redirect_status?: string;
  };
}

export const dynamic = "force-dynamic";

export default async function CheckoutSuccessPage({
  searchParams,
}: CheckoutSuccessPageProps) {
  const paymentIntentId = searchParams?.payment_intent;
  const status = searchParams?.redirect_status;

  let resolvedStatus: "success" | "processing" | "failed" | "unknown" =
    "unknown";

  if (status === "succeeded") resolvedStatus = "success";
  else if (status === "processing") resolvedStatus = "processing";
  else if (status === "requires_payment_method") resolvedStatus = "failed";

  // If we have a PaymentIntent ID and Stripe configured, fetch authoritative state
  if (isStripeConfigured && stripe && paymentIntentId) {
    try {
      const intent = await stripe.paymentIntents.retrieve(paymentIntentId);
      if (intent.status === "succeeded") resolvedStatus = "success";
      else if (intent.status === "processing") resolvedStatus = "processing";
      else if (
        intent.status === "requires_payment_method" ||
        intent.status === "canceled"
      )
        resolvedStatus = "failed";
    } catch {
      /* fall through */
    }
  }

  return (
    <div className="min-h-screen bg-white">
      <header className="border-b border-slate-200">
        <div className="container h-16 flex items-center justify-between">
          <Logo />
          <Link
            href="/dashboard"
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            Dashboard →
          </Link>
        </div>
      </header>
      <main className="container py-16">
        <div className="max-w-lg mx-auto">
          <Card className="p-10 text-center">
            {resolvedStatus === "success" && (
              <>
                <div className="mx-auto h-14 w-14 grid place-items-center rounded-full bg-emerald-500/15 text-emerald-600 mb-4">
                  <CheckCircle2 className="h-7 w-7" />
                </div>
                <h1 className="text-2xl font-semibold tracking-tight">
                  Payment confirmed
                </h1>
                <p className="mt-2 text-sm text-muted-foreground">
                  Your order is in the queue. New leads will start flowing into your
                  dashboard as soon as matching inventory is available.
                </p>
              </>
            )}
            {resolvedStatus === "processing" && (
              <>
                <div className="mx-auto h-14 w-14 grid place-items-center rounded-full bg-amber-500/15 text-amber-700 mb-4">
                  <Loader2 className="h-7 w-7 animate-spin" />
                </div>
                <h1 className="text-2xl font-semibold tracking-tight">
                  Payment processing
                </h1>
                <p className="mt-2 text-sm text-muted-foreground">
                  Your bank is still confirming. We'll start delivery the second the
                  payment clears. You can close this tab — we'll email a receipt.
                </p>
              </>
            )}
            {resolvedStatus === "failed" && (
              <>
                <div className="mx-auto h-14 w-14 grid place-items-center rounded-full bg-rose-500/15 text-rose-600 mb-4">
                  <AlertCircle className="h-7 w-7" />
                </div>
                <h1 className="text-2xl font-semibold tracking-tight">
                  Payment didn't go through
                </h1>
                <p className="mt-2 text-sm text-muted-foreground">
                  Your card was declined or the session expired. Try again with a
                  different payment method.
                </p>
              </>
            )}
            {resolvedStatus === "unknown" && (
              <>
                <h1 className="text-2xl font-semibold tracking-tight">
                  Order received
                </h1>
                <p className="mt-2 text-sm text-muted-foreground">
                  Head to your dashboard to track delivery progress.
                </p>
              </>
            )}

            <div className="mt-8 flex justify-center gap-2">
              {resolvedStatus === "failed" ? (
                <Link href="/marketplace">
                  <Button>Try again</Button>
                </Link>
              ) : (
                <>
                  <Link href="/dashboard">
                    <Button>Go to dashboard</Button>
                  </Link>
                  <Link href="/orders">
                    <Button variant="outline">View orders</Button>
                  </Link>
                </>
              )}
            </div>

            {(resolvedStatus === "success" || resolvedStatus === "processing") && (
              <a
                href="/blue-collar-iul-script.pdf"
                target="_blank"
                rel="noopener noreferrer"
                className="mt-6 flex items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3 text-left transition-colors hover:border-brand-red/40 hover:bg-brand-red/[0.03]"
              >
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-brand-red/10 text-brand-red">
                  <FileText className="h-4 w-4" />
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-foreground">
                    While you wait — grab the calling script
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    Our Blue-Collar IUL script: intro, discovery, and objection handling. Opens in a new tab.
                  </span>
                </span>
              </a>
            )}
          </Card>
        </div>
      </main>
    </div>
  );
}
