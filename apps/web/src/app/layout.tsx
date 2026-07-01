import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "GuildServer BaaS Cloud",
  description: "Self-hosted Supabase Cloud — multi-tenant BaaS platform",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
