/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
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
