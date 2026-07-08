import { getToken } from "next-auth/jwt";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getAppSecret } from "@/lib/secret";

const PUBLIC_PREFIXES = ["/login", "/register", "/api/auth/", "/quorum-mark.png"];

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (PUBLIC_PREFIXES.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  const token = await getToken({ req: request, secret: getAppSecret() });
  if (!token) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const loginUrl = new URL("/login", request.url);
    // Use a relative callbackUrl (path + query only). In `next start`, middleware's
    // request.url host resolves to localhost regardless of the Host header, so an
    // absolute callbackUrl would redirect post-login to localhost — unreachable when
    // the app is accessed over the LAN IP. A relative path stays on the current host.
    loginUrl.searchParams.set("callbackUrl", request.nextUrl.pathname + request.nextUrl.search);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
