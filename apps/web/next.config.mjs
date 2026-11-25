import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const coordinatorHost = process.env.COORDINATOR_HOST || "127.0.0.1";
const coordinatorPort = process.env.COORDINATOR_PORT || process.env.PORT || "4000";
const coordinatorUrl =
  process.env.COORDINATOR_URL ||
  process.env.NEXT_PUBLIC_COORDINATOR_URL ||
  `http://${coordinatorHost}:${coordinatorPort}`;

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  outputFileTracingRoot: path.join(__dirname, "../../"),
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${coordinatorUrl}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
