import { getEnv } from "@/lib/env";
import { isDevLoginMode } from "@/lib/dev-login-mode";
import { isLocalDevelopment } from "@/lib/environment";
import { jurisdictionHeaders } from "@/lib/jurisdiction-session";
import type { User } from "@/src/api/generated";

const API_BASE_URL = `${getEnv("NEXT_PUBLIC_API_URL") || "http://localhost:8000"}/api`;

export interface ApiResponse<T> {
  data?: T;
  error?: string;
  status?: number;
  requestId?: string;
  /** The refusal's machine-readable ``detail.code`` (DIAAT-322), when it has one. */
  code?: string;
  /** What the refusal lists as missing (``detail.problems``, DIAAT-344), when it does. */
  problems?: string[];
}

/**
 * API client that handles authentication for both local development and production
 */
/**
 * A FastAPI ``detail`` as text: a string as it is, a structured refusal such as
 * ``{code, message}`` (DIAAT-322) by its message, a validation error list by its
 * messages. Never "[object Object]".
 */
export function detailMessage(detail: unknown): string | undefined {
  if (typeof detail === "string") return detail || undefined;
  if (Array.isArray(detail)) {
    const messages = detail
      .map((item) => (typeof item?.msg === "string" ? item.msg : undefined))
      .filter(Boolean);
    return messages.length ? messages.join("; ") : undefined;
  }
  if (detail && typeof detail === "object") {
    const message = (detail as { message?: unknown }).message;
    return typeof message === "string" && message ? message : undefined;
  }
  return undefined;
}

/** A FastAPI ``detail`` of the form ``{code, message}``: its code. */
function detailCode(detail: unknown): string | undefined {
  if (detail && typeof detail === "object" && !Array.isArray(detail)) {
    const code = (detail as { code?: unknown }).code;
    return typeof code === "string" && code ? code : undefined;
  }
  return undefined;
}

function detailProblems(detail: unknown): string[] | undefined {
  if (detail && typeof detail === "object" && !Array.isArray(detail)) {
    const problems = (detail as { problems?: unknown }).problems;
    if (Array.isArray(problems) && problems.every((p) => typeof p === "string")) {
      return problems.length > 0 ? problems : undefined;
    }
  }
  return undefined;
}

class ApiClient {
  private explicitBaseUrl: string | undefined;

  constructor(baseUrl?: string) {
    this.explicitBaseUrl = baseUrl;
  }

  /**
   * Where calls go. Deployed: this app's own origin, which Caddy forwards to
   * the API. Local development with personas (isDevLoginMode): the same-origin
   * dev proxy at /api, which attaches the session's token. Otherwise the API
   * directly, as before.
   */
  private get baseUrl(): string {
    if (this.explicitBaseUrl) return this.explicitBaseUrl;
    return isDevLoginMode() ? "/api" : API_BASE_URL;
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
          // DIAAT-322: the jurisdiction this tab works in.
          ...jurisdictionHeaders(),
          ...options.headers,
        },
      };

      // In local development against the API directly, be explicit about CORS.
      // Through the dev proxy the call is same-origin and carries the cookie.
      if (isLocalDevelopment() && !isDevLoginMode()) {
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
        let errorCode: string | undefined;
        let errorProblems: string[] | undefined;
        try {
          const errorData = await response.json();
          errorMessage =
            detailMessage(errorData.detail) || errorData.message || errorMessage;
          errorCode = detailCode(errorData.detail);
          errorProblems = detailProblems(errorData.detail);
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
          code?: string;
          problems?: string[];
        };
        e.requestId = bodyRequestId || requestId;
        e.status = response.status;
        e.code = errorCode;
        e.problems = errorProblems;
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
          code?: string;
          problems?: string[];
        };
        return {
          error: error.message,
          status: apiError.status,
          requestId: apiError.requestId,
          ...(apiError.code && { code: apiError.code }),
          ...(apiError.problems && { problems: apiError.problems }),
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
