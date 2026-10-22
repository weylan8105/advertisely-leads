/** @type {import('next').NextConfig} */

// The ABCA funnel's pages on americanbluecollaradvantage.com (and www):
// root = the quiz, plus the Privacy Policy and Terms the consent box links to.
const ABCA_HOSTS = ["americanbluecollaradvantage.com", "www.americanbluecollaradvantage.com"];
const ABCA_PAGES = [
  { source: "/", destination: "/abca-quiz.html" },
  { source: "/privacy", destination: "/abca-privacy.html" },
  { source: "/terms", destination: "/abca-terms.html" },
];

const nextConfig = {
  reactStrictMode: true,
  async rewrites() {
    // Host-scoped, so advertisely.io is unaffected — it keeps showing the app.
    // Only these exact paths are rewritten, so /api/* (the quiz's lead POST)
    // and everything else still work on the ABCA domain.
    return {
      beforeFiles: ABCA_HOSTS.flatMap((host) =>
        ABCA_PAGES.map((page) => ({ ...page, has: [{ type: "host", value: host }] })),
      ),
    };
  },
};

module.exports = nextConfig;
