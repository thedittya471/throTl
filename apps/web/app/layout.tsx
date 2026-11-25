import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "throTl — Distributed Rate Limiter Simulator & Visualizer",
  description:
    "Ultra-high performance simulator, visualizer, and benchmark harness for distributed rate limiting algorithms.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <head>
        <meta name="color-scheme" content="dark" />
        <meta name="theme-color" content="#060608" />
      </head>
      <body className="min-h-screen bg-carbon-950 text-carbon-100 antialiased selection:bg-studio-orange/30 selection:text-studio-orange">
        {children}
      </body>
    </html>
  );
}
