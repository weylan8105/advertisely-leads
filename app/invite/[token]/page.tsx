"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { Loader2, UsersRound, CheckCircle2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Logo } from "@/components/layout/Logo";

interface InviteInfo {
  email: string;
  role: string;
  status: string;
  orgName: string;
  expired: boolean;
  valid: boolean;
}

export default function InvitePage({ params }: { params: { token: string } }) {
  const { token } = params;
  const router = useRouter();
  const { data: session, status: authStatus } = useSession();

  const [info, setInfo] = useState<InviteInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [accepting, setAccepting] = useState(false);
  const [accepted, setAccepted] = useState(false);

  useEffect(() => {
    fetch(`/api/invite/${token}`)
      .then(async (r) => {
        const b = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(b.error ?? `HTTP ${r.status}`);
        setInfo(b);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [token]);

  async function accept() {
    setAccepting(true);
    setError(null);
    const res = await fetch(`/api/invite/${token}`, { method: "POST" });
    const body = await res.json().catch(() => ({}));
    setAccepting(false);
    if (res.ok) {
      setAccepted(true);
      setTimeout(() => router.push("/team"), 1200);
    } else {
      setError(body.error ?? "Could not accept invitation");
    }
  }

  const signedInEmail = (session?.user?.email ?? "").toLowerCase();
  const emailMatches = info && signedInEmail === info.email.toLowerCase();

  return (
    <div className="min-h-screen bg-white grid place-items-center px-4">
      <div className="w-full max-w-md">
        <div className="flex justify-center mb-6">
          <Logo href="/" />
        </div>
        <Card className="p-8 text-center">
          {loading ? (
            <div className="flex items-center justify-center gap-2 text-muted-foreground py-8">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading invitation…
            </div>
          ) : error && !info ? (
            <>
              <div className="mx-auto h-12 w-12 grid place-items-center rounded-full bg-rose-500/15 text-rose-600 mb-4">
                <AlertCircle className="h-6 w-6" />
              </div>
              <h1 className="text-xl font-semibold">Invitation unavailable</h1>
              <p className="mt-2 text-sm text-muted-foreground">{error}</p>
              <Link href="/" className="inline-block mt-6">
                <Button variant="outline">Back to home</Button>
              </Link>
            </>
          ) : accepted ? (
            <>
              <div className="mx-auto h-12 w-12 grid place-items-center rounded-full bg-emerald-500/15 text-emerald-600 mb-4">
                <CheckCircle2 className="h-6 w-6" />
              </div>
              <h1 className="text-xl font-semibold">You&apos;re in!</h1>
              <p className="mt-2 text-sm text-muted-foreground">
                Welcome to {info?.orgName}. Taking you to your team…
              </p>
            </>
          ) : info && !info.valid ? (
            <>
              <div className="mx-auto h-12 w-12 grid place-items-center rounded-full bg-amber-500/15 text-amber-700 mb-4">
                <AlertCircle className="h-6 w-6" />
              </div>
              <h1 className="text-xl font-semibold">This invite is no longer active</h1>
              <p className="mt-2 text-sm text-muted-foreground">
                {info.expired ? "It has expired." : `It has already been ${info.status.toLowerCase()}.`} Ask the
                team owner to send a new one.
              </p>
            </>
          ) : info ? (
            <>
              <div className="mx-auto h-12 w-12 grid place-items-center rounded-full bg-brand-red/10 text-brand-red mb-4">
                <UsersRound className="h-6 w-6" />
              </div>
              <h1 className="text-xl font-semibold tracking-tight">
                Join {info.orgName}
              </h1>
              <p className="mt-2 text-sm text-muted-foreground">
                You&apos;ve been invited to join as {/^[aeiou]/i.test(info.role) ? "an" : "a"}{" "}
                <span className="font-medium text-foreground">{info.role.toLowerCase()}</span>. This invite is for{" "}
                <span className="font-medium text-foreground">{info.email}</span>.
              </p>

              {error && <p className="mt-4 text-sm text-rose-600">{error}</p>}

              <div className="mt-6">
                {authStatus === "loading" ? (
                  <Loader2 className="h-4 w-4 animate-spin mx-auto text-muted-foreground" />
                ) : !session ? (
                  <Link href={`/login?callbackUrl=/invite/${token}`}>
                    <Button className="w-full">Sign in to accept</Button>
                  </Link>
                ) : emailMatches ? (
                  <Button className="w-full" onClick={accept} disabled={accepting}>
                    {accepting && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
                    Accept invitation
                  </Button>
                ) : (
                  <div className="text-sm text-muted-foreground">
                    You&apos;re signed in as{" "}
                    <span className="font-medium text-foreground">{session.user?.email}</span>, but this invite
                    is for <span className="font-medium text-foreground">{info.email}</span>.
                    <div className="mt-3">
                      <Link href={`/login?callbackUrl=/invite/${token}`}>
                        <Button variant="outline" className="w-full">
                          Sign in with {info.email}
                        </Button>
                      </Link>
                    </div>
                  </div>
                )}
              </div>
            </>
          ) : null}
        </Card>
      </div>
    </div>
  );
}
