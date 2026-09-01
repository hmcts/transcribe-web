import { jwtDecode } from "jwt-decode";
import { getEnv } from "@/lib/env";
import { isLocalDevelopment } from "@/lib/environment";
import type { User } from "@/src/api/generated";

const API_BASE_URL = `${getEnv("NEXT_PUBLIC_API_URL") || "http://localhost:8000"}/api`;

export interface ApiResponse<T> {
  data?: T;
  error?: string;
  status?: number;
  requestId?: string;
}

/**
 * API client that handles authentication for both local development and production
 */
class ApiClient {
  private baseUrl: string;

  private tokenCache: { token: string | null; expires: number } = {
    token: null,
    expires: 0,
  };

  constructor(baseUrl: string = API_BASE_URL) {
    this.baseUrl = baseUrl;
  }

  /**
   * Build authentication URL with return URL parameter
   * Made public for testing purposes
   */
  public static buildAuthUrl(): string {
    const returnUrl = encodeURIComponent(window.location.href);
    return `/.auth/login/aad?post_login_redirect_uri=${returnUrl}`;
  }

  /**
   * Force refresh the authentication session by redirecting to Easy Auth refresh endpoint
   */
  private async refreshAuthSession(): Promise<void> {
    if (isLocalDevelopment()) {
      return;
    }

    try {
      // Clear token cache first
      this.tokenCache = { token: null, expires: 0 };

      // Try to refresh the session using Easy Auth refresh endpoint
      const refreshResponse = await fetch("/.auth/refresh", {
        method: "POST",
        credentials: "include",
      });

      if (!refreshResponse.ok) {
        console.warn("⚠️ Session refresh failed, redirecting to login");
        // If refresh fails, redirect to login with return URL
        window.location.href = ApiClient.buildAuthUrl();
      }
    } catch (error) {
      console.error("❌ Failed to refresh auth session:", error);
      // Fallback: redirect to login with return URL
      window.location.href = ApiClient.buildAuthUrl();
    }
  }

  /**
   * Check if token is expired or expiring soon
   */
  private isTokenExpiringSoon(token: string, bufferSeconds: number): boolean {
    try {
      const payload = jwtDecode<{ exp: number }>(token);
      const expiresAt = payload.exp * 1000; // Convert to milliseconds
      const now = Date.now();
      const timeUntilExpiry = expiresAt - now;
      return timeUntilExpiry <= bufferSeconds * 1000;
    } catch {
      // If we can't parse the token, treat it as expired
      return true;
    }
  }

  /**
   * Get JWT token from Easy Auth with refresh strategy
   *
   * Strategy:
   * 1. Check cache first (expires 10min before JWT expiry)
   * 2. On cache miss, fetch from /.auth/me
   * 3. Validate token expiration (check 'exp' claim)
   * 4. If expired or expiring soon (< 10min), refresh then retry
   * 5. Cache valid tokens until 10min before expiry
   */
  private async getAuthToken(): Promise<string | null> {
    if (isLocalDevelopment()) {
      return null;
    }

    // Check if we have a valid cached token
    const now = Date.now();
    if (this.tokenCache.token && now < this.tokenCache.expires) {
      return this.tokenCache.token;
    }

    try {
      // Try fetching current token first (don't refresh unnecessarily)
      const response = await fetch("/.auth/me", {
        credentials: "include",
        cache: "no-store",
      });

      if (response.ok) {
        const authInfo = await response.json();
        if (authInfo && authInfo.length > 0) {
          const provider = authInfo[0];

          if (provider.id_token) {
            // Check if token is expired or expiring soon (within 10 minutes)
            if (this.isTokenExpiringSoon(provider.id_token, 10 * 60)) {
              console.warn("Token expiring soon, refreshing from Easy Auth...");

              // Token is expiring - refresh it
              const refreshResponse = await fetch("/.auth/refresh", {
                credentials: "include",
              });

              if (!refreshResponse.ok) {
                throw new Error(
                  `Token refresh failed: ${refreshResponse.status}`
                );
              }

              // Fetch the refreshed token
              const refreshedResponse = await fetch("/.auth/me", {
                credentials: "include",
                cache: "no-store",
              });

              if (refreshedResponse.ok) {
                const refreshedAuthInfo = await refreshedResponse.json();

                if (refreshedAuthInfo && refreshedAuthInfo.length > 0) {
                  const refreshedProvider = refreshedAuthInfo[0];

                  if (refreshedProvider?.id_token) {
                    // Cache until 10 minutes before token expiry
                    const payload = jwtDecode<{ exp: number }>(
                      refreshedProvider.id_token
                    );
                    const tokenExpiresAt = payload.exp * 1000; // Convert to ms
                    const safeExpiryTime = tokenExpiresAt - 10 * 60 * 1000; // 10 min buffer

                    this.tokenCache = {
                      token: refreshedProvider.id_token,
                      expires: safeExpiryTime,
                    };
                    return refreshedProvider.id_token;
                  }
                }
              }

              // Refresh succeeded but couldn't get refreshed token - don't return expiring token
              throw new Error(
                "Token refresh succeeded but failed to retrieve refreshed token"
              );
            }

            // Token is still valid - cache until 10 min before expiry
            const payload = jwtDecode<{ exp: number }>(provider.id_token);
            const tokenExpiresAt = payload.exp * 1000; // Convert to ms
            const safeExpiryTime = tokenExpiresAt - 10 * 60 * 1000; // 10 min buffer

            this.tokenCache = {
              token: provider.id_token,
              expires: safeExpiryTime,
            };
            return provider.id_token;
          }

          console.warn("⚠️ No id_token found in auth response");
        }
      }
    } catch (error) {
      console.error("Failed to get auth token:", error);

      // If fetching fails, try refreshing as a recovery strategy
      try {
        console.warn("Attempting token refresh as recovery...");
        const refreshResponse = await fetch("/.auth/refresh", {
          credentials: "include",
        });

        if (refreshResponse.ok) {
          const response = await fetch("/.auth/me", {
            credentials: "include",
            cache: "no-store",
          });

          if (response.ok) {
            const authInfo = await response.json();

            if (authInfo && authInfo.length > 0) {
              const provider = authInfo[0];

              if (provider?.id_token) {
                // Cache until 10 min before token expiry
                const payload = jwtDecode<{ exp: number }>(provider.id_token);
                const tokenExpiresAt = payload.exp * 1000; // Convert to ms
                const safeExpiryTime = tokenExpiresAt - 10 * 60 * 1000; // 10 min buffer

                this.tokenCache = {
                  token: provider.id_token,
                  expires: safeExpiryTime,
                };
                return provider.id_token;
              }
            }
          }
        }
      } catch (refreshError) {
        console.error("Token refresh recovery failed:", refreshError);
      }
    }

    // Clear cache on failure
    this.tokenCache = { token: null, expires: 0 };
    return null;
  }

  async request<T>(
    endpoint: string,
    options: RequestInit = {},
    retryCount = 0
  ): Promise<ApiResponse<T>> {
    const MAX_RETRIES = 1;

    try {
      const url = `${this.baseUrl}${endpoint}`;

      // Get authentication token in production
      const authToken = await this.getAuthToken();

      // Check if body is FormData - if so, don't set Content-Type (browser will set it with boundary)
      const isFormData = options.body instanceof FormData;

      const requestOptions: RequestInit = {
        ...options,
        headers: {
          // Only set Content-Type for non-FormData requests
          ...(!isFormData && { "Content-Type": "application/json" }),
          // Pass the token to backend
          ...(authToken && { Authorization: `Bearer ${authToken}` }),
          ...options.headers,
        },
      };

      // In local development, we need to be explicit about CORS
      if (isLocalDevelopment()) {
        requestOptions.mode = "cors";
        requestOptions.credentials = "omit";
      } else {
        // In production, include credentials for Easy Auth
        requestOptions.credentials = "include";
      }

      const response = await fetch(url, requestOptions);

      if (!response.ok) {
        const requestId = response.headers.get("X-Request-Id") || undefined;
        if (
          response.status === 401 &&
          !isLocalDevelopment() &&
          retryCount < MAX_RETRIES
        ) {
          console.warn(
            "🔄 Received 401, attempting to refresh session and retry..."
          );

          // Clear token cache and refresh session
          this.tokenCache = { token: null, expires: 0 };
          await this.refreshAuthSession();

          // Retry the request
          return await this.request(endpoint, options, retryCount + 1);
        }

        if (response.status === 401) {
          const errorMessage = isLocalDevelopment()
            ? "Authentication failed. Check if backend is running."
            : "Authentication failed. Your session may have expired. Please refresh the page to log in again.";
          const e = new Error(errorMessage) as Error & {
            requestId?: string;
            status?: number;
          };
          e.requestId = requestId;
          e.status = response.status;
          throw e;
        }
        if (response.status === 405) {
          const e = new Error(
            `Method ${options.method || "GET"} not allowed for ${endpoint}`
          ) as Error & { requestId?: string; status?: number };
          e.requestId = requestId;
          e.status = response.status;
          throw e;
        }

        // Try to extract error message from response body
        let errorMessage = `HTTP error! status: ${response.status}`;
        let bodyRequestId: string | undefined;
        try {
          const errorData = await response.json();
          errorMessage = errorData.detail || errorData.message || errorMessage;
          if (errorData.request_id) {
            bodyRequestId = errorData.request_id as string;
          }
        } catch (parseError) {
          console.error("Error parsing response body:", parseError);
          // If we can't parse the response body, fall back to generic error (errorMessage already set above)
        }
        const e = new Error(errorMessage) as Error & {
          requestId?: string;
          status?: number;
        };
        e.requestId = bodyRequestId || requestId;
        e.status = response.status;
        throw e;
      }

      // Handle 204 No Content responses (e.g., DELETE operations)
      // These responses have no body, so we shouldn't try to parse JSON
      if (response.status === 204) {
        return {
          data: undefined as T,
          status: response.status,
          requestId: response.headers.get("X-Request-Id") || undefined,
        };
      }

      const data = await response.json();
      return {
        data,
        status: response.status,
        requestId: response.headers.get("X-Request-Id") || undefined,
      };
    } catch (error) {
      console.error("API request failed:", error);

      // If this was a retry attempt and it still failed, provide a more helpful error message
      if (
        retryCount > 0 &&
        error instanceof Error &&
        error.message.includes("Authentication failed")
      ) {
        const apiError = error as Error & {
          requestId?: string;
          status?: number;
        };
        return {
          error:
            "Session expired and automatic refresh failed. Please refresh the page to log in again.",
          status: apiError.status,
          requestId: apiError.requestId,
        };
      }

      if (error instanceof Error) {
        const apiError = error as Error & {
          requestId?: string;
          status?: number;
        };
        return {
          error: error.message,
          status: apiError.status,
          requestId: apiError.requestId,
        };
      }

      return {
        error: "Unknown error occurred",
      };
    }
  }

  async getToken(): Promise<string | null> {
    return this.getAuthToken();
  }

  async getSpeechToken(baseUrlOverride?: string) {
    const client = baseUrlOverride ? new ApiClient(baseUrlOverride) : this;
    return client.request<{ token: string; endpoint: string }>(
      "/get-speech-token",
      { method: "GET" }
    );
  }

  // Add a simple test method
  async testCors() {
    return this.request<{ status: string }>("/health");
  }

  // API methods
  async getRoot() {
    return this.request<{
      message: string;
      authenticated_user: {
        name: string;
        email: string;
        user_id: string;
      };
    }>("/");
  }

  async getUserProfile() {
    return this.request<User>("/user/profile");
  }

  async getCurrentUser() {
    return this.request<User>("/users/me");
  }

  async getItems() {
    return this.request<Array<unknown>>("/items/");
  }

  async getHealth() {
    return this.request<{ status: string }>("/health");
  }

  // Additional API methods for the endpoints used in the application
  async getTemplates() {
    return this.request<{ templates: any[] }>("/templates");
  }

  /**
   * Get a User Delegation SAS URL for direct client upload to Azure Blob Storage.
   * Uses managed identity authentication on the backend.
   */
  async getUploadUrl(fileExtension: string) {
    return this.request<{
      upload_url: string;
      user_upload_s3_file_key: string;
    }>("/get-upload-url", {
      method: "POST",
      body: JSON.stringify({ file_extension: fileExtension }),
    });
  }

  async startTranscriptionJob(userUploadS3FileKey: string) {
    return this.request("/start-transcription-job", {
      method: "POST",
      body: JSON.stringify({ user_upload_s3_file_key: userUploadS3FileKey }),
    });
  }

  async generateOrEditMinutes(data: any) {
    return this.request<{ minute_version_id: string }>(
      "/generate-or-edit-minutes",
      {
        method: "POST",
        body: JSON.stringify(data),
      }
    );
  }

  async getAudioPlaybackUrl(transcriptionId: string, jobId: string) {
    return this.request<{ playback_url: string }>(
      `/transcriptions/${transcriptionId}/jobs/${jobId}/audio-url`
    );
  }

  async queryLLMOutput(taskId: string) {
    return this.request<any>(`/query-llm-output/${taskId}`);
  }

  /**
   * Get a fresh, time-limited download URL for a hearing document.
   * Generates a new SAS token each time so links never expire before use.
   */
  async getDocumentDownloadUrl(transcriptionId: string) {
    return this.request<{ download_url: string }>(
      `/transcriptions/${transcriptionId}/document-download`
    );
  }
}

export const apiClient = new ApiClient();
