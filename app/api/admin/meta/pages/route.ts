import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma, isDatabaseConfigured } from "@/lib/prisma";
import { validatePageToken, subscribePageToLeadgen } from "@/lib/meta";

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
  return NextResponse.json({ pages });
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
    pageAccessToken: string;
  };
  if (!body.pageId || !body.pageAccessToken) {
    return NextResponse.json(
      { error: "pageId and pageAccessToken are required" },
      { status: 400 },
    );
  }

  // 1. Validate the token before storing it — a bad token is the #1 reason a
  //    "connected" page silently delivers nothing. Reject early with a clear
  //    message rather than saving a dead connection.
  const validation = await validatePageToken(body.pageId, body.pageAccessToken);
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
  const subscription = await subscribePageToLeadgen(
    body.pageId,
    body.pageAccessToken,
  );

  const page = await prisma.metaPageConnection.upsert({
    where: { pageId: body.pageId },
    update: {
      // Prefer the real page name from Meta if the admin left the field blank.
      pageName: body.pageName || validation.name || body.pageId,
      pageAccessToken: body.pageAccessToken,
      enabled: true,
      subscribedAt: subscription.ok ? new Date() : null,
      subscriptionError: subscription.ok ? null : subscription.error ?? null,
    },
    create: {
      pageId: body.pageId,
      pageName: body.pageName || validation.name || body.pageId,
      pageAccessToken: body.pageAccessToken,
      subscribedAt: subscription.ok ? new Date() : null,
      subscriptionError: subscription.ok ? null : subscription.error ?? null,
    },
  });

  const { pageAccessToken: _omit, ...safePage } = page;
  return NextResponse.json({ page: safePage, subscription });
}
