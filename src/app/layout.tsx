import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "PAI · Business prospect research",
  description:
    "Independent open-source prospect research using public business listings and official FCC availability data. Not affiliated with Spectrum or Charter.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
