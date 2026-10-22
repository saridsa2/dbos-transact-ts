import type { NextConfig } from 'next';
const config: NextConfig = {
  allowedDevOrigins: (process.env.STUDIO_ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
    .map((origin) => new URL(origin).hostname),
  async rewrites() {
    return [{ source: '/api/:path*', destination: 'http://127.0.0.1:3021/api/:path*' }];
  },
};
export default config;
