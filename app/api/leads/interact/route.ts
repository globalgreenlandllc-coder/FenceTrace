import { NextResponse } from "next/server";
import { InteractionStatus } from "@prisma/client";
import { auth } from "@clerk/nextjs/server";

import { db } from "@/lib/db";

export async function POST(request: Request) {
  const { userId: clerkId } = await auth();

  if (!clerkId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { leadId, status, notes } = await request.json();

    if (!leadId || !status || !(status in InteractionStatus)) {
      return NextResponse.json({ error: "Missing or invalid fields" }, { status: 400 });
    }

    const user = await db.user.findUnique({ where: { clerkId } });
    if (!user) {
      return NextResponse.json({ error: "User not found in DB" }, { status: 404 });
    }

    const interaction = await db.userLeadInteraction.upsert({
      where: {
        userId_leadId: { userId: user.id, leadId },
      },
      update: {
        status: status as InteractionStatus,
        ...(notes !== undefined && { notes }),
      },
      create: {
        userId: user.id,
        leadId,
        status: status as InteractionStatus,
        ...(notes !== undefined && { notes }),
      },
    });

    return NextResponse.json({ success: true, interaction });
  } catch (error: any) {
    console.error("[POST /api/leads/interact] Error:", error);
    return NextResponse.json({ error: "Failed to save interaction" }, { status: 500 });
  }
}
