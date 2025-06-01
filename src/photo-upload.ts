import https from "node:https";
import fs from "node:fs/promises";
import { URL } from "node:url";
import path from "node:path";
import { authorize } from "./auth.ts";
import type { OAuthClient } from "./auth.ts";

interface MediaItem {
  id: string;
  filename: string;
  description?: string;
  productUrl: string;
  baseUrl: string;
  mimeType: string;
  mediaMetadata?: {
    creationTime: string;
    width?: string;
    height?: string;
    photo?: {
      cameraMake?: string;
      cameraModel?: string;
      focalLength?: string;
      apertureFNumber?: string;
      isoEquivalent?: string;
      exposureTime?: string;
    };
    video?: {
      cameraMake?: string;
      cameraModel?: string;
      fps?: string;
      status?: string;
    };
  };
}

interface NewMediaItem {
  description?: string;
  simpleMediaItem: {
    fileName: string;
    uploadToken: string;
  };
}

interface BatchCreateRequest {
  newMediaItems: NewMediaItem[];
}

interface BatchCreateResponse {
  newMediaItemResults: Array<{
    uploadToken: string;
    status: {
      message?: string;
    };
    mediaItem?: MediaItem;
  }>;
}

class GooglePhotosUploader {
  private auth: OAuthClient | null = null;
  private readonly baseUrl = "https://photoslibrary.googleapis.com/v1";
  private readonly uploadUrl =
    "https://photoslibrary.googleapis.com/v1/uploads";

  /**
   * Initialize the uploader with OAuth2 authentication
   */
  async initialize(): Promise<boolean> {
    console.log("🔄 Initializing Google Photos authentication...\n");

    this.auth = await authorize();
    if (!this.auth) {
      console.error("❌ Failed to authorize. Please check your credentials.");
      return false;
    }

    console.log("✅ Google Photos authorization successful!");
    return true;
  }

  /**
   * Get access token from OAuth2 client
   */
  private async getAccessToken(): Promise<string> {
    if (!this.auth) {
      throw new Error("Not authenticated");
    }

    // Get credentials which includes the access token
    const credentials = this.auth.credentials;
    if (!credentials.access_token) {
      throw new Error("No access token available");
    }

    return credentials.access_token;
  }

  /**
   * Upload raw bytes to Google Photos and get upload token
   */
  async uploadBytes(filePath: string): Promise<string> {
    if (!this.auth) {
      throw new Error("Not authenticated. Call initialize() first.");
    }

    try {
      // Read the file
      const fileBuffer = await fs.readFile(filePath);
      const fileName = path.basename(filePath);
      const mimeType = this.getMimeType(fileName);

      console.log(`📤 Uploading ${fileName} (${fileBuffer.length} bytes)...`);

      // Get access token
      const accessToken = await this.getAccessToken();

      const url = new URL(this.uploadUrl);

      const options: https.RequestOptions = {
        hostname: url.hostname,
        path: url.pathname,
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/octet-stream",
          "X-Goog-Upload-Content-Type": mimeType,
          "X-Goog-Upload-Protocol": "raw",
          "Content-Length": fileBuffer.length.toString(),
        },
      };

      return new Promise((resolve, reject) => {
        const req = https.request(options, (res) => {
          let responseData = "";

          res.on("data", (chunk) => {
            responseData += chunk;
          });

          res.on("end", () => {
            if (
              res.statusCode &&
              res.statusCode >= 200 &&
              res.statusCode < 300
            ) {
              console.log("✅ File uploaded successfully, got upload token");
              console.log("Response data", responseData);
              resolve(responseData); // The upload token is returned as raw text
            } else {
              reject(
                new Error(`Upload failed: ${res.statusCode} - ${responseData}`)
              );
            }
          });
        });

        req.on("error", (error) => {
          reject(new Error(`Upload request failed: ${error.message}`));
        });

        console.log("Writing file buffer", fileBuffer);
        // Write the file buffer
        req.write(fileBuffer);
        req.end();
      });
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      throw new Error(`Failed to upload bytes: ${errorMessage}`);
    }
  }

  /**
   * Create media items using upload tokens
   */
  async batchCreateMediaItems(
    uploadTokens: Array<{
      token: string;
      fileName: string;
      description?: string;
    }>
  ): Promise<BatchCreateResponse> {
    if (!this.auth) {
      throw new Error("Not authenticated. Call initialize() first.");
    }

    try {
      console.log(`📝 Creating ${uploadTokens.length} media item(s)...`);

      const newMediaItems: NewMediaItem[] = uploadTokens.map((item) => ({
        description: item.description || "",
        simpleMediaItem: {
          fileName: item.fileName,
          uploadToken: item.token,
        },
      }));

      const requestData: BatchCreateRequest = {
        newMediaItems,
      };

      // Get access token
      const accessToken = await this.getAccessToken();

      const url = new URL(`${this.baseUrl}/mediaItems:batchCreate`);

      const options: https.RequestOptions = {
        hostname: url.hostname,
        path: url.pathname,
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
      };

      const jsonData = JSON.stringify(requestData);
      (options.headers as Record<string, string>)["Content-Length"] =
        Buffer.byteLength(jsonData).toString();

      return new Promise((resolve, reject) => {
        const req = https.request(options, (res) => {
          let responseData = "";

          res.on("data", (chunk) => {
            responseData += chunk;
          });

          res.on("end", () => {
            try {
              const parsed = JSON.parse(responseData);
              console.log("Parsed", parsed);
              if (
                res.statusCode &&
                res.statusCode >= 200 &&
                res.statusCode < 300
              ) {
                console.log("✅ Media items created successfully");
                resolve(parsed as BatchCreateResponse);
              } else {
                reject(
                  new Error(
                    `BatchCreate failed: ${res.statusCode} - ${
                      parsed.error?.message || responseData
                    }`
                  )
                );
              }
            } catch (error: unknown) {
              const errorMessage =
                error instanceof Error ? error.message : "Unknown error";
              reject(new Error(`Failed to parse response: ${errorMessage}`));
            }
          });
        });

        req.on("error", (error) => {
          reject(new Error(`BatchCreate request failed: ${error.message}`));
        });

        console.log("Request data", jsonData);
        req.write(jsonData);
        req.end();
      });
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      throw new Error(`Failed to create media items: ${errorMessage}`);
    }
  }

  /**
   * Upload a single file to Google Photos
   */
  async uploadFile(filePath: string, description?: string): Promise<MediaItem> {
    try {
      // Step 1: Upload bytes to get upload token
      const uploadToken = await this.uploadBytes(filePath);

      // Step 2: Create media item using the upload token
      const fileName = path.basename(filePath);
      const response = await this.batchCreateMediaItems([
        {
          token: uploadToken,
          fileName: "the cat to be uploaded",
          description,
        },
      ]);

      // Check if the upload was successful
      if (
        !response.newMediaItemResults ||
        response.newMediaItemResults.length === 0
      ) {
        throw new Error("No results returned from batchCreate");
      }

      const result = response.newMediaItemResults[0];
      if (!result) {
        throw new Error("Invalid result returned from batchCreate");
      }

      if (result.mediaItem) {
        console.log(`🎉 Successfully uploaded ${fileName}`);
        console.log(`📷 Media Item ID: ${result.mediaItem.id}`);
        console.log(`🔗 Product URL: ${result.mediaItem.productUrl}`);
        return result.mediaItem;
      }

      throw new Error(
        `Failed to create media item: ${
          result.status.message || "Unknown error"
        }`
      );
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      throw new Error(`Failed to upload file: ${errorMessage}`);
    }
  }

  /**
   * Get MIME type based on file extension
   */
  private getMimeType(fileName: string): string {
    const ext = path.extname(fileName).toLowerCase();
    const mimeTypes: Record<string, string> = {
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".png": "image/png",
      ".gif": "image/gif",
      ".webp": "image/webp",
      ".bmp": "image/bmp",
      ".tiff": "image/tiff",
      ".tif": "image/tiff",
      ".heic": "image/heic",
      ".avif": "image/avif",
      ".mp4": "video/mp4",
      ".mov": "video/quicktime",
      ".avi": "video/x-msvideo",
      ".mkv": "video/x-matroska",
      ".webm": "video/webm",
    };

    return mimeTypes[ext] || "application/octet-stream";
  }
}

// Example usage
async function main() {
  const uploader = new GooglePhotosUploader();

  try {
    // Initialize authentication
    const initialized = await uploader.initialize();
    if (!initialized) {
      return;
    }

    console.log("🚀 Starting Google Photos upload...\n");

    // Upload the cat.jpg file
    const catImagePath = "assets/cat.jpg";

    // Check if file exists
    try {
      await fs.access(catImagePath);
    } catch {
      console.error(`❌ File not found: ${catImagePath}`);
      console.log(
        "Please make sure the cat.jpg file exists in the assets/ directory"
      );
      return;
    }

    const mediaItem = await uploader.uploadFile(
      catImagePath,
      "A cute cat photo uploaded via Google Photos API"
    );

    console.log("\n=== UPLOAD SUCCESSFUL ===");
    console.log(`File: ${mediaItem.filename}`);
    console.log(`ID: ${mediaItem.id}`);
    console.log(`URL: ${mediaItem.productUrl}`);
    console.log(`MIME Type: ${mediaItem.mimeType}`);

    if (mediaItem.mediaMetadata) {
      console.log(`Creation Time: ${mediaItem.mediaMetadata.creationTime}`);
      if (mediaItem.mediaMetadata.width && mediaItem.mediaMetadata.height) {
        console.log(
          `Dimensions: ${mediaItem.mediaMetadata.width}x${mediaItem.mediaMetadata.height}`
        );
      }
    }
  } catch (error: unknown) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    console.error("❌ Error:", errorMessage);
    console.log("\n=== SETUP INSTRUCTIONS ===");
    console.log(
      "1. Make sure you have a 1Password item with Google Photos API credentials"
    );
    console.log(
      "2. The item should contain client_id and client_secret fields"
    );
    console.log("3. Make sure 1Password CLI is installed and you're signed in");
    console.log(
      "4. The OAuth2 scope should include 'https://www.googleapis.com/auth/photoslibrary'"
    );
    console.log(
      "5. Make sure the cat.jpg file exists in the assets/ directory"
    );
  }
}

// Export the class
export default GooglePhotosUploader;

main();
