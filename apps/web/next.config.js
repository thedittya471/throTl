import dotenv from "dotenv";
import { fileURLToPath } from "node:url";

dotenv.config({ path: new URL("../../.env", import.meta.url), quiet: true });

const nextConfig = {
  poweredByHeader: false,
  async rewrites() {
    const apiOrigin = process.env.API_ORIGIN ?? "http://127.0.0.1:4000";
    return [{ source: "/api/auth/:path*", destination: `${apiOrigin}/auth/:path*` }];
  },
  turbopack: {
    root: fileURLToPath(new URL("../../", import.meta.url))
  }
};

export default nextConfig;
