"use client";

import { useState } from "react";
import { Check, X } from "lucide-react";
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
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import {
  ELIGIBLE_REPLACEMENT_REASONS,
  NOT_ELIGIBLE_REPLACEMENT_REASONS,
  REPLACEMENT_WINDOW_NOTE,
  type ReplacementReasonCode,
} from "@/lib/replacementReasons";

/**
 * Shared replacement-request dialog. Shows the FULL replacement policy (what is
 * and isn't eligible) every time, and requires the client to acknowledge they've
 * reviewed it before they can submit — so they know up front whether a request
 * will be approved. Used by the lead table and the lead detail modal so the flow
 * and the policy never diverge.
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
  const [acknowledged, setAcknowledged] = useState(false);

  function reset() {
    setCode("");
    setDetail("");
    setAcknowledged(false);
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
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Request a replacement</DialogTitle>
          <DialogDescription>
            Please review the replacement policy below before submitting, so you know whether{" "}
            {leadName} qualifies.
          </DialogDescription>
        </DialogHeader>

        {/* Full policy — visible every time */}
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs">
          <div className="font-semibold text-foreground">Eligible for replacement</div>
          <ul className="mt-1 space-y-1">
            {ELIGIBLE_REPLACEMENT_REASONS.map((r) => (
              <li key={r.code} className="flex items-start gap-1.5 text-muted-foreground">
                <Check className="mt-0.5 h-3 w-3 shrink-0 text-emerald-600" />
                <span>
                  <span className="font-medium text-foreground">{r.label}</span> — {r.help}
                </span>
              </li>
            ))}
          </ul>
          <div className="mt-3 font-semibold text-foreground">Not eligible</div>
          <ul className="mt-1 space-y-1">
            {NOT_ELIGIBLE_REPLACEMENT_REASONS.map((r) => (
              <li key={r} className="flex items-start gap-1.5 text-muted-foreground">
                <X className="mt-0.5 h-3 w-3 shrink-0 text-rose-500" />
                <span>{r}</span>
              </li>
            ))}
          </ul>
          <p className="mt-3 border-t border-slate-200 pt-2 text-[11px] text-muted-foreground">
            {REPLACEMENT_WINDOW_NOTE}
          </p>
        </div>

        {/* Reason picker (eligible only) */}
        <div className="space-y-2">
          <div className="text-xs font-medium text-foreground">Which reason applies?</div>
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
              <span className="font-medium text-foreground">{r.label}</span>
            </button>
          ))}
        </div>

        <Textarea
          placeholder="Optional detail (e.g., which number, what you found)…"
          value={detail}
          onChange={(e) => setDetail(e.target.value)}
          className="text-sm"
        />

        {/* Required acknowledgment */}
        <label className="flex items-start gap-2 text-xs text-muted-foreground">
          <Checkbox
            checked={acknowledged}
            onCheckedChange={(v) => setAcknowledged(v === true)}
            className="mt-0.5"
          />
          <span>
            I&apos;ve reviewed the replacement policy above and believe this lead qualifies. I
            understand ineligible requests will be denied.
          </span>
        </label>

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
            disabled={!code || !acknowledged || busy}
            onClick={() => {
              if (code && acknowledged) onSubmit(code, detail.trim());
            }}
          >
            {busy ? "Submitting…" : "Submit request"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
