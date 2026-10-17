"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { MessageSquare, Send, Loader2, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";

interface Msg {
  id: string;
  direction: "inbound" | "outbound";
  service: string | null;
  content: string;
  mediaUrls: string[];
  status: string | null;
  errorMessage: string | null;
  createdAt: string;
}

function isImessage(service: string | null) {
  return !!service && /imessage/i.test(service);
}

export function LeadMessages({ leadId, leadName }: { leadId: string; leadName: string }) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [loading, setLoading] = useState(true);
  const [configured, setConfigured] = useState(true);
  // Limited rollout: null = unknown (hidden until we confirm access).
  const [canUse, setCanUse] = useState<boolean | null>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  async function load(scroll = false) {
    try {
      const r = await fetch(`/api/leads/${leadId}/messages`);
      if (!r.ok) return;
      const d = await r.json();
      setCanUse(d.canUse !== false);
      setConfigured(d.configured !== false);
      setMessages(d.messages ?? []);
      if (scroll) requestAnimationFrame(() => scrollRef.current?.scrollTo({ top: 1e9 }));
    } catch {
      /* keep prior state */
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load(true);
    // Light polling so inbound replies and delivery status show up live.
    const t = setInterval(() => load(false), 15_000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leadId]);

  async function send() {
    const content = draft.trim();
    if (!content || sending) return;
    setSending(true);
    setError(null);
    try {
      const r = await fetch(`/api/leads/${leadId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setError(d.error ?? "Could not send");
        if (d.message) setMessages((m) => [...m, d.message]);
      } else {
        setDraft("");
        setMessages((m) => [...m, d.message]);
      }
      requestAnimationFrame(() => scrollRef.current?.scrollTo({ top: 1e9 }));
    } catch {
      setError("Could not send");
    } finally {
      setSending(false);
    }
  }

  // Limited rollout: hide texting entirely for users without access.
  if (canUse !== true) return null;

  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-2 flex items-center gap-1.5">
        <MessageSquare className="h-3.5 w-3.5" /> Text messages
      </div>

      {!configured ? (
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-muted-foreground">
          Texting isn&apos;t set up yet. Once Sendblue is connected on the server, you&apos;ll be able to
          iMessage/text {leadName} right here.
        </div>
      ) : (
        <>
          <div
            ref={scrollRef}
            className="max-h-64 overflow-y-auto scrollbar-thin rounded-lg border border-slate-200 bg-slate-50/60 p-3 space-y-2"
          >
            {loading ? (
              <div className="flex items-center justify-center py-6 text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
              </div>
            ) : messages.length === 0 ? (
              <div className="text-center text-[11px] text-muted-foreground py-6">
                No messages yet. Say hello 👋
              </div>
            ) : (
              messages.map((m) => {
                const out = m.direction === "outbound";
                const failed = m.status === "ERROR" || !!m.errorMessage;
                return (
                  <div key={m.id} className={cn("flex", out ? "justify-end" : "justify-start")}>
                    <div className="max-w-[78%]">
                      <div
                        className={cn(
                          "rounded-2xl px-3 py-1.5 text-sm whitespace-pre-wrap break-words",
                          out
                            ? failed
                              ? "bg-rose-100 text-rose-900 rounded-br-sm"
                              : isImessage(m.service)
                                ? "bg-blue-500 text-white rounded-br-sm"
                                : "bg-emerald-500 text-white rounded-br-sm"
                            : "bg-white border border-slate-200 text-foreground rounded-bl-sm",
                        )}
                      >
                        {m.content}
                        {m.mediaUrls?.map((u) => (
                          <a key={u} href={u} target="_blank" rel="noopener noreferrer" className="block underline text-xs mt-1 opacity-90">
                            Attachment
                          </a>
                        ))}
                      </div>
                      <div className={cn("mt-0.5 text-[10px] text-muted-foreground px-1", out ? "text-right" : "text-left")}>
                        {new Date(m.createdAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                        {out && (failed ? " · Failed" : m.status ? ` · ${m.status[0] + m.status.slice(1).toLowerCase()}` : "")}
                        {!out && m.service ? ` · ${m.service}` : ""}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {error && (
            <div className="mt-2 flex items-start gap-1.5 text-[11px] text-rose-600">
              <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
              <span>
                {error}
                {/no sendblue line|settings/i.test(error) && (
                  <>
                    {" "}
                    <Link href="/settings?tab=integrations" className="underline font-medium">
                      Set it up
                    </Link>
                  </>
                )}
              </span>
            </div>
          )}

          <div className="mt-2 flex items-end gap-2">
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === "Enter") send();
              }}
              placeholder={`Text ${leadName}…`}
              rows={2}
              className="flex-1 resize-y rounded-lg border border-slate-200 p-2.5 text-sm focus:border-brand-red focus:outline-none focus:ring-1 focus:ring-brand-red"
            />
            <button
              onClick={send}
              disabled={sending || !draft.trim()}
              className="inline-flex items-center gap-1.5 rounded-md bg-brand-red px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-brand-redDark disabled:opacity-50 shrink-0"
            >
              {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
              Send
            </button>
          </div>
          <p className="mt-1 text-[10px] text-muted-foreground">⌘/Ctrl + Enter to send · blue = iMessage, green = SMS</p>
        </>
      )}
    </div>
  );
}
