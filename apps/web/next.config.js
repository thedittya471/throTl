import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";

const envFile = new URL("../../.env", import.meta.url);
if (existsSync(envFile)) {
  loadEnvFile(envFile);
}

const nextConfig = {
  poweredByHeader: false,
  turbopack: {
    root: fileURLToPath(new URL("../../", import.meta.url))
  }
};

export default nextConfig;
