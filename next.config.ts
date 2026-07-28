import type { NextConfig } from "next";

const nextConfig: NextConfig = {
    // Next 16 defaults `next dev` to Turbopack, which ignores the webpack()
    // hook below and errors if it sees one with no turbopack config beside
    // it. Turbopack has its own file watcher and already leaves the paths
    // below alone, so an empty config here is enough to silence that check.
    turbopack: {},
    // Artefacts written into the project while the app runs — browser
    // automation logs and screenshots, uploaded drawings, server logs —
    // must not look like source changes. Watching them put dev into a
    // rebuild loop: every console line rewrote the log, the log triggered
    // Fast Refresh, the reload produced more console lines. This only
    // applies when running under `next dev --webpack`.
    webpack: (config) => {
        config.watchOptions = {
            ...(config.watchOptions || {}),
            ignored: [
                "**/node_modules/**",
                "**/.git/**",
                "**/.next/**",
                "**/.playwright-mcp/**",
                "**/uploads/**",
                "**/*.png",
                "**/*.log",
            ],
        };
        return config;
    },
    async rewrites() {
        const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:5000";
        return [
            {
                source: "/api/:path*",
                destination: `${backendUrl}/api/:path*`,
            },
        ];
    },
};

export default nextConfig;