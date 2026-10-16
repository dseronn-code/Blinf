/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  // Bibliotecas Node usadas para PDF/código de barras rodam somente no servidor
  serverExternalPackages: ['bwip-js', 'pdf-lib', 'qrcode', 'xlsx', '@prisma/client'],
  eslint: { ignoreDuringBuilds: true },
};
export default nextConfig;
