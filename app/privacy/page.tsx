import type { Metadata } from "next";
import Link from "next/link";
import {
  LegalShell,
  LegalSection,
  LegalList,
} from "@/components/legal/legal-shell";

export const metadata: Metadata = {
  title: "Privacy Policy — FenceScan",
  description:
    "How FenceScan (FenceScan Inc.) collects, uses, and protects your information, including data received from Google APIs.",
};

const UPDATED = "July 11, 2026";
const CONTACT = "hello@fencescan.com";

export default function PrivacyPolicyPage() {
  return (
    <LegalShell title="Privacy Policy" updated={UPDATED}>
      <LegalSection id="who-we-are" title="1. Who we are">
        <p>
          FenceScan is an AI takeoff and proposal platform for fence
          contractors, operated by <strong>FenceScan Inc.</strong>{" "}
          (&ldquo;FenceScan&rdquo;, &ldquo;we&rdquo;, &ldquo;us&rdquo;). This
          policy explains what information we collect through the FenceScan
          application and website at{" "}
          <Link href="/" className="text-accent-700 underline">
            fencescan.com
          </Link>
          , how we use it, and the choices you have. It applies to contractors
          who create FenceScan accounts and to the homeowner information
          contractors enter while preparing estimates and proposals.
        </p>
        <p>
          Questions or requests about this policy can be sent to{" "}
          <a href={`mailto:${CONTACT}`} className="text-accent-700 underline">
            {CONTACT}
          </a>
          .
        </p>
      </LegalSection>

      <LegalSection id="information-we-collect" title="2. Information we collect">
        <LegalList
          items={[
            <span key="account">
              <strong>Account information.</strong> When you sign up we collect
              your name, email address, and profile photo through our sign-in
              provider (Clerk), including when you choose to sign in with
              Google. We also store the business profile you fill in: company
              name, contractor name, phone number, license number, and logo.
            </span>,
            <span key="client">
              <strong>Client information you enter.</strong> To build estimates
              and proposals you may enter your customers&rsquo; names, email
              addresses, phone numbers, and property addresses. You are
              responsible for having the right to share that information with
              us; we process it only to provide the service to you.
            </span>,
            <span key="property">
              <strong>Property and project data.</strong> Property addresses
              you scan, aerial imagery and fence measurements derived from those
              addresses, construction plans (PDF or image files) you upload,
              takeoff geometry, pricing, proposals, payment schedules, and
              change orders.
            </span>,
            <span key="billing">
              <strong>Billing information.</strong> Subscriptions and credit
              packs are processed by Stripe. We store your Stripe customer ID,
              plan status, and transaction records (amounts, dates).{" "}
              <strong>We never see or store your full card number.</strong>
            </span>,
            <span key="usage">
              <strong>Usage and log data.</strong> Actions taken in the app
              (estimates run, proposals sent and viewed), device and browser
              information, IP addresses, and timestamps. Proposal views by your
              clients record an IP address and browser string so you can see
              that the proposal was opened. We also keep rate-limiting and
              abuse-prevention logs.
            </span>,
            <span key="comms">
              <strong>Communications.</strong> Emails sent through the platform
              on your behalf (proposals, receipts, payment reminders, crew
              invitations) and any messages you send us.
            </span>,
          ]}
        />
      </LegalSection>

      <LegalSection id="how-we-use" title="3. How we use information">
        <LegalList
          items={[
            "Provide the service: geocode addresses, retrieve aerial imagery, measure fence lines, generate takeoffs, build and deliver proposals, and process payments schedules.",
            "Send transactional email you initiate — proposals to your clients, receipts, payment reminders, and crew invitations — through our email provider.",
            "Operate billing: subscriptions, included monthly credits, and credit-pack purchases.",
            "Keep the platform safe: authentication, rate limiting, fraud and abuse prevention, and enforcement of usage limits.",
            "Improve the product using aggregated, de-identified usage statistics (for example, average measurement accuracy). We do not use your uploaded plans or client data to train our own or anyone else's machine-learning models.",
            "Comply with legal obligations and enforce our Terms of Service.",
          ]}
        />
        <p>
          We do <strong>not</strong> sell personal information, and we do not
          use it for third-party advertising.
        </p>
      </LegalSection>

      <LegalSection id="google-user-data" title="4. Google user data (Sign in with Google)">
        <p>
          If you sign in with Google, we receive your Google account&rsquo;s
          basic profile information: your name, email address, and profile
          picture. We use this information solely to create and secure your
          FenceScan account and to display your identity inside the app. We do
          not request access to your Gmail, Drive, Calendar, or any other
          Google content.
        </p>
        <p>
          FenceScan&rsquo;s use and transfer to any other app of information
          received from Google APIs will adhere to the{" "}
          <a
            href="https://developers.google.com/terms/api-services-user-data-policy"
            target="_blank"
            rel="noopener noreferrer"
            className="text-accent-700 underline"
          >
            Google API Services User Data Policy
          </a>
          , including the Limited Use requirements. Specifically, we:
        </p>
        <LegalList
          items={[
            "only use Google user data to provide and improve the sign-in and account features described here;",
            "do not transfer Google user data to third parties except as necessary to provide the service (our authentication provider), to comply with applicable law, or as part of a merger or acquisition with prior notice;",
            "do not use Google user data for advertising;",
            "do not allow humans to read Google user data unless we have your affirmative consent, it is necessary for security or to comply with law, or the data has been aggregated and anonymized.",
          ]}
        />
      </LegalSection>

      <LegalSection id="google-maps" title="5. Google Maps and aerial imagery">
        <p>
          FenceScan uses the Google Maps Platform (including geocoding and the
          Google Solar API) and other imagery providers to locate the property
          addresses you enter and to retrieve aerial imagery and property and fence geometry
          for measurement. Addresses you submit are shared with these providers
          to return results. Use of Google Maps features is subject to{" "}
          <a
            href="https://www.google.com/policies/privacy"
            target="_blank"
            rel="noopener noreferrer"
            className="text-accent-700 underline"
          >
            Google&rsquo;s Privacy Policy
          </a>
          .
        </p>
      </LegalSection>

      <LegalSection id="ai-processing" title="6. AI processing of plans and imagery">
        <p>
          Fence measurement is performed by AI. Construction plans you upload
          and aerial imagery of scanned properties are processed by our AI
          providers (Anthropic, OpenAI, and Google) acting as service providers
          under their API terms, solely to return measurements and
          classifications to your account. We retain the analysis results with
          your project so you can review and edit them. We do not permit these
          inputs to be used to train foundation models.
        </p>
      </LegalSection>

      <LegalSection id="sharing" title="7. When we share information">
        <p>
          We share information only with the service providers required to run
          FenceScan, each bound by contractual confidentiality and
          data-protection obligations:
        </p>
        <LegalList
          items={[
            "Clerk — account authentication and session management",
            "Stripe — subscription billing and payments",
            "Vercel — application hosting and secure file storage for uploaded plans",
            "Neon — encrypted database hosting",
            "Anthropic, OpenAI, Google — AI measurement of plans and imagery (Section 6)",
            "Google Maps Platform, Mapbox, fal.ai — geocoding, aerial imagery, and image segmentation",
            "Resend — delivery of the transactional email you send from the platform",
          ]}
        />
        <p>
          Beyond service providers, we disclose information only: to the
          recipients you choose (for example, the client you email a proposal
          to); when required by law or valid legal process; to protect the
          rights, safety, and security of FenceScan and its users; or as part
          of a merger, acquisition, or asset sale, with notice to you.
        </p>
      </LegalSection>

      <LegalSection id="retention" title="8. Data retention and deletion">
        <p>
          We keep your account data for as long as your account is active.
          Project data (estimates, proposals, payment records) is retained so
          your business records remain available to you. Operational logs are
          kept on shorter schedules — abuse-prevention events for 90 days and
          usage-cost records for one year.
        </p>
        <p>
          You can delete individual proposals and uploads inside the app at any
          time. To delete your account and its data entirely, email{" "}
          <a href={`mailto:${CONTACT}`} className="text-accent-700 underline">
            {CONTACT}
          </a>{" "}
          from your account email — we will complete verified deletion requests
          within 30 days, except for records we must keep for legal, tax, or
          security purposes.
        </p>
      </LegalSection>

      <LegalSection id="security" title="9. Security">
        <p>
          All traffic is encrypted in transit with TLS. Data is stored with
          encryption at rest by our hosting providers, and third-party API
          credentials are additionally encrypted at the application layer
          (AES-256-GCM). Access to production systems is limited to authorized
          personnel, and the platform enforces layered rate limiting and abuse
          monitoring. No system is perfectly secure — if we learn of a breach
          affecting your personal information, we will notify you as required
          by law.
        </p>
      </LegalSection>

      <LegalSection id="your-rights" title="10. Your rights and choices">
        <p>
          Depending on where you live (including under the GDPR and the
          California Consumer Privacy Act), you may have the right to access,
          correct, export, restrict, or delete your personal information, and
          the right not to be discriminated against for exercising those
          rights. You can update your profile inside the app, and exercise any
          other right by emailing{" "}
          <a href={`mailto:${CONTACT}`} className="text-accent-700 underline">
            {CONTACT}
          </a>
          . We do not sell or &ldquo;share&rdquo; personal information as those
          terms are defined by the CCPA, and we honor verified requests within
          the timelines required by law.
        </p>
        <p>
          <strong>If you are a homeowner</strong> whose information was entered
          by a contractor using FenceScan: we process that information on the
          contractor&rsquo;s behalf. You may contact your contractor directly,
          or email us and we will assist with your request.
        </p>
      </LegalSection>

      <LegalSection id="cookies" title="11. Cookies">
        <p>
          FenceScan uses only the cookies necessary to run the product:
          authentication and session cookies set by our sign-in provider, and
          security cookies used for abuse prevention. We do not use
          third-party advertising or cross-site tracking cookies.
        </p>
      </LegalSection>

      <LegalSection id="children" title="12. Children">
        <p>
          FenceScan is a business tool intended for users 18 and older. It is
          not directed to children, and we do not knowingly collect personal
          information from anyone under 13. If you believe a child has provided
          us personal information, contact us and we will delete it.
        </p>
      </LegalSection>

      <LegalSection id="changes" title="13. Changes to this policy">
        <p>
          We may update this policy as the product evolves. Material changes
          will be announced in the app or by email before they take effect, and
          the &ldquo;Last updated&rdquo; date above always reflects the current
          version. Continued use of FenceScan after a change means you accept
          the updated policy.
        </p>
      </LegalSection>

      <LegalSection id="contact" title="14. Contact us">
        <p>
          FenceScan Inc.
          <br />
          Email:{" "}
          <a href={`mailto:${CONTACT}`} className="text-accent-700 underline">
            {CONTACT}
          </a>
        </p>
      </LegalSection>
    </LegalShell>
  );
}
