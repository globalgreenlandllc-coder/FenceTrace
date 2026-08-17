import type { MetadataRoute } from "next";

/**
 * The public, indexable surface. robots.txt has pointed at
 * /sitemap.xml since launch, but no sitemap ever existed — and worse,
 * the middleware matcher sent the URL to the sign-in page. Everything
 * signed-in or client-private (dashboard, worker portal, /p/ proposal
 * links) stays out on purpose.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const base = "https://www.fencescan.com";
  const now = new Date();
  return [
    { url: `${base}/`, lastModified: now, changeFrequency: "weekly", priority: 1 },
    { url: `${base}/demo`, lastModified: now, changeFrequency: "monthly", priority: 0.7 },
    { url: `${base}/sign-up`, lastModified: now, changeFrequency: "monthly", priority: 0.5 },
    { url: `${base}/privacy`, lastModified: now, changeFrequency: "yearly", priority: 0.2 },
    { url: `${base}/terms`, lastModified: now, changeFrequency: "yearly", priority: 0.2 },
  ];
}
