import type { Metadata } from "next";
import Link from "next/link";
import {
  LegalShell,
  LegalSection,
  LegalList,
} from "@/components/legal/legal-shell";

export const metadata: Metadata = {
  title: "Terms of Service — FenceTrace",
  description:
    "The terms that govern use of FenceTrace, the AI takeoff and proposal platform by FenceTrace Inc.",
};

const UPDATED = "July 11, 2026";
const CONTACT = "hello@fencetrace.com";

export default function TermsPage() {
  return (
    <LegalShell title="Terms of Service" updated={UPDATED}>
      <LegalSection id="agreement" title="1. The agreement">
        <p>
          These Terms of Service (&ldquo;Terms&rdquo;) are a contract between
          you and <strong>FenceTrace Inc.</strong> (&ldquo;FenceTrace&rdquo;,
          &ldquo;we&rdquo;, &ldquo;us&rdquo;) governing your use of the
          FenceTrace application and website at fencetrace.com. By creating an
          account or using the service you agree to these Terms and to our{" "}
          <Link href="/privacy" className="text-accent-700 underline">
            Privacy Policy
          </Link>
          . If you use FenceTrace on behalf of a company, you represent that
          you can bind that company to these Terms.
        </p>
      </LegalSection>

      <LegalSection id="service" title="2. The service">
        <p>
          FenceTrace provides AI-assisted fence takeoffs from
          property addresses and construction plans, plus tools to build, send,
          and collect on proposals. You must be at least 18 and use the service
          only for lawful business purposes.
        </p>
      </LegalSection>

      <LegalSection id="estimates" title="3. Estimates are estimates">
        <p>
          AI measurements are produced from aerial imagery and uploaded plans
          and are provided <strong>for estimating purposes only</strong>. They
          can be wrong. You are responsible for verifying measurements,
          pricing, and scope before relying on them, bidding, ordering
          materials, or performing work. FenceTrace is not liable for job
          outcomes, bid losses, or material overruns resulting from measurement
          differences.
        </p>
      </LegalSection>

      <LegalSection id="your-content" title="4. Your content and your clients">
        <LegalList
          items={[
            "You retain ownership of everything you upload and create: plans, takeoffs, proposals, client records.",
            "You grant us the limited license needed to host, process (including AI processing), display, and transmit that content to operate the service.",
            "You are responsible for having the right to enter your clients' information and for how you use proposals and communications sent through the platform.",
            "You may not upload content that is unlawful, infringing, or malicious.",
          ]}
        />
      </LegalSection>

      <LegalSection id="billing" title="5. Plans, credits, and billing">
        <LegalList
          items={[
            "FenceTrace Pro is billed monthly through Stripe and unlocks unlimited proposal sending; the free plan sends up to three proposals per calendar month.",
            "Property scans, measurements, and takeoffs are free on every plan.",
            "You can cancel anytime from Settings; your plan stays active until the end of the paid period. Fees already paid are non-refundable except where required by law.",
            "We may change pricing with at least 30 days' notice before it affects your next renewal.",
          ]}
        />
      </LegalSection>

      <LegalSection id="acceptable-use" title="6. Acceptable use">
        <p>You agree not to:</p>
        <LegalList
          items={[
            "resell, scrape, or programmatically extract the service or its data without our written consent;",
            "circumvent usage limits, credits, or security and rate-limiting controls;",
            "use the platform to send spam or unlawful communications — proposal and reminder emails must go to clients who expect them;",
            "reverse engineer the service except where the law permits it despite this clause.",
          ]}
        />
        <p>
          We may suspend or terminate accounts that violate these Terms or
          create risk for the platform or other users.
        </p>
      </LegalSection>

      <LegalSection id="third-party" title="7. Third-party services">
        <p>
          The service depends on third-party providers (identified in our
          Privacy Policy), including the Google Maps Platform. Your use of
          Google Maps features through FenceTrace is also subject to the{" "}
          <a
            href="https://maps.google.com/help/terms_maps/"
            target="_blank"
            rel="noopener noreferrer"
            className="text-accent-700 underline"
          >
            Google Maps/Google Earth Additional Terms of Service
          </a>
          . Payments you collect from your clients are between you and them; if
          you connect payment links (Stripe, Square), those providers&rsquo;
          terms apply.
        </p>
      </LegalSection>

      <LegalSection id="disclaimers" title="8. Disclaimers and liability">
        <p>
          The service is provided <strong>&ldquo;as is&rdquo;</strong> without
          warranties of any kind, express or implied, including fitness for a
          particular purpose and accuracy of measurements. To the maximum
          extent permitted by law, FenceTrace Inc. will not be liable for
          indirect, incidental, special, consequential, or punitive damages, or
          lost profits; and our total liability for any claim is limited to the
          amounts you paid us in the 12 months before the claim arose.
        </p>
      </LegalSection>

      <LegalSection id="termination" title="9. Termination">
        <p>
          You may stop using FenceTrace and request account deletion at any
          time. We may suspend or terminate the service for material breach of
          these Terms, with notice where practicable. Sections that by their
          nature should survive (ownership, disclaimers, liability limits)
          survive termination.
        </p>
      </LegalSection>

      <LegalSection id="changes" title="10. Changes to these Terms">
        <p>
          We may update these Terms as the product evolves. Material changes
          will be announced in the app or by email before they take effect.
          Continued use after a change means you accept the updated Terms.
        </p>
      </LegalSection>

      <LegalSection id="contact" title="11. Contact">
        <p>
          FenceTrace Inc. &middot;{" "}
          <a href={`mailto:${CONTACT}`} className="text-accent-700 underline">
            {CONTACT}
          </a>
        </p>
      </LegalSection>
    </LegalShell>
  );
}
