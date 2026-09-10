import withPWAInit from "@ducanh2912/next-pwa";

const withPWA = withPWAInit({
  dest: "public",
  disable: process.env.NODE_ENV === "development",
  // Precache ONLY /login and /live
  additionalManifestEntries: [
    { url: "/login", revision: null },
    { url: "/live", revision: null },
  ],
  workboxOptions: {
    runtimeCaching: [
      {
        // Network-first for API routes
        urlPattern: /^\/api\/.*/i,
        handler: "NetworkFirst",
        options: {
          cacheName: "api-cache",
          expiration: {
            maxEntries: 50,
            maxAgeSeconds: 24 * 60 * 60, // 24 hours
          },
          networkTimeoutSeconds: 5,
        },
      },
      {
        // Cache-first (limited) for static assets
        urlPattern: /\.(?:png|jpg|jpeg|svg|webp|ico|woff2?|css|js)$/i,
        handler: "CacheFirst",
        options: {
          cacheName: "static-assets",
          expiration: {
            maxEntries: 100,
            maxAgeSeconds: 7 * 24 * 60 * 60, // 7 days
          },
        },
      },
    ],
  },
});

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Add other next config here
};

export default withPWA(nextConfig);
