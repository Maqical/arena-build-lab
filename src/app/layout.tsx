import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { DesktopShell } from "@/components/DesktopShell";
import "./globals.css";

const geist = Geist({ variable: "--font-geist", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Arena Build Lab by Frbz.gg",
  description: "Patch-aware League of Legends Arena mechanics and build combination explorer.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={`${geist.variable} ${geistMono.variable}`}><DesktopShell>{children}</DesktopShell></body>
    </html>
  );
}
