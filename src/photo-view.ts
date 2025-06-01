import https from "node:https";
import { URL } from "node:url";
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

interface ListMediaItemsResponse {
  mediaItems: MediaItem[];
  nextPageToken?: string;
}

interface ListOptions {
  pageSize?: number;
  pageToken?: string;
}

class GooglePhotosViewer {
  private auth: OAuthClient | null = null;
  private readonly baseUrl = "https://photoslibrary.googleapis.com/v1";

  /**
   * Initialize the viewer with OAuth2 authentication
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
   * List media items from the user's Google Photos library
   */
  async listMediaItems(
    options: ListOptions = {}
  ): Promise<ListMediaItemsResponse> {
    if (!this.auth) {
      throw new Error("Not authenticated. Call initialize() first.");
    }

    try {
      const { pageSize = 25, pageToken } = options;

      console.log(`📋 Listing media items (pageSize: ${pageSize})...`);

      // Get access token
      const accessToken = await this.getAccessToken();

      // Build URL with query parameters
      const url = new URL(`${this.baseUrl}/mediaItems`);
      url.searchParams.set("pageSize", pageSize.toString());
      if (pageToken) {
        url.searchParams.set("pageToken", pageToken);
      }

      const requestOptions: https.RequestOptions = {
        hostname: url.hostname,
        path: url.pathname + url.search,
        method: "GET",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
      };

      return new Promise((resolve, reject) => {
        const req = https.request(requestOptions, (res) => {
          let responseData = "";

          res.on("data", (chunk) => {
            responseData += chunk;
          });

          res.on("end", () => {
            try {
              const parsed = JSON.parse(responseData);

              if (
                res.statusCode &&
                res.statusCode >= 200 &&
                res.statusCode < 300
              ) {
                console.log(
                  `✅ Successfully retrieved ${
                    parsed.mediaItems?.length || 0
                  } media items`
                );
                resolve(parsed as ListMediaItemsResponse);
              } else {
                reject(
                  new Error(
                    `List request failed: ${res.statusCode} - ${
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
          reject(new Error(`List request failed: ${error.message}`));
        });

        req.end();
      });
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      throw new Error(`Failed to list media items: ${errorMessage}`);
    }
  }

  /**
   * List all media items with pagination support
   */
  async listAllMediaItems(pageSize: number = 25): Promise<MediaItem[]> {
    const allItems = [];
    let nextPageToken;

    do {
      const response = await this.listMediaItems({
        pageSize,
        pageToken: nextPageToken,
      });

      if (response.mediaItems) {
        allItems.push(...response.mediaItems);
      }

      nextPageToken = response.nextPageToken;

      if (nextPageToken) {
        console.log(
          `📄 Fetching next page... (${allItems.length} items so far)`
        );
      }
    } while (nextPageToken);

    return allItems;
  }

  /**
   * Display media items in a formatted way
   */
  displayMediaItems(mediaItems: MediaItem[]): void {
    console.log(`\n📸 Found ${mediaItems.length} media items:\n`);

    mediaItems.forEach((item, index) => {
      console.log(`${index + 1}. ${item.filename}`);
      console.log(`   ID: ${item.id}`);
      console.log(`   Type: ${item.mimeType}`);
      console.log(`   URL: ${item.productUrl}`);

      if (item.description) {
        console.log(`   Description: ${item.description}`);
      }

      if (item.mediaMetadata) {
        console.log(`   Created: ${item.mediaMetadata.creationTime}`);

        if (item.mediaMetadata.width && item.mediaMetadata.height) {
          console.log(
            `   Dimensions: ${item.mediaMetadata.width}x${item.mediaMetadata.height}`
          );
        }

        if (item.mediaMetadata.photo) {
          const photo = item.mediaMetadata.photo;
          if (photo.cameraMake || photo.cameraModel) {
            console.log(
              `   Camera: ${photo.cameraMake || ""} ${
                photo.cameraModel || ""
              }`.trim()
            );
          }
        }
      }

      console.log(); // Empty line for spacing
    });
  }

  /**
   * Get a specific media item by ID
   */
  async getMediaItem(mediaItemId: string): Promise<MediaItem> {
    if (!this.auth) {
      throw new Error("Not authenticated. Call initialize() first.");
    }

    try {
      console.log(`🔍 Getting media item: ${mediaItemId}...`);

      // Get access token
      const accessToken = await this.getAccessToken();

      const url = new URL(`${this.baseUrl}/mediaItems/${mediaItemId}`);

      const requestOptions: https.RequestOptions = {
        hostname: url.hostname,
        path: url.pathname,
        method: "GET",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
      };

      return new Promise((resolve, reject) => {
        const req = https.request(requestOptions, (res) => {
          let responseData = "";

          res.on("data", (chunk) => {
            responseData += chunk;
          });

          res.on("end", () => {
            try {
              const parsed = JSON.parse(responseData);

              if (
                res.statusCode &&
                res.statusCode >= 200 &&
                res.statusCode < 300
              ) {
                console.log("✅ Successfully retrieved media item");
                resolve(parsed as MediaItem);
              } else {
                reject(
                  new Error(
                    `Get media item failed: ${res.statusCode} - ${
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
          reject(new Error(`Get media item request failed: ${error.message}`));
        });

        req.end();
      });
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      throw new Error(`Failed to get media item: ${errorMessage}`);
    }
  }
}

// Example usage
async function main() {
  const viewer = new GooglePhotosViewer();

  try {
    // Initialize authentication
    const initialized = await viewer.initialize();
    if (!initialized) {
      return;
    }

    console.log("🚀 Starting Google Photos viewer...\n");

    // List first 10 media items
    console.log("=== LISTING FIRST 10 MEDIA ITEMS ===");
    const response = await viewer.listMediaItems({ pageSize: 10 });

    if (response.mediaItems && response.mediaItems.length > 0) {
      viewer.displayMediaItems(response.mediaItems);

      // Example: Get details of the first media item
      const firstItem = response.mediaItems[0];
      if (firstItem) {
        console.log("=== GETTING DETAILED INFO FOR FIRST ITEM ===");
        const detailedItem = await viewer.getMediaItem(firstItem.id);
        console.log("Detailed item:", JSON.stringify(detailedItem, null, 2));
      }

      // Show pagination info
      if (response.nextPageToken) {
        console.log(
          `\n📄 More items available. Use nextPageToken: ${response.nextPageToken}`
        );
      }
    } else {
      console.log("📭 No media items found in your Google Photos library.");
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
      "4. The OAuth2 scope should include 'https://www.googleapis.com/auth/photoslibrary.readonly'"
    );
  }
}

// Export the class
export default GooglePhotosViewer;

// Uncomment the line below to run the example
main();
