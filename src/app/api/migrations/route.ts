import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-helpers";
import { listMigrations } from "@/lib/migrations";

export async function GET() {
  const result = await requireAuth();
  if (result instanceof NextResponse) return result;
  return NextResponse.json({ migrations: listMigrations(result.userId) });
}
