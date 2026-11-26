import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  serverExternalPackages: ['@electric-sql/pglite', '@react-pdf/renderer'],
  experimental: {
    serverActions: {
      // Project cover images (capped at 4 MB) and AI take-off page images (a sheet + 4 zoomed quarters) go through server actions
      bodySizeLimit: '24mb',
    },
  },
  async redirects() {
    return [
      {
        // Legacy alias: project pages live under /projects only
        source: '/master/projects/:path*',
        destination: '/projects/:path*',
        permanent: false,
      },
    ];
  },
};

export default nextConfig;
