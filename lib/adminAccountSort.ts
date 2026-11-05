export interface SortableAccount {
  orderedQty: number;
  subscription: unknown;
  delivered: number;
  joinedAt: Date | string | null;
}

/** An unfinished lead order, or a running weekly subscription. */
export function hasOpenOrder(a: SortableAccount) {
  return a.orderedQty > 0 || !!a.subscription;
}

/**
 * Admin Client accounts order: open orders first, then everyone else. Within
 * each group most leads delivered first, and accounts with no leads newest
 * signup first.
 */
export function compareAccounts(a: SortableAccount, b: SortableAccount) {
  return (
    Number(hasOpenOrder(b)) - Number(hasOpenOrder(a)) ||
    b.delivered - a.delivered ||
    new Date(b.joinedAt ?? 0).getTime() - new Date(a.joinedAt ?? 0).getTime()
  );
}
