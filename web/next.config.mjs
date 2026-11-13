// The principals' web app (PRD E12-S5). The engine lives in the repository root (../src) and is loaded at runtime, not bundled
// (see lib/engine.mjs), so the tracing root is the repository root and the engine's files are traced in explicitly.
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  outputFileTracingRoot: repoRoot,
  turbopack: { root: repoRoot },
  // The engine and the rule files it reads (config, claims, terminology, playbooks, metros, buy box, scoring, the site snapshot).
  outputFileTracingIncludes: {
    '/**': ['../src/**/*', '../*.json', '../site-snapshot/**/*', '../node_modules/@anthropic-ai/sdk/**/*'],
  },
  async headers() {
    return [{
      source: '/:path*',
      headers: [
        { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
        { key: 'Referrer-Policy', value: 'no-referrer' },
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'X-Frame-Options', value: 'DENY' },
      ],
    }];
  },
};

export default nextConfig;
