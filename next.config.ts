import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  serverExternalPackages: ['@electric-sql/pglite', '@react-pdf/renderer'],
  experimental: {
    serverActions: {
      // Project cover images go through a server action; covers are capped at 4 MB in the service
      bodySizeLimit: '5mb',
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
