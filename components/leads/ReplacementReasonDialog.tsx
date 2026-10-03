"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  ELIGIBLE_REPLACEMENT_REASONS,
  REPLACEMENT_NOT_ELIGIBLE_NOTE,
  type ReplacementReasonCode,
} from "@/lib/replacementReasons";

/**
 * Shared replacement-request dialog. Clients pick one of the eligible reasons
 * (the only ones we replace) plus optional detail. Used by the lead table and
 * the lead detail modal so the flow and the eligibility list never diverge.
 */
export function ReplacementReasonDialog({
  open,
  leadName,
  busy,
  onClose,
  onSubmit,
}: {
  open: boolean;
  leadName: string;
  busy?: boolean;
  onClose: () => void;
  onSubmit: (reasonCode: ReplacementReasonCode, detail: string) => void;
}) {
  const [code, setCode] = useState<ReplacementReasonCode | "">("");
  const [detail, setDetail] = useState("");

  function reset() {
    setCode("");
    setDetail("");
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          reset();
          onClose();
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Request a replacement</DialogTitle>
          <DialogDescription>
            Pick the reason {leadName} qualifies for a replacement. Requests are verified on review.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          {ELIGIBLE_REPLACEMENT_REASONS.map((r) => (
            <button
              key={r.code}
              type="button"
              onClick={() => setCode(r.code)}
              className={cn(
                "w-full rounded-lg border px-3 py-2 text-left text-sm transition-colors",
                code === r.code
                  ? "border-brand-red bg-brand-red/10"
                  : "border-slate-200 hover:border-slate-300",
              )}
            >
              <div className="font-medium text-foreground">{r.label}</div>
              <div className="text-xs text-muted-foreground">{r.help}</div>
            </button>
          ))}
        </div>

        <Textarea
          placeholder="Optional detail (e.g., which number, what you found)…"
          value={detail}
          onChange={(e) => setDetail(e.target.value)}
          className="text-sm"
        />

        <p className="text-[11px] text-muted-foreground">{REPLACEMENT_NOT_ELIGIBLE_NOTE}</p>

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => {
              reset();
              onClose();
            }}
          >
            Cancel
          </Button>
          <Button
            disabled={!code || busy}
            onClick={() => {
              if (code) onSubmit(code, detail.trim());
            }}
          >
            {busy ? "Submitting…" : "Submit request"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
