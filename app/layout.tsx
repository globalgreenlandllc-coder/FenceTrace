import type { Metadata, Viewport } from "next";
import { Inter, Archivo_Black, Space_Mono } from "next/font/google";
import { ClerkProvider } from "@clerk/nextjs";
import { SessionProvider } from "@/components/auth/session-provider";
import { EstimateJobProvider } from "@/components/estimate/estimate-job";
import { Tracker } from "@/components/analytics/tracker";
import { CookieNotice } from "@/components/legal/cookie-notice";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const display = Archivo_Black({
  subsets: ["latin"],
  weight: "400",
  variable: "--font-display",
  display: "swap",
});

const mono = Space_Mono({
  subsets: ["latin"],
  weight: ["400", "700"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "FenceScan — Smart Takeoffs, Proposals & Payments for Fence Contractors",
  description:
    "Type one address. Get a satellite-measured fence takeoff, a three-tier proposal your client e-signs, then run the schedule, crew, and payments — all in one platform.",
  // Vercel 308s the apex to www — every URL the site claims about
  // itself must use the host Google actually lands on, or the crawler
  // sees a site whose canonical story disagrees with its redirects.
  metadataBase: new URL("https://www.fencescan.com"),
  alternates: { canonical: "./" },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, "max-image-preview": "large" },
  },
  openGraph: {
    title: "FenceScan — Smart Takeoffs & Proposals for Fence Contractors",
    description:
      "Satellite-measured fence takeoffs, e-signed proposals, scheduling, crew and payments — from one typed address.",
    url: "https://www.fencescan.com",
    siteName: "FenceScan",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "FenceScan — Smart Takeoffs & Proposals for Fence Contractors",
    description:
      "Satellite-measured fence takeoffs, e-signed proposals, scheduling, crew and payments — from one typed address.",
  },
};

// viewportFit: "cover" is what makes env(safe-area-inset-*) real on
// iOS — the accept bar and worker action bars pad by it, and without
// this declaration those pads resolve to 0 under the home indicator.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#1E7340",
};

/**
 * Structured data for search: who this is (Organization) and what the
 * product is (SoftwareApplication). Static and truthful — no ratings,
 * no invented review counts, nothing Google can penalize.
 */
const JSON_LD = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      "@id": "https://www.fencescan.com/#org",
      name: "FenceScan",
      url: "https://www.fencescan.com",
      logo: "https://www.fencescan.com/icon.svg",
    },
    {
      "@type": "WebSite",
      "@id": "https://www.fencescan.com/#site",
      name: "FenceScan",
      url: "https://www.fencescan.com",
      publisher: { "@id": "https://www.fencescan.com/#org" },
    },
    {
      "@type": "SoftwareApplication",
      name: "FenceScan",
      applicationCategory: "BusinessApplication",
      operatingSystem: "Web",
      description:
        "Satellite-measured fence takeoffs, three-tier proposals with e-signature, scheduling, crew and payments for fence contractors.",
      url: "https://www.fencescan.com",
      offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
    },
  ],
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <ClerkProvider
      appearance={{
        variables: {
          colorPrimary: "#1E7340",
          colorText: "#0d0d12",
          colorBackground: "#ffffff",
          colorInputBackground: "#ffffff",
          colorInputText: "#0d0d12",
          borderRadius: "0.5rem",
        },
      }}
    >
      <html
        lang="en"
        className={`${inter.variable} ${display.variable} ${mono.variable}`}
      >
        <body className="font-sans antialiased text-zinc-900">
        <script
          type="application/ld+json"
          // JSON.stringify of a static literal — nothing user-supplied
          // ever reaches this sink.
          dangerouslySetInnerHTML={{ __html: JSON.stringify(JSON_LD) }}
        />
          {/* EstimateJobProvider lives above routing so a running
              takeoff analysis (and its floating mini-window) survives
              navigation anywhere in the app. */}
          <SessionProvider>
            <EstimateJobProvider>{children}</EstimateJobProvider>
          </SessionProvider>
          <Tracker />
          <CookieNotice />
        </body>
      </html>
    </ClerkProvider>
  );
}
