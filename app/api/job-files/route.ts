import { NextResponse } from "next/server";
import { put } from "@vercel/blob";
import { auth } from "@clerk/nextjs/server";

import { db } from "@/lib/db";
import { consumeLimit } from "@/lib/abuse/rate-limit";
import { POLICIES } from "@/lib/abuse/policies";
import { extractInvoiceTotal } from "@/lib/ai/invoice-total";
import { resolveBlobToken } from "@/lib/blob";

/**
 * Job-file upload for the assign-job flow: the owner attaches the actual job
 * file (design / invoice PDF or photo) that the worker will see in their
 * portal. The file goes to Vercel Blob; while it's in memory we also run a
 * cheap AI pass that reads the invoice total, so the UI can prefill
 * percent-based worker pay. The extracted number is a suggestion — the owner
 * reviews and can override it before assigning.
 */

export const runtime = "nodejs";
export const maxDuration = 60;

const ALLOWED_TYPES = ["application/pdf", "image/png", "image/jpeg", "image/webp"];
const MAX_BYTES = 16 * 1024 * 1024; // 16 MB — well under Anthropic's 32 MB PDF cap

export async function POST(request: Request) {
  try {
    const { userId: clerkId } = await auth();
    if (!clerkId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const user = await db.user.findUnique({ where: { clerkId }, select: { id: true } });
    if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });

    // Distinct key from the blueprint routes so attaching job files never eats
    // the (credit-metered) blueprint-upload budget, and vice-versa.
    const rl = await consumeLimit({
      policy: POLICIES.blueprintUpload,
      key: `jobfile:${user.id}`,
      context: { userId: user.id, route: "/api/job-files" },
    });
    if (!rl.ok) {
      return NextResponse.json(
        { error: rl.reason },
        { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } },
      );
    }

    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Missing file" }, { status: 400 });
    }
    if (!ALLOWED_TYPES.includes(file.type)) {
      return NextResponse.json(
        { error: "Use a PDF or an image (PNG/JPG/WebP)" },
        { status: 415 },
      );
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: "File is over 16 MB" }, { status: 413 });
    }

    const token = resolveBlobToken();
    if (!token) {
      return NextResponse.json(
        { error: "File storage is not configured on this deployment" },
        { status: 500 },
      );
    }

    const bytes = Buffer.from(await file.arrayBuffer());
    const safeName = (file.name || "job-file").replace(/[^\w.\- ]+/g, "_").slice(0, 80);
    // Upload and invoice-read both only need the in-memory bytes and don't
    // depend on each other — run them together so the owner waits max(), not
    // sum(). Extraction is best-effort (returns nulls on failure).
    const [blob, extraction] = await Promise.all([
      put(`job-files/${user.id}/${safeName}`, bytes, {
        access: "public",
        addRandomSuffix: true,
        contentType: file.type,
        token,
      }),
      extractInvoiceTotal({ base64: bytes.toString("base64"), mimeType: file.type }),
    ]);

    return NextResponse.json({
      url: blob.url,
      name: file.name || safeName,
      mimeType: file.type,
      totalCents: extraction.totalCents,
      note: extraction.note,
    });
  } catch (e) {
    console.error("[job-files] upload failed", e);
    return NextResponse.json({ error: "Upload failed" }, { status: 500 });
  }
}
