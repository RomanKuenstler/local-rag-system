export function createApiClient({
  apiBaseUrl,
  getSessionToken,
  onUnauthorized,
  isAuthenticated,
}) {
  function ensureAuthenticatedForPreferencesApi(featureLabel = "this preferences action") {
    if (isAuthenticated()) {
      return;
    }
    onUnauthorized();
    throw new Error(`Please sign in again to use ${featureLabel}.`);
  }

  async function apiFetch(pathOrUrl, options = {}, { skipAuth = false } = {}) {
    const rawUrl = String(pathOrUrl || "");
    const requestUrl = rawUrl.startsWith("http") ? rawUrl : `${apiBaseUrl}${rawUrl}`;
    const headers = new Headers(options.headers || {});
    const token = getSessionToken();
    if (!skipAuth && token) {
      headers.set("X-Session-Token", token);
    }

    const response = await fetch(requestUrl, {
      ...options,
      headers,
    });

    if (response.status === 401 && !skipAuth) {
      onUnauthorized();
    }

    return response;
  }

  async function apiFetchForPreferences(pathOrUrl, options = {}, featureLabel = "this preferences action") {
    ensureAuthenticatedForPreferencesApi(featureLabel);
    return apiFetch(pathOrUrl, options, { skipAuth: false });
  }

  return {
    apiFetch,
    apiFetchForPreferences,
  };
}
