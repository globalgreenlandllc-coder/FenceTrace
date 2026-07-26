import type { Metadata } from "next";
import { Inter, Archivo_Black, Space_Mono } from "next/font/google";
import { ClerkProvider } from "@clerk/nextjs";
import { SessionProvider } from "@/components/auth/session-provider";
import { EstimateJobProvider } from "@/components/estimate/estimate-job";
import { Tracker } from "@/components/analytics/tracker";
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
  title: "FenceTrace — Smart Takeoffs, Proposals & Payments for Fence Contractors",
  description:
    "Type one address. Get a satellite-measured fence takeoff, a three-tier proposal your client e-signs, then run the schedule, crew, and payments — all in one platform.",
  metadataBase: new URL("https://fencetrace.com"),
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
          colorPrimary: "#14688C",
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
          {/* EstimateJobProvider lives above routing so a running
              takeoff analysis (and its floating mini-window) survives
              navigation anywhere in the app. */}
          <SessionProvider>
            <EstimateJobProvider>{children}</EstimateJobProvider>
          </SessionProvider>
          <Tracker />
        </body>
      </html>
    </ClerkProvider>
  );
}
