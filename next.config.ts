export default {
  experimental: {
    ppr: true,
    inlineCss: true,
    useCache: true,
    clientSegmentCache: true,
  },
  images: {
    formats: ["image/avif", "image/webp"],
    remotePatterns: [
      {
        protocol: "https",
        hostname: "zylq-002.dx.commercecloud.salesforce.com",
      },
      {
        protocol: "https",
        hostname: "edge.disstg.commercecloud.salesforce.com",
      },
      {
        // Salesforce public demo backend (PWA Kit demo instance)
        protocol: "https",
        hostname: "zzrf-001.dx.commercecloud.salesforce.com",
      },
    ],
  },
};
