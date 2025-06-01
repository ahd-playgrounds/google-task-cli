import { google } from "googleapis";
import { spawnSync } from "node:child_process";
import express from "express";
import type { Server } from "node:http";
import {
  check1PasswordCLI,
  getCredentialsFrom1Password,
  ensureTokenDirectory,
  saveToken,
  loadToken,
} from "./onepassword.ts";

// OAuth2 configuration
const SCOPES = [
  "https://www.googleapis.com/auth/tasks.readonly",
  "https://www.googleapis.com/auth/photoslibrary.appendonly",
  "https://www.googleapis.com/auth/photoslibrary.edit.appcreateddata",
  "https://www.googleapis.com/auth/photoslibrary.readonly.appcreateddata",
];
const REDIRECT_PORT = 3000;
const REDIRECT_URI = `http://localhost:${REDIRECT_PORT}`;

export type OAuthClient = InstanceType<typeof google.auth.OAuth2>;

/**
 * Create an OAuth2 client with credentials from 1Password
 */
export async function authorize(): Promise<OAuthClient | null> {
  await ensureTokenDirectory();

  // Check 1Password CLI availability
  if (!check1PasswordCLI()) {
    console.error("❌ 1Password CLI not found or not signed in.");
    console.log("Please install 1Password CLI and sign in:");
    console.log("   brew install --cask 1password-cli  # macOS");
    console.log("   op signin");
    return null;
  }

  // Get credentials from 1Password
  const credentials = getCredentialsFrom1Password(REDIRECT_URI);
  if (!credentials) {
    return null;
  }

  const { client_secret, client_id, redirect_uris } = credentials;
  console.log("🔑 Client ID:", client_id);
  console.log("🔑 Client Secret:", client_secret.replaceAll(/./g, "*"));
  console.log("🔑 Redirect URIs:", redirect_uris);
  const oAuth2Client = new google.auth.OAuth2(
    client_id,
    client_secret,
    redirect_uris[0]
  );

  // Check if we have previously stored a token
  // const existingToken = await loadToken();
  // if (existingToken) {
  //   oAuth2Client.setCredentials(existingToken);
  //   console.log("✅ Using existing authentication token");
  //   return oAuth2Client;
  // }

  console.log("🔑 No existing token found, starting new authentication flow");
  return getNewToken(oAuth2Client);
}

/**
 * Start Express server to handle OAuth callback
 */
function startOAuthServer(oAuth2Client: OAuthClient): Promise<OAuthClient> {
  return new Promise((resolve, reject) => {
    const app = express();
    let server: Server | null = null;

    // Handle the OAuth callback
    app.get("/", async (req, res) => {
      const { code, error } = req.query;
      console.log("🔑 OAuth callback received");
      console.log("🔑 Code:", code);
      console.log("🔑 Error:", error);

      if (error) {
        console.error("❌ OAuth error:", error);
        res.status(400).send(`
          <html>
            <body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
              <h1 style="color: #e74c3c;">❌ Authorization Error</h1>
              <p>Error: ${error}</p>
              <p>You can close this window and try again.</p>
            </body>
          </html>
        `);
        server?.close();
        reject(new Error(`OAuth error: ${error}`));
        return;
      }

      if (!code || typeof code !== "string") {
        console.error("❌ Missing Authorization Code");
        res.status(400).send(`
          <html>
            <body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
              <h1 style="color: #e74c3c;">❌ Missing Authorization Code</h1>
              <p>No authorization code received. Please try again.</p>
            </body>
          </html>
        `);
        server?.close();
        reject(new Error("No authorization code received"));
        return;
      }

      try {
        console.log("Google Response", req.query);
        console.error("🔑 Exchange the authorization code for tokens");
        // Exchange the authorization code for tokens
        const { tokens } = await oAuth2Client.getToken(code);
        oAuth2Client.setCredentials(tokens);

        // Store the token to disk for later program executions
        await saveToken(tokens);

        // Send success response
        res.send(`
          <html>
            <body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
              <h1 style="color: #27ae60;">✅ Authorization Successful!</h1>
              <p>You have successfully authorized the Google Tasks application.</p>
              <p>You can close this window and return to your terminal.</p>
              <script>
                setTimeout(() => {
                  window.close();
                }, 3000);
              </script>
            </body>
          </html>
        `);

        // Clean up and resolve
        setTimeout(() => {
          server?.close();
          resolve(oAuth2Client);
        }, 1000);
      } catch (err) {
        console.error("❌ Error exchanging code for tokens:", err);
        res.status(500).send(`
          <html>
            <body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
              <h1 style="color: #e74c3c;">❌ Token Exchange Error</h1>
              <p>Failed to exchange authorization code for tokens.</p>
              <p>Error: ${err.message}</p>
            </body>
          </html>
        `);
        server?.close();
        reject(err);
      }
    });

    // Start the server
    server = app.listen(REDIRECT_PORT, "localhost", () => {
      console.log(
        `🚀 OAuth callback server started on http://localhost:${REDIRECT_PORT}`
      );
    });

    // Handle server errors
    server.on("error", (err: { code?: string }) => {
      if (err.code === "EADDRINUSE") {
        console.error(
          `❌ Port ${REDIRECT_PORT} is already in use. Please close other applications using this port.`
        );
      } else {
        console.error("❌ Server error:", err);
      }
      reject(err);
    });
  });
}

/**
 * Get and store new token using Express server for OAuth callback
 */
async function getNewToken(oAuth2Client: OAuthClient): Promise<OAuthClient> {
  const authUrl = oAuth2Client.generateAuthUrl({
    access_type: "offline",
    scope: SCOPES,
    response_type: "code",
  });

  console.log("🌐 Starting OAuth flow...");
  console.log("🔧 Starting local callback server...");

  // Start the OAuth callback server
  const serverPromise = startOAuthServer(oAuth2Client);

  // Small delay to ensure server is ready
  await new Promise((resolve) => setTimeout(resolve, 500));

  console.log("🌐 Opening authorization URL in your browser...");

  if (!openURL(authUrl)) {
    console.log("\n📋 Please manually open this URL in your browser:");
    console.log(authUrl);
  }

  console.log("\n⏳ Waiting for authorization...");
  console.log(
    "💡 After you authorize in the browser, you'll be redirected back automatically."
  );

  try {
    return await serverPromise;
  } catch (err) {
    console.error("❌ OAuth flow failed:", err.message);
    throw err;
  }
}

function openURL(url: string): boolean {
  try {
    spawnSync("open", [url], { stdio: "ignore" });
    return true;
  } catch (err) {
    return false;
  }
}
