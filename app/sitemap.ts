import type { MetadataRoute } from "next";

// robots.txt advertises /sitemap.xml — this keeps that promise. Only
// the public marketing surface belongs here; the app is auth-walled.
export default function sitemap(): MetadataRoute.Sitemap {
  const base = "https://fencescan.com";
  return [
    { url: `${base}/`, changeFrequency: "weekly", priority: 1 },
    { url: `${base}/demo/satellite`, changeFrequency: "monthly", priority: 0.7 },
    { url: `${base}/privacy`, changeFrequency: "yearly", priority: 0.2 },
    { url: `${base}/terms`, changeFrequency: "yearly", priority: 0.2 },
  ];
}
