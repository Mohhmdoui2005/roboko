import withPWAInit from "@ducanh2912/next-pwa";

// Supabase REST (reads + RPC POSTs) lives outside /api — match it directly.
// GETs are cached network-first; POST mutations are never served from cache
// (they go through the IndexedDB mutation queue on failure instead).
const supabaseHost = (() => {
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
    return url ? new URL(url).host.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") : null;
  } catch {
    return null;
  }
})();

const withPWA = withPWAInit({
  dest: "public",
  disable: process.env.NODE_ENV === "development",
  // Never auto-reload on reconnect: jury/orga hold live scoring state.
  reloadOnOnline: false,
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
      // Supabase REST reads (GET only — POSTs bypass): network-first so the
      // app shell + live data work with stale-while-offline reads.
      ...(supabaseHost
        ? [
            {
              urlPattern: new RegExp(`^https://${supabaseHost}/rest/v1/.*`),
              handler: "NetworkFirst",
              method: "GET",
              options: {
                cacheName: "supabase-rest",
                expiration: {
                  maxEntries: 100,
                  maxAgeSeconds: 5 * 60, // 5 minutes — live data goes stale fast
                },
                networkTimeoutSeconds: 5,
              },
            },
          ]
        : []),
    ],
  },
});

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Add other next config here
};

export default withPWA(nextConfig);
