import { NextRequest, NextResponse } from "next/server";
import { VIEW_AS_COOKIE, VIEW_ONLY_MESSAGE, isBlockedWhileViewing } from "@/lib/viewAs";

/**
 * While an admin is viewing a client's account (lib/viewAs.ts) every change is
 * refused, so looking can't buy, edit or message anything as the client. The
 * cookie can only ever take access away here, so nobody gains anything by
 * setting it themselves.
 */
export function middleware(req: NextRequest) {
  if (req.cookies.get(VIEW_AS_COOKIE)?.value && isBlockedWhileViewing(req.method, req.nextUrl.pathname)) {
    return NextResponse.json({ error: VIEW_ONLY_MESSAGE, viewOnly: true }, { status: 403 });
  }
  return NextResponse.next();
}

export const config = { matcher: ["/api/:path*"] };
