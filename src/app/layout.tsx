import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Bisharp | Conditional orders",
  description: "A Sepolia testnet workspace for price-triggered, solver-funded asset orders.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
