import { notFound } from "next/navigation";
import { sampleProposal } from "@/lib/proposal-mock";
import { ClientPortalView } from "@/components/client-portal/client-portal-view";
import { getProposalByToken } from "@/app/actions/proposals";
import { getPortalStateByToken } from "@/app/actions/payments";
import { getDiscountThreadByToken } from "@/app/actions/discounts";

export default async function PublicProposalPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  if (!token || token.length < 3) {
    notFound();
  }

  const real = await getProposalByToken(token);
  if (real) {
    // Accepted proposals swap the sign-and-accept flow for the payment
    // hub (schedule, progress, change-order approvals). Null for
    // proposals that aren't accepted yet.
    const portal = await getPortalStateByToken(token);
    // Price negotiation lives in the pre-acceptance flow only; skip the
    // read once the payment hub has taken over.
    const discountThread = portal ? null : await getDiscountThreadByToken(token);
    return (
      <ClientPortalView
        proposal={{ ...real, token }}
        portal={portal}
        discountThread={discountThread}
        audioEnabled
      />
    );
  }

  // Demo fallback: tokens not backed by a real proposal still render the
  // sample portal so /p/demo-7f3a2 keeps working as a sales preview.
  return <ClientPortalView proposal={{ ...sampleProposal, token }} />;
}
