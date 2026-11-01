import { randomBytes } from "node:crypto";
import { appendFile, readFile, writeFile } from "node:fs/promises";
import { parseEnv } from "node:util";

const projectRoot = new URL("../", import.meta.url);
const template = await readFile(new URL(".env.example", projectRoot), "utf8");
const databasePassword = randomBytes(24).toString("hex");
const envContent = template
  .replaceAll("change-me", databasePassword)
  .replace("generate-access-secret", randomBytes(32).toString("hex"))
  .replace("generate-refresh-secret", randomBytes(32).toString("hex"));
const envPath = new URL(".env", projectRoot);

try {
  await writeFile(envPath, envContent, {
    flag: "wx", // Create the file only if it does not already exist.
    mode: 0o600 // Allow only the file's owner to read or write it.
  });
  console.log("Created .env with a random database password and JWT secrets.");
} catch (error) {
  if (error.code !== "EEXIST") {
    throw error;
  }
  const existing = parseEnv(await readFile(envPath, "utf8"));
  const defaults = parseEnv(envContent);
  const authKeys = ["WEB_ORIGIN", "JWT_ACCESS_SECRET", "JWT_REFRESH_SECRET"];
  const missing = authKeys.filter((key) => existing[key] === undefined);
  if (missing.length > 0) {
    const additions = missing.map((key) => `${key}=${defaults[key]}`).join("\n");
    await appendFile(envPath, `\n${additions}\n`);
    console.log("Added missing auth settings; existing values were preserved.");
  } else {
    console.log("Kept the existing .env unchanged.");
  }
}
