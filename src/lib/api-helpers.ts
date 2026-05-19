import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { getUserConfig, UserConfig } from "@/lib/user-config";

async function getAuthenticatedUserId(): Promise<string | null> {
  const session = await getServerSession(authOptions);
  if (!session?.user) return null;
  return (session.user as { id: string }).id;
}

export async function requireAuth(): Promise<{ userId: string } | NextResponse> {
  const userId = await getAuthenticatedUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return { userId };
}

export async function requireUserConfig(): Promise<
  { config: UserConfig; userId: string } | NextResponse
> {
  const userId = await getAuthenticatedUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const config = getUserConfig(userId);
  if (!config) {
    return NextResponse.json(
      { error: "Integration not configured. Please visit Settings to connect your Okta and Entra ID accounts." },
      { status: 400 },
    );
  }

  return { config, userId };
}
