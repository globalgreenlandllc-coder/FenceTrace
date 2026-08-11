/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    // Next 15 defaults the client router cache for dynamic segments to
    // ZERO — every page switch refetches the full RSC tree, including
    // the dashboard layout's getMe(). 30s of staleness makes switching
    // between dashboard tabs instant; data freshness comes from the
    // pages' own client fetches, not the RSC payload.
    staleTimes: { dynamic: 30, static: 180 },
    serverActions: {
      // Save-proposal sends the aerial snapshot as a base64 data URL so
      // /proposal can render it in the PDF without re-hitting Google
      // Static Maps. A 900x580 PNG is typically 1–2 MB encoded — above
      // Next.js's 1 MB default, which fails with an opaque "Server
      // Components render" 500. 8 MB is generous headroom.
      bodySizeLimit: "8mb",
    },
  },
};

export default nextConfig;
