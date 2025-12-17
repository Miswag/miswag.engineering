/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
  output: "export",
  basePath: "/miswag-tech-blog",
  assetPrefix: "/miswag-tech-blog",
  trailingSlash: true,
}

export default nextConfig
