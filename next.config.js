/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async rewrites() {
    // Serve the ABCA quiz funnel at the root of americanbluecollaradvantage.com
    // (and www). advertisely.io is unaffected — it keeps showing the app.
    // Only the exact root path is rewritten, so /api/* (the quiz's lead POST)
    // and everything else still work on the ABCA domain.
    return {
      beforeFiles: [
        {
          source: "/",
          has: [{ type: "host", value: "americanbluecollaradvantage.com" }],
          destination: "/abca-quiz.html",
        },
        {
          source: "/",
          has: [{ type: "host", value: "www.americanbluecollaradvantage.com" }],
          destination: "/abca-quiz.html",
        },
      ],
    };
  },
};

module.exports = nextConfig;
