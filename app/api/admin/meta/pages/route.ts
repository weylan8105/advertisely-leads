import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma, isDatabaseConfigured } from "@/lib/prisma";
import { validatePageToken, subscribePageToLeadgen } from "@/lib/meta";
import { systemUserPageToken } from "@/lib/metaAds";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function requireAdmin() {
  const session = await getServerSession(authOptions);
  if (!session?.user) return null;
  const role = (session.user as any).role;
  if (role !== "ADMIN") return null;
  return session;
}

export async function GET() {
  if (!isDatabaseConfigured || !prisma) {
    return NextResponse.json(
      { error: "Database not configured" },
      { status: 503 },
    );
  }
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Never ship the page access token to the browser — only the fields the
  // admin UI needs to render status and form mappings.
  const pages = await prisma.metaPageConnection.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      pageId: true,
      pageName: true,
      enabled: true,
      subscribedAt: true,
      subscriptionError: true,
      createdAt: true,
      formMappings: true,
    },
  });

  // Attach each exclusive form's owner (email + name) so the UI can show who a
  // form delivers to. One lookup for all owners across every page.
  const ownerIds = [
    ...new Set(
      pages.flatMap((p) => p.formMappings.map((m) => m.ownerUserId).filter((x): x is string => !!x)),
    ),
  ];
  const owners = ownerIds.length
    ? await prisma.user.findMany({ where: { id: { in: ownerIds } }, select: { id: true, name: true, email: true } })
    : [];
  const ownerById = Object.fromEntries(owners.map((u) => [u.id, u]));
  const pagesWithOwners = pages.map((p) => ({
    ...p,
    formMappings: p.formMappings.map((m) => ({
      ...m,
      ownerEmail: m.ownerUserId ? ownerById[m.ownerUserId]?.email ?? null : null,
      ownerName: m.ownerUserId ? ownerById[m.ownerUserId]?.name ?? null : null,
    })),
  }));

  return NextResponse.json({ pages: pagesWithOwners });
}

export async function POST(req: NextRequest) {
  if (!isDatabaseConfigured || !prisma) {
    return NextResponse.json(
      { error: "Database not configured" },
      { status: 503 },
    );
  }
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = (await req.json()) as {
    pageId: string;
    pageName: string;
    pageAccessToken?: string;
  };
  body.pageId = body.pageId?.trim();
  if (!body.pageId) {
    return NextResponse.json({ error: "pageId is required" }, { status: 400 });
  }

  // No pasted token: mint a non-expiring Page token from the System User the
  // ad uploader already uses, so nobody has to copy tokens out of Graph Explorer.
  if (!body.pageAccessToken?.trim()) {
    const minted = await systemUserPageToken(body.pageId);
    if (!minted) {
      return NextResponse.json(
        {
          error:
            "The Advertisely Uploader system user can't reach this Page. In Business Settings → System users, assign the Page to it with lead access, or paste a Page token instead.",
        },
        { status: 400 },
      );
    }
    body.pageAccessToken = minted;
  }
  const pageAccessToken = body.pageAccessToken.trim();

  // 1. Validate the token before storing it — a bad token is the #1 reason a
  //    "connected" page silently delivers nothing. Reject early with a clear
  //    message rather than saving a dead connection.
  const validation = await validatePageToken(body.pageId, pageAccessToken);
  if (!validation.ok) {
    return NextResponse.json(
      {
        error: `Page token rejected by Meta: ${validation.error ?? "unknown error"}`,
      },
      { status: 400 },
    );
  }

  // 2. Subscribe the page to the app's leadgen webhook. Without this Meta sends
  //    no events, so we treat a failure as non-fatal but record it so the admin
  //    sees the page needs attention instead of assuming leads will flow.
  const subscription = await subscribePageToLeadgen(body.pageId, pageAccessToken);

  const page = await prisma.metaPageConnection.upsert({
    where: { pageId: body.pageId },
    update: {
      // Prefer the real page name from Meta if the admin left the field blank.
      pageName: body.pageName || validation.name || body.pageId,
      pageAccessToken,
      enabled: true,
      subscribedAt: subscription.ok ? new Date() : null,
      subscriptionError: subscription.ok ? null : subscription.error ?? null,
    },
    create: {
      pageId: body.pageId,
      pageName: body.pageName || validation.name || body.pageId,
      pageAccessToken,
      subscribedAt: subscription.ok ? new Date() : null,
      subscriptionError: subscription.ok ? null : subscription.error ?? null,
    },
  });

  const { pageAccessToken: _omit, ...safePage } = page;
  return NextResponse.json({ page: safePage, subscription });
}
