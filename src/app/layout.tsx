import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Flat 4B — Shared Expenses",
  description: "Shared expenses with a deliberately messy CSV import",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
