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

  constructor(baseUrl: string = API_BASE_URL) {
    this.baseUrl = baseUrl;
  }

  /**
   * Login URL that returns the user to the current page afterwards.
   * Made public for testing purposes.
   */
  public static buildAuthUrl(): string {
    const returnTo = `${window.location.pathname}${window.location.search}`;
    return `/auth/login?returnTo=${encodeURIComponent(returnTo)}`;
  }

  /**
   * The browser holds no token to refresh. The frontend server refreshes the
   * session's token on every API call (Caddy forward_auth -> /auth/forward),
   * so a 401 means the session itself has ended: sign in again.
   */
  private redirectToLogin(): void {
    window.location.href = ApiClient.buildAuthUrl();
  }

  /**
   * Always null. On CNP the browser never holds an access token: Caddy attaches
   * the server-side session's bearer token to every /api/* call. Kept so
   * callers that add `Authorization` only when a token exists keep working.
   */
  private async getAuthToken(): Promise<string | null> {
    return null;
  }

  async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<ApiResponse<T>> {
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
        // Same-origin in deployed environments: send the session cookie.
        requestOptions.credentials = "include";
      }

      const response = await fetch(url, requestOptions);

      if (!response.ok) {
        const requestId = response.headers.get("X-Request-Id") || undefined;
        if (response.status === 401 && !isLocalDevelopment()) {
          // Session ended (expired, signed out elsewhere, or never existed).
          this.redirectToLogin();
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
