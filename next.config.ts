import type { NextConfig } from "next";

const nextConfig: NextConfig = {
    // Artefacts written into the project while the app runs — browser
    // automation logs and screenshots, uploaded drawings, server logs —
    // must not look like source changes. Watching them put dev into a
    // rebuild loop: every console line rewrote the log, the log triggered
    // Fast Refresh, the reload produced more console lines.
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