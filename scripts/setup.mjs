import { randomBytes } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

const projectRoot = new URL("../", import.meta.url);
const template = await readFile(new URL(".env.example", projectRoot), "utf8");
const databasePassword = randomBytes(24).toString("hex");
const envContent = template.replaceAll("change-me", databasePassword);

try {
  await writeFile(new URL(".env", projectRoot), envContent, {
    flag: "wx", // Create the file only if it does not already exist.
    mode: 0o600 // Allow only the file's owner to read or write it.
  });
  console.log("Created .env with a random local database password.");
} catch (error) {
  if (error.code !== "EEXIST") {
    throw error;
  }
  console.log("Kept the existing .env unchanged.");
}
