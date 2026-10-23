"use client";
import { useEffect, useState } from "react";
import { loadStripe } from "@stripe/stripe-js";
import {
  Elements,
  PaymentElement,
  useElements,
  useStripe,
} from "@stripe/react-stripe-js";
import { Lock, Loader2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTheme } from "@/components/layout/ThemeToggle";

// Initialize once outside the component (Stripe.js best practice).
const stripePublishableKey =
  process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? "";
const stripePromise = stripePublishableKey
  ? loadStripe(stripePublishableKey)
  : null;

interface StripePaymentFormProps {
  items: { packageId: string; quantity: number }[];
  filterStates?: string[];
  deliverToUserId?: string | null;
  // Advertisely Bucks Marketing Campaign (draft): a referral code + spend Bucks.
  referralCode?: string | null;
  useBucks?: boolean;
  onSuccess: () => void;
}

export function StripePaymentForm(props: StripePaymentFormProps) {
  const [theme] = useTheme();
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const itemsKey = JSON.stringify(props.items);
  const statesKey = (props.filterStates ?? []).join(",");
  const deliverKey = props.deliverToUserId ?? "";
  const promoKey = `${props.referralCode ?? ""}|${props.useBucks ? 1 : 0}`;
  // Bucks cover the whole order → no card form; place it with Bucks instead.
  const [coveredByBucks, setCoveredByBucks] = useState(false);
  const checkoutBody = JSON.stringify({
    items: props.items,
    filterStates: props.filterStates,
    deliverToUserId: props.deliverToUserId ?? null,
    referralCode: props.referralCode || null,
    useBucks: !!props.useBucks,
  });

  useEffect(() => {
    if (!stripePromise) {
      setError(
        "Stripe is not configured yet. NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY is missing.",
      );
      return;
    }
    setClientSecret(null);
    setCoveredByBucks(false);
    setError(null);
    fetch("/api/checkout/create-payment-intent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: checkoutBody,
    })
      .then(async (r) => {
        if (!r.ok) {
          const data = await r.json().catch(() => ({}));
          throw new Error(data.error ?? "Failed to create payment intent");
        }
        return r.json();
      })
      .then((data) => {
        if (data.coveredByBucks) setCoveredByBucks(true);
        else setClientSecret(data.clientSecret);
      })
      .catch((e) => setError(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemsKey, statesKey, deliverKey, promoKey]);

  if (error) {
    return (
      <div className="rounded-md border border-rose-200 bg-rose-50 p-4 flex items-start gap-3 text-sm">
        <AlertCircle className="h-4 w-4 text-rose-600 mt-0.5 shrink-0" />
        <div>
          <div className="font-medium text-rose-700">Payment unavailable</div>
          <p className="text-xs text-rose-700/80 mt-1">{error}</p>
        </div>
      </div>
    );
  }

  if (coveredByBucks) {
    return <BucksOnlyForm body={checkoutBody} onSuccess={props.onSuccess} />;
  }

  if (!clientSecret || !stripePromise) {
    return (
      <div className="rounded-md border border-slate-200 bg-slate-50 p-8 flex items-center justify-center text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin mr-2" />
        Preparing secure payment…
      </div>
    );
  }

  return (
    <Elements
      stripe={stripePromise}
      options={{
        clientSecret,
        appearance: {
          theme: theme === "dark" ? "night" : "stripe",
          variables: {
            colorPrimary: "#dc2626",
            colorBackground: theme === "dark" ? "#111827" : "#ffffff",
            colorText: theme === "dark" ? "#f1f5f9" : "#0f172a",
            colorTextSecondary: theme === "dark" ? "#94a3b8" : "#64748b",
            colorTextPlaceholder: theme === "dark" ? "#64748b" : "#94a3b8",
            colorDanger: "#dc2626",
            colorIconCardError: "#dc2626",
            borderRadius: "8px",
            fontFamily:
              'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
          },
        },
      }}
    >
      <InnerForm onSuccess={props.onSuccess} />
    </Elements>
  );
}

function InnerForm({ onSuccess }: { onSuccess: () => void }) {
  const stripe = useStripe();
  const elements = useElements();
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handlePay() {
    if (!stripe || !elements) return;
    setProcessing(true);
    setError(null);

    const { error: payError, paymentIntent } = await stripe.confirmPayment({
      elements,
      confirmParams: {
        return_url: `${window.location.origin}/checkout/success`,
      },
      // Skip the redirect if 3DS isn't required — we'll advance the wizard in-place.
      redirect: "if_required",
    });

    setProcessing(false);

    if (payError) {
      setError(payError.message ?? "Payment failed");
      return;
    }
    if (paymentIntent?.status === "succeeded") {
      onSuccess();
    }
  }

  return (
    <div className="space-y-4">
      <PaymentElement />
      {error && (
        <p className="text-xs text-rose-600 flex items-center gap-1">
          <AlertCircle className="h-3 w-3" />
          {error}
        </p>
      )}
      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <Lock className="h-3 w-3" /> Payments processed securely via Stripe. Card data never
        touches Advertisely servers.
      </div>
      <Button onClick={handlePay} disabled={!stripe || processing} className="w-full" size="lg">
        {processing ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            Processing payment…
          </>
        ) : (
          "Place order"
        )}
      </Button>
    </div>
  );
}

/** Advertisely Bucks Marketing Campaign (draft): the order is fully paid with Bucks. */
function BucksOnlyForm({ body, onSuccess }: { body: string; onSuccess: () => void }) {
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function place() {
    setProcessing(true);
    setError(null);
    try {
      const res = await fetch("/api/checkout/bucks-order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error ?? "Couldn't place the order");
      onSuccess();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setProcessing(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-md border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
        Your Advertisely Bucks cover this whole order — no card needed.
      </div>
      {error && (
        <p className="text-xs text-rose-600 flex items-center gap-1">
          <AlertCircle className="h-3 w-3" />
          {error}
        </p>
      )}
      <Button onClick={place} disabled={processing} className="w-full" size="lg">
        {processing ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            Placing order…
          </>
        ) : (
          "Place order with Bucks"
        )}
      </Button>
    </div>
  );
}
