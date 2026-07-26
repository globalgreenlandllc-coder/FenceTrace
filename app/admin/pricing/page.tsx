import { PlanPricingEditor } from "@/components/admin/plan-pricing-editor";
import { getPlanPricingAdmin } from "@/app/actions/plan-pricing";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Pricing — Admin",
};

export default async function AdminPricingPage() {
  const initial = await getPlanPricingAdmin();
  return (
    <div>
      <div className="mb-6">
        <h1 className="text-lg font-semibold tracking-tight text-zinc-900">
          Pricing
        </h1>
        <p className="mt-1 max-w-2xl text-sm text-zinc-500">
          One source of truth for the Pro plan and credit packs. Checkout
          charges these exact amounts (prices are inline — there are no Stripe
          dashboard products), and the landing page and in-app billing copy
          update on publish.
        </p>
      </div>
      <PlanPricingEditor initial={initial} />
    </div>
  );
}
