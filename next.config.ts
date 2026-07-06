import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "cdn.shopify.com" },
      { protocol: "https", hostname: "**.myshopify.com" },
      { protocol: "https", hostname: "**.supabase.co" },
    ],
  },
  async redirects() {
    return [
      { source: "/meta-ads", destination: "/metricas", permanent: true },
      { source: "/compras", destination: "/ventas", permanent: true },
      { source: "/compras/reporte", destination: "/ventas/reporte", permanent: true },
    ];
  },
};

export default nextConfig;
