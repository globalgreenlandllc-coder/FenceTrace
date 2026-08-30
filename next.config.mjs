/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    // Next 15 defaults the client router cache for dynamic segments to
    // ZERO — every page switch refetches the full RSC tree, including
    // the dashboard layout's getMe(). The RSC payload of a dashboard
    // page is just the client-component shell (all real data arrives
    // via the pages' own cached client fetches), so it can stay stale
    // for minutes without anyone seeing old data — 5 minutes makes tab
    // switching instant for a whole working session, and pairs with the
    // nav rail's full prefetch so even first visits skip the route
    // skeleton.
    staleTimes: { dynamic: 300, static: 300 },
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
