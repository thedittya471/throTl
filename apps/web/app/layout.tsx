import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "RateLab — Distributed Rate Limiter Simulator & Visualizer",
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
        <meta name="theme-color" content="#050811" />
      </head>
      <body className="min-h-screen bg-cockpit-950 text-slate-100 antialiased selection:bg-cyan-500/30 selection:text-cyan-200">
        {children}
      </body>
    </html>
  );
}
