import type { Metadata } from "next";
import { Geist, Geist_Mono, Libre_Bodoni } from "next/font/google";
import { Toaster } from "sonner";
import "./globals.css";

const geist = Geist({ variable: "--font-geist", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });
const libre = Libre_Bodoni({
  variable: "--font-libre",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  style: ["normal", "italic"],
});

export const metadata: Metadata = {
  title: "Atelier — Control de stock",
  description:
    "Atelier. Shopify, Meta Ads y reportes de venta en un solo lugar. Tu atelier de stock.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="es"
      className={`${geist.variable} ${geistMono.variable} ${libre.variable} h-full`}
    >
      <body className="min-h-full bg-bg text-ink">
        {children}
        <Toaster
          position="bottom-right"
          toastOptions={{
            style: {
              borderRadius: "4px",
              border: "1px solid var(--color-line2)",
              fontFamily: "var(--font-geist)",
              fontSize: "13px",
              color: "var(--color-ink)",
            },
          }}
        />
      </body>
    </html>
  );
}
