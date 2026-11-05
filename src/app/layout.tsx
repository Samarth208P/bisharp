import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";
import "./cross.css";
import "./product.css";
import "./workspace.css";

const display = localFont({
  src: "../../public/fonts/pp-neue-corp-compact-ultrabold.woff2",
  variable: "--font-display",
  weight: "400",
  display: "swap",
});
const body = localFont({
  src: "../../public/fonts/dm-sans-latin.woff2",
  variable: "--font-body",
  weight: "500",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Bisharp | Conditional orders",
  description:
    "A Sepolia testnet workspace for price-triggered, solver-funded asset orders.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable}`}>
      <body>{children}</body>
    </html>
  );
}
