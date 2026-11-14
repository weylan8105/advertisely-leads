// Live deal alerts (components/layout/DealAlerts.tsx, /api/deals/live).

/** "Jace Jensen" → "Jace J." — agents see who submitted, not full names. */
export function shortName(name: string | null | undefined): string {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "An agent";
  return parts.length > 1 ? `${parts[0]} ${parts[parts.length - 1][0].toUpperCase()}.` : parts[0];
}
