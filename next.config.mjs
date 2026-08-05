/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async headers() {
    return [
      {
        // HTML pages: no-cache so PWA always gets fresh chunk URLs after build
        source: '/((?!_next/static|_next/image|icon|favicon).*)',
        headers: [{ key: 'Cache-Control', value: 'no-cache, must-revalidate' }],
      },
    ]
  },
}
export default nextConfig
