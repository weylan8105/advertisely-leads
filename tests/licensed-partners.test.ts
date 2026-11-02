import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Licensed Partners: license-field validation, the partner query, the public
 * page (/licensed-partners) and the profile API that stores the fields.
 * Mocked prisma + auth with SYNTHETIC data. Never touches a real DB/production.
 */

const prismaMock = { user: { findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn() } };
vi.mock("@/lib/prisma", () => ({
  isDatabaseConfigured: true,
  get prisma() { return prismaMock; },
}));
const getServerSession = vi.fn();
vi.mock("next-auth", () => ({ getServerSession: (...a: unknown[]) => getServerSession(...a) }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));

import { cleanLicenseFields, listLicensedPartners, renderLicensedPartnersPage, PARTNER_WINDOW_DAYS } from "@/lib/licensedPartners";
import { GET as partnersGET } from "@/app/licensed-partners/route";
import { POST as profilePOST } from "@/app/api/account/profile/route";

type Req = Parameters<typeof partnersGET>[0];
const partner = (o: Record<string, unknown> = {}) => ({
  licenseName: "Rivera Family Insurance LLC", licenseResidentState: "TX", licenseNpn: "12345678",
  licenseCaNumber: null, licenseTxNumber: "2345678", ...o,
});

beforeEach(() => vi.clearAllMocks());

describe("cleanLicenseFields", () => {
  it("normalizes the fields that are present and leaves others alone", () => {
    const { data, error } = cleanLicenseFields({
      licenseName: "  Ana   Ruiz ", licenseResidentState: "tx", licenseNpn: "1234-5678", licenseCaNumber: "0l 12345",
    });
    expect(error).toBeUndefined();
    expect(data).toEqual({ licenseName: "Ana Ruiz", licenseResidentState: "TX", licenseNpn: "12345678", licenseCaNumber: "0L12345" });
  });

  it("clears a field when sent empty", () => {
    expect(cleanLicenseFields({ licenseNpn: "", licenseTxNumber: " " }).data).toEqual({ licenseNpn: null, licenseTxNumber: null });
  });

  it("rejects bad values", () => {
    expect(cleanLicenseFields({ licenseNpn: "12AB" }).error).toMatch(/NPN/);
    expect(cleanLicenseFields({ licenseNpn: "12345678901" }).error).toMatch(/NPN/);
    expect(cleanLicenseFields({ licenseResidentState: "ZZ" }).error).toMatch(/resident state/);
    expect(cleanLicenseFields({ licenseCaNumber: "0L-1" }).error).toMatch(/California/);
    expect(cleanLicenseFields({ licenseName: "x".repeat(121) }).error).toMatch(/120/);
  });

  it("accepts DC as a resident state", () => {
    expect(cleanLicenseFields({ licenseResidentState: "dc" }).data.licenseResidentState).toBe("DC");
  });
});

describe("listLicensedPartners", () => {
  it("lists complete profiles that received a funnel lead recently or have an order being filled", async () => {
    prismaMock.user.findMany.mockResolvedValue([partner()]);
    const now = new Date("2026-11-02T12:00:00Z");
    const out = await listLicensedPartners(prismaMock as never, now);
    expect(out).toEqual([{ name: "Rivera Family Insurance LLC", residentState: "TX", npn: "12345678", caLicense: null, txLicense: "2345678" }]);
    const where = prismaMock.user.findMany.mock.calls[0][0].where;
    expect(where).toMatchObject({ licenseName: { not: null }, licenseResidentState: { not: null }, licenseNpn: { not: null } });
    const leadClause = where.OR[0].assignedLeads.some;
    expect(leadClause.source.in).toEqual(["early-retirement-quiz", "healthcare-wealth-quiz"]);
    expect(now.getTime() - leadClause.receivedAt.gte.getTime()).toBe(PARTNER_WINDOW_DAYS * 86_400_000);
    expect(where.OR[1].orders.some.status.in).toEqual(["PROCESSING", "DELIVERING"]);
  });

  it("collapses duplicate entries for the same license", async () => {
    prismaMock.user.findMany.mockResolvedValue([partner(), partner({ licenseName: "rivera family insurance llc" }), partner({ licenseNpn: "999" })]);
    expect(await listLicensedPartners(prismaMock as never)).toHaveLength(2);
  });
});

describe("renderLicensedPartnersPage", () => {
  const at = new Date("2026-11-02T18:00:00Z");

  it("shows the operator, the sharing statement and each partner's license details", () => {
    const html = renderLicensedPartnersPage({
      partners: [{ name: "Ana Ruiz", residentState: "CA", npn: "1111", caLicense: "0L12345", txLicense: null }], site: "abca", generatedAt: at,
    });
    expect(html).toContain("operated by Advertisely Media LLC, a marketing company");
    expect(html).toContain("Enhanced Wealth and the licensed insurance agents and agencies listed below");
    expect(html).toContain("Ana Ruiz");
    expect(html).toContain("NPN 1111");
    expect(html).toContain("CA license #0L12345");
    expect(html).not.toContain("TX license #");
    expect(html).toContain("Updated November 2, 2026");
    expect(html).toContain("https://www.americanbluecollaradvantage.com/privacy");
  });

  it("escapes partner-entered text", () => {
    const html = renderLicensedPartnersPage({
      partners: [{ name: '<script>alert("x")</script>', residentState: "TX", npn: "1", caLicense: null, txLicense: null }], site: "abca", generatedAt: at,
    });
    expect(html).not.toContain("<script>alert");
    expect(html).toContain("&lt;script&gt;");
  });

  it("brands for HWA and handles an empty list", () => {
    const html = renderLicensedPartnersPage({ partners: [], site: "hwa", generatedAt: at });
    expect(html).toContain("Healthcare Wealth Advantage is operated by Advertisely Media LLC");
    expect(html).toContain('href="/hwa-privacy.html"');
    expect(html).toContain("license details are being updated");
  });
});

describe("GET /licensed-partners", () => {
  it("serves cacheable HTML, branded by ?site", async () => {
    prismaMock.user.findMany.mockResolvedValue([partner()]);
    const res = await partnersGET(new Request("https://advertisely.io/licensed-partners?site=hwa") as unknown as Req);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(res.headers.get("cache-control")).toContain("s-maxage=600");
    const html = await res.text();
    expect(html).toContain("Healthcare Wealth Advantage");
    expect(html).toContain("Rivera Family Insurance LLC");
  });

  it("still renders if the DB query fails", async () => {
    prismaMock.user.findMany.mockRejectedValue(new Error("db down"));
    const res = await partnersGET(new Request("https://www.americanbluecollaradvantage.com/licensed-partners") as unknown as Req);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("license details are being updated");
  });
});

describe("POST /api/account/profile (license fields)", () => {
  const post = (body: unknown) =>
    profilePOST(new Request("https://advertisely.io/api/account/profile", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
    }) as unknown as Req);

  it("saves normalized license fields", async () => {
    getServerSession.mockResolvedValue({ user: { id: "u1" } });
    prismaMock.user.update.mockResolvedValue({ email: "a@mailbox.example.org", licensedStates: [], ...partner() });
    const res = await post({ licenseNpn: "1234 5678", licenseResidentState: "tx", licenseName: "Rivera Family Insurance LLC" });
    expect(res.status).toBe(200);
    expect(prismaMock.user.update.mock.calls[0][0].data).toEqual({
      licenseNpn: "12345678", licenseResidentState: "TX", licenseName: "Rivera Family Insurance LLC",
    });
    expect(await res.json()).toMatchObject({ licenseNpn: "12345678", licenseTxNumber: "2345678", licenseCaNumber: "" });
  });

  it("rejects an invalid NPN without saving", async () => {
    getServerSession.mockResolvedValue({ user: { id: "u1" } });
    const res = await post({ licenseNpn: "abc" });
    expect(res.status).toBe(400);
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  it("requires a session", async () => {
    getServerSession.mockResolvedValue(null);
    expect((await post({ licenseNpn: "1" })).status).toBe(401);
  });
});
