import { stateCode, stateName } from "@/data/states";
import type { Lead } from "@/types";

export function searchWords(query: string) {
  return query.toLowerCase().trim().split(/\s+/).filter(Boolean);
}

/**
 * Every word must match the text or the phone. The phone matches on digits, so
 * "214-555", "(214) 555" and "214555" all find the same number.
 */
export function matchesWords(words: string[], text: string, phone?: string | null) {
  const hay = text.toLowerCase();
  const phoneDigits = (phone || "").replace(/\D/g, "");
  return words.every((w) => {
    if (hay.includes(w)) return true;
    const d = w.replace(/\D/g, "");
    return d.length >= 3 && phoneDigits.includes(d);
  });
}

/** The pipeline board and list view search the same fields. */
export function leadMatchesSearch(l: Lead, words: string[]) {
  const notes = (l.notes ?? []).map((n) => String((n as { body?: unknown }).body ?? "")).join(" ");
  const text = [l.name, l.email, l.phone, l.state, l.state ? stateName(stateCode(l.state) ?? l.state) : "", l.zip, l.occupation, l.leadTypeLabel, l.source, l.id, ...(l.tags ?? []), notes]
    .filter(Boolean).join(" ");
  return matchesWords(words, text, l.phone);
}
