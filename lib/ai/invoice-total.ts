import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { getActiveApiKey } from "@/lib/api-keys";

/**
 * invoice-total.ts — reads an owner-attached job file (invoice / design PDF or
 * photo) and pulls out the final invoice total, so the assign-job flow can
 * auto-compute percent-based worker pay ("crew gets 10% of the job").
 *
 * Deliberately tiny + cheap (Haiku): one number out, null when the file has
 * no clear total. The owner always sees and can override the result — this
 * prefills a field, it never silently sets pay.
 */

const MODEL = "claude-haiku-4-5-20251001";

export type InvoiceTotalResult = {
  totalCents: number | null;
  /** Short human note, e.g. 'Found "Total Due $4,830.00" on page 2'. */
  note: string | null;
};

export async function extractInvoiceTotal(source: {
  base64: string;
  mimeType: string;
}): Promise<InvoiceTotalResult> {
  const apiKey =
    (await getActiveApiKey("ANTHROPIC")) ?? process.env.ANTHROPIC_API_KEY ?? null;
  if (!apiKey) return { totalCents: null, note: null };

  const client = new Anthropic({ apiKey });

  const fileBlock =
    source.mimeType === "application/pdf"
      ? {
          type: "document" as const,
          source: {
            type: "base64" as const,
            media_type: "application/pdf" as const,
            data: source.base64,
          },
        }
      : {
          type: "image" as const,
          source: {
            type: "base64" as const,
            media_type: source.mimeType as "image/png" | "image/jpeg" | "image/webp",
            data: source.base64,
          },
        };

  try {
    const res = await client.messages.create({
      model: MODEL,
      max_tokens: 300,
      tools: [
        {
          name: "report_invoice_total",
          description: "Report the final invoice/contract total found in the document.",
          input_schema: {
            type: "object" as const,
            properties: {
              total_dollars: {
                type: ["number", "null"],
                description:
                  "The FINAL amount charged to the client (grand total / total due, tax included), in dollars. null if no clear final total exists.",
              },
              note: {
                type: "string",
                description: "Where the total was found, one short sentence.",
              },
            },
            required: ["total_dollars"],
          },
        },
      ],
      tool_choice: { type: "tool", name: "report_invoice_total" },
      messages: [
        {
          role: "user",
          content: [
            fileBlock,
            {
              type: "text",
              text: "This is a job file a contractor attached (invoice, contract, or design with pricing). Find the FINAL total the client is charged — the grand total / total due, after tax and discounts. If several totals appear, pick the final payable one. If the document has no clear final total (e.g. it's only a drawing), report null.",
            },
          ],
        },
      ],
    });

    const toolUse = res.content.find((c) => c.type === "tool_use");
    if (!toolUse || toolUse.type !== "tool_use") return { totalCents: null, note: null };
    const input = toolUse.input as { total_dollars?: number | null; note?: string };
    const dollars = input.total_dollars;
    if (typeof dollars !== "number" || !Number.isFinite(dollars) || dollars <= 0) {
      return { totalCents: null, note: input.note ?? null };
    }
    return { totalCents: Math.round(dollars * 100), note: input.note ?? null };
  } catch (e) {
    console.error("[extractInvoiceTotal] threw", e);
    return { totalCents: null, note: null };
  }
}
