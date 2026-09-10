import type { Prisma } from "@prisma/client";

/**
 * Obviously-fake / internal test leads. These must NEVER be delivered to a buyer
 * or counted as sellable inventory — they only exist from our own testing.
 * Matched by test/admin name or a known admin/test email fragment.
 *
 * Extend these lists if new test identities show up.
 */
export const TEST_NAME_PATTERNS = ["ryan hernandez", "weylan walker"];
export const TEST_EMAIL_PATTERNS = [
  "ryanrush129",
  "weylanwalker",
  "weylanw@",
  "@example.com",
  "test@advertisely",
];

/** Prisma filter that MATCHES a fake/test lead (by name or email). */
export const TEST_LEAD_WHERE: Prisma.LeadWhereInput = {
  OR: [
    ...TEST_NAME_PATTERNS.map((p) => ({ name: { contains: p, mode: "insensitive" as const } })),
    ...TEST_EMAIL_PATTERNS.map((p) => ({ email: { contains: p, mode: "insensitive" as const } })),
  ],
};

/** Prisma filter fragment to EXCLUDE fake/test leads (spread into a `where`). */
export const NOT_TEST_LEAD: Prisma.LeadWhereInput = { NOT: TEST_LEAD_WHERE };
