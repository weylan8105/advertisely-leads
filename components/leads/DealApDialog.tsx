"use client";

import { useCallback, useRef, useState } from "react";
import { Trophy } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { WON_STAGE_ID, isConversionStage } from "@/data/pipeline";

interface ApRequest {
  leadName: string;
  stageId: string;
  stageLabel: string;
  fromStageId: string | undefined;
  initialCents: number | null | undefined;
  resolve: (cents: number | null) => void;
}

const MAX_AP_DOLLARS = 1_000_000;

/**
 * Moving a lead to Underwriting or any later deal stage needs its annual
 * premium (AP). `ask` opens a pop-up the agent has to confirm and resolves to
 * the AP in cents, or null if they cancel (the move is then skipped).
 */
export function useDealApPrompt() {
  const [req, setReq] = useState<ApRequest | null>(null);
  const ask = useCallback(
    (opts: Omit<ApRequest, "resolve">) =>
      new Promise<number | null>((resolve) => setReq({ ...opts, resolve })),
    [],
  );
  const finish = (cents: number | null) => {
    req?.resolve(cents);
    setReq(null);
  };
  const dialog = req ? <DealApDialog req={req} onDone={finish} /> : null;
  return { ask, dialog };
}

function DealApDialog({ req, onDone }: { req: ApRequest; onDone: (cents: number | null) => void }) {
  const [value, setValue] = useState(req.initialCents ? String(req.initialCents / 100) : "");
  const [error, setError] = useState<string | null>(null);
  const done = useRef(false);
  const sold = req.stageId === WON_STAGE_ID;
  const newDeal = !isConversionStage(req.fromStageId ?? "");

  function confirm() {
    const dollars = parseFloat(value.replace(/[^0-9.]/g, ""));
    if (!Number.isFinite(dollars) || dollars <= 0) {
      setError("Enter the annual premium (AP). It's required for this stage.");
      return;
    }
    if (dollars > MAX_AP_DOLLARS) {
      setError("That looks too high. Enter the annual premium in dollars.");
      return;
    }
    done.current = true;
    onDone(Math.round(dollars * 100));
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !done.current) {
          done.current = true;
          onDone(null);
        }
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Trophy className="h-5 w-5 text-amber-500" />
            {sold ? "Policy issued & paid" : newDeal ? "Submit this deal" : `Move to ${req.stageLabel}`}
          </DialogTitle>
          <DialogDescription>
            {req.leadName} → <span className="font-medium text-foreground">{req.stageLabel}</span>. Enter the annual premium
            (AP). It becomes this lead&apos;s value and counts on the leaderboard right away.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            confirm();
          }}
          className="space-y-2"
        >
          <label className="text-xs font-medium text-foreground" htmlFor="deal-ap">
            Annual premium (AP)
          </label>
          <div className="relative">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">$</span>
            <input
              id="deal-ap"
              autoFocus
              inputMode="decimal"
              value={value}
              onChange={(e) => {
                setValue(e.target.value);
                setError(null);
              }}
              placeholder="e.g. 3,600"
              className="h-10 w-full rounded-md border border-slate-300 pl-6 pr-3 text-base tabular-nums outline-none focus:border-brand-red focus:ring-2 focus:ring-brand-red/15"
            />
          </div>
          {error && <p className="text-xs text-rose-600">{error}</p>}
          {newDeal && (
            <p className="text-xs text-muted-foreground">
              Everyone on Advertisely gets a live alert with your name and the AP (never the client&apos;s name).
            </p>
          )}
          <DialogFooter className="gap-2 pt-2 sm:gap-0">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                done.current = true;
                onDone(null);
              }}
            >
              Cancel
            </Button>
            <Button type="submit">{newDeal && !sold ? "Confirm & submit" : "Confirm"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
