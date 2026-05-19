import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-helpers";

export async function POST(req: Request) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const { orgUrl, apiToken } = await req.json();
  if (!orgUrl || !apiToken) {
    return NextResponse.json({ error: "orgUrl and apiToken are required" }, { status: 400 });
  }

  try {
    const res = await fetch(`${orgUrl.trim().replace(/\/$/, "")}/api/v1/org`, {
      headers: {
        Authorization: `SSWS ${apiToken}`,
        Accept: "application/json",
      },
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      const message = body.errorSummary ?? body.message ?? `HTTP ${res.status}`;
      return NextResponse.json({ ok: false, error: message });
    }

    const org = await res.json();
    return NextResponse.json({ ok: true, orgName: org.companyName ?? org.name ?? orgUrl });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "Connection failed" });
  }
}
