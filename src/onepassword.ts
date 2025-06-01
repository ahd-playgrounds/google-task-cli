import { execSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import xdg from "xdg-app-paths";

// 1Password configuration
const OP_VAULT = process.env.OP_VAULT || "Private"; // Default vault name
const OP_ITEM_NAME = process.env.OP_ITEM_NAME || "Google Tasks API"; // 1Password item name

// Token storage configuration
const TOKEN_PATH = path.join(
  new xdg({ name: "google-tasks-cli" }).data(),
  "token.json"
);

export interface Credentials {
  client_id: string;
  client_secret: string;
  redirect_uris: string[];
}

export interface OAuthTokens {
  access_token?: string | null;
  refresh_token?: string | null;
  scope?: string | null;
  token_type?: string | null;
  expiry_date?: number | null;
  id_token?: string | null;
}

/**
 * Check if 1Password CLI is installed and user is signed in
 */
export function check1PasswordCLI(): boolean {
  try {
    execSync("op --version", { stdio: "ignore" });
    // Check if signed in by trying to list items
    execSync("op item list --categories 'API Credential'", { stdio: "ignore" });
    return true;
  } catch (err) {
    return false;
  }
}

/**
 * Get credentials from 1Password
 */
export function getCredentialsFrom1Password(
  redirectUri: string
): Credentials | null {
  try {
    console.log(
      `🔐 Retrieving credentials from 1Password item: "${OP_ITEM_NAME}"`
    );

    // Get the client_id and client_secret from 1Password
    const clientId = execSync(
      `op item get "${OP_ITEM_NAME}" --vault "${OP_VAULT}" --field "client_id"`,
      { encoding: "utf8" }
    ).trim();
    const clientSecret = execSync(
      `op item get "${OP_ITEM_NAME}" --vault "${OP_VAULT}" --field "client_secret" --reveal`,
      { encoding: "utf8" }
    ).trim();

    return {
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uris: [redirectUri], // Use the provided redirect URI
    };
  } catch (err) {
    console.error(
      "❌ Error retrieving credentials from 1Password:",
      err.message
    );
    console.log("\n📝 Make sure you have:");
    console.log(
      `   1. A 1Password item named "${OP_ITEM_NAME}" in vault "${OP_VAULT}"`
    );
    console.log("   2. Fields: client_id, client_secret, redirect_uri");
    console.log("   3. 1Password CLI installed and signed in (op signin)");
    console.log(
      "\n💡 You can customize the vault and item name with environment variables:"
    );
    console.log('   export OP_VAULT="YourVaultName"');
    console.log('   export OP_ITEM_NAME="YourItemName"');
    return null;
  }
}

/**
 * Ensure the token directory exists
 */
export async function ensureTokenDirectory(): Promise<void> {
  await fs.mkdir(path.dirname(TOKEN_PATH), { recursive: true });
}

/**
 * Save OAuth token to disk
 */
export async function saveToken(tokens: OAuthTokens): Promise<void> {
  await fs.writeFile(TOKEN_PATH, JSON.stringify(tokens));
  console.log(`✅ Token stored successfully to ${TOKEN_PATH}`);
}

/**
 * Load OAuth token from disk
 */
export async function loadToken(): Promise<OAuthTokens | null> {
  try {
    const token = await fs.readFile(TOKEN_PATH);
    return JSON.parse(token.toString()) as OAuthTokens;
  } catch (err) {
    return null;
  }
}
