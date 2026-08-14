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
        protocol: 'https',
        hostname: process.env.SFCC_SANDBOX_DOMAIN
      },
      {
        protocol: "https",
        hostname: "edge.disstg.commercecloud.salesforce.com",
      },
      {
        protocol: "https",
        hostname: "zzrf-001.dx.commercecloud.salesforce.com",
      },
    ],
  },
};
