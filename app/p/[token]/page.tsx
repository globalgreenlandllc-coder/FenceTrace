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

  // Only the ONE published demo token renders the sample portal (the
  // landing page links it). Any other unknown token is a dead link —
  // showing a homeowner fabricated proposal data would be worse than a
  // 404.
  if (token === sampleProposal.token) {
    return <ClientPortalView proposal={{ ...sampleProposal, token }} />;
  }
  notFound();
}
