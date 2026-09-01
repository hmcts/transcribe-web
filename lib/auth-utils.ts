/**
 * Utility functions for authentication
 */

import { jwtDecode } from "jwt-decode";
import { isLocalDevelopment } from "@/lib/environment";

let tokenCache: { token: string | null; expires: number } = {
  token: null,
  expires: 0,
};

/**
 * Check if token is expired or expiring soon
 * @param token JWT token to check
 * @param bufferSeconds Number of seconds before expiry to consider token as expiring
 * @returns true if token is expired or expiring within buffer period
 */
function isTokenExpiringSoon(token: string, bufferSeconds: number): boolean {
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
 * Get JWT token from Easy Auth with intelligent refresh strategy
 *
 * Strategy:
 * 1. Check cache first (expires 10min before JWT expiry)
 * 2. On cache miss, fetch from /.auth/me
 * 3. Validate token expiration (check 'exp' claim)
 * 4. If expired or expiring soon (< 10min), refresh then retry
 * 5. Cache valid tokens until 10min before expiry
 *
 * @returns JWT token or null if not available
 */
export async function getAuthToken(): Promise<string | null> {
  if (isLocalDevelopment()) {
    return null;
  }

  // Check if we have a valid cached token
  const now = Date.now();
  if (tokenCache.token && now < tokenCache.expires) {
    return tokenCache.token;
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
          if (isTokenExpiringSoon(provider.id_token, 10 * 60)) {
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

                  tokenCache = {
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

          tokenCache = {
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

              tokenCache = {
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
  tokenCache = { token: null, expires: 0 };
  return null;
}
