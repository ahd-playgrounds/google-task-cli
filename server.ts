import { google } from "googleapis";
import fs from "node:fs/promises";
import path from "node:path";
import { execSync, spawn, spawnSync } from "node:child_process";
import express from "express";
import type { Server } from "node:http";
import xdg from "xdg-app-paths";

// OAuth2 configuration
const SCOPES = ["https://www.googleapis.com/auth/tasks.readonly"];
const TOKEN_PATH = path.join(
  new xdg({ name: "google-tasks-cli" }).data(),
  "token.json"
);
const REDIRECT_PORT = 3000;
const REDIRECT_URI = `http://localhost:${REDIRECT_PORT}`;

type OAuthClient = InstanceType<typeof google.auth.OAuth2>;

// 1Password configuration
const OP_VAULT = process.env.OP_VAULT || "Private"; // Default vault name
const OP_ITEM_NAME = process.env.OP_ITEM_NAME || "Google Tasks API"; // 1Password item name

/**
 * Check if 1Password CLI is installed and user is signed in
 */
function check1PasswordCLI() {
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
function getCredentialsFrom1Password() {
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
      redirect_uris: [REDIRECT_URI], // Use our local server
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
 * Create an OAuth2 client with credentials from 1Password
 */
async function authorize() {
  // Check 1Password CLI availability
  if (!check1PasswordCLI()) {
    console.error("❌ 1Password CLI not found or not signed in.");
    console.log("Please install 1Password CLI and sign in:");
    console.log("   brew install --cask 1password-cli  # macOS");
    console.log("   op signin");
    return null;
  }

  // Get credentials from 1Password
  const credentials = getCredentialsFrom1Password();
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
  try {
    const token = await fs.readFile(TOKEN_PATH);
    oAuth2Client.setCredentials(JSON.parse(token.toString()));
    console.log("✅ Using existing authentication token");
    return oAuth2Client;
  } catch (err) {
    console.log("🔑 No existing token found, starting new authentication flow");
    return getNewToken(oAuth2Client);
  }
}

/**
 * Start Express server to handle OAuth callback
 */
function startOAuthServer(oAuth2Client: OAuthClient) {
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
        console.error("🔑 Exchange the authorization code for tokens");
        // Exchange the authorization code for tokens
        const { tokens } = await oAuth2Client.getToken(code);
        oAuth2Client.setCredentials(tokens);

        // Store the token to disk for later program executions
        await fs.writeFile(TOKEN_PATH, JSON.stringify(tokens));
        console.log(`✅ Token stored successfully to ${TOKEN_PATH}`);

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
async function getNewToken(oAuth2Client: OAuthClient) {
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

function openURL(url: string) {
  try {
    spawnSync("open", [url], { stdio: "ignore" });
    return true;
  } catch (err) {
    return false;
  }
}

/**
 * Fetch all task lists
 */
async function getTaskLists(auth) {
  const tasks = google.tasks({ version: "v1", auth });

  try {
    const res = await tasks.tasklists.list();
    return res.data.items || [];
  } catch (err) {
    console.error("Error fetching task lists:", err);
    return [];
  }
}

/**
 * Fetch tasks from a specific task list
 */
async function getTasks(auth, taskListId) {
  const tasks = google.tasks({ version: "v1", auth });

  try {
    const res = await tasks.tasks.list({
      tasklist: taskListId,
      showCompleted: false, // Only show incomplete tasks
      showDeleted: false,
      showHidden: false,
    });
    return res.data.items || [];
  } catch (err) {
    console.error("Error fetching tasks:", err);
    return [];
  }
}

/**
 * Main function
 */
async function main() {
  console.log("🔄 Fetching your Google Tasks...\n");
  await fs.mkdir(path.dirname(TOKEN_PATH), { recursive: true });

  const auth = await authorize();
  if (!auth) {
    console.error("❌ Failed to authorize. Please check your credentials.");
    return;
  }

  console.log("✅ Authorization successful!");

  // Get all task lists
  const taskLists = await getTaskLists(auth);
  if (taskLists.length === 0) {
    console.log("No task lists found.");
    return;
  }

  console.log(`📚 Found ${taskLists.length} task list(s)`);

  // Get tasks from all task lists
  const allTasks = await Promise.all(
    taskLists.map((taskList) => getTasks(auth, taskList.id))
  );

  // Display all tasks
  {
    console.log("\n=== YOUR CURRENT TASKS ===\n");

    let totalTasks = 0;

    taskLists.forEach((taskList, index) => {
      const tasks = allTasks[index];
      if (tasks.length === 0) return;

      console.log(`📋 ${taskList.title} (${tasks.length} tasks)`);
      console.log("─".repeat(40));

      tasks.forEach((task, taskIndex) => {
        const status = task.status === "completed" ? "✅" : "⭕";
        const dueDate = task.due
          ? ` (Due: ${new Date(task.due).toLocaleDateString()})`
          : "";
        const notes = task.notes ? `\n   📝 ${task.notes}` : "";

        console.log(
          `${taskIndex + 1}. ${status} ${task.title}${dueDate}${notes}`
        );
        if (task.links) {
          console.log(" 🔗 Links:");
          for (const link of task.links) {
            console.log(`   ${link.type}: [${link.description}](${link.link})`);
          }
        }
        totalTasks++;
      });
      console.log("");
    });

    if (totalTasks === 0) {
      console.log("🎉 No pending tasks found! You're all caught up!");
    } else {
      console.log(`📊 Total pending tasks: ${totalTasks}`);
    }
  }
}

// Run the script
main().catch(console.error);
