function normalizeApiBaseUrl(value) {
  const base = (value || "http://localhost:5000/api").replace(/\/+$/, "");
  return base.endsWith("/api") ? base : `${base}/api`;
}

const API_BASE_URL = normalizeApiBaseUrl(import.meta.env.VITE_API_BASE_URL);
const TOKEN_KEY = "expense_tracker_token";
const PUSH_DEVICE_ID_KEY = "expense_tracker_push_device_id";
const pendingRequestKeys = new Map();
let refreshPromise = null;

function newRequestKey() {
  return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function pushDeviceId() {
  const existing = localStorage.getItem(PUSH_DEVICE_ID_KEY);
  if (existing) return existing;
  const next = newRequestKey();
  localStorage.setItem(PUSH_DEVICE_ID_KEY, next);
  return next;
}

function pushPlatform() {
  const agent = navigator.userAgent || "";
  if (/iphone|ipad|ipod/i.test(agent)) return "iOS PWA/Safari";
  if (/android/i.test(agent)) return "Android Chrome/PWA";
  if (/edg/i.test(agent)) return "Desktop Edge";
  if (/chrome|chromium/i.test(agent)) return "Desktop Chrome";
  if (/safari/i.test(agent)) return "Safari";
  return "Browser";
}

function requestFingerprint(path, method, body) {
  return `${method}:${path}:${JSON.stringify(body ?? null)}`;
}

async function idempotentRequest(path, options, explicitKey) {
  const method = options.method || "POST";
  const fingerprint = requestFingerprint(path, method, options.body);
  const key = explicitKey || pendingRequestKeys.get(fingerprint) || newRequestKey();
  if (!explicitKey) pendingRequestKeys.set(fingerprint, key);
  try {
    const result = await request(path, {
      ...options,
      headers: { ...options.headers, "Idempotency-Key": key }
    });
    pendingRequestKeys.delete(fingerprint);
    return result;
  } catch (error) {
    throw error;
  }
}

export function getAuthToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function setAuthToken(token) {
  if (token) {
    localStorage.setItem(TOKEN_KEY, token);
    return;
  }
  localStorage.removeItem(TOKEN_KEY);
}

async function refreshAccessToken({ silent = false } = {}) {
  if (!refreshPromise) {
    refreshPromise = fetch(`${API_BASE_URL}/auth/refresh`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" }
    })
      .then(async (response) => {
        const payload = await response.json().catch(() => null);
        if (!response.ok || payload?.success === false || !payload?.data?.token) {
          const error = new Error(payload?.message || "Session expired. Please login again.");
          error.status = response.status;
          throw error;
        }
        setAuthToken(payload.data.token);
        return payload.data.token;
      })
      .catch((error) => {
        if (!error.status) {
          const networkError = new Error("Unable to connect to server. Try again.");
          networkError.kind = "network";
          throw networkError;
        }
        throw error;
      })
      .finally(() => { refreshPromise = null; });
  }
  try {
    return await refreshPromise;
  } catch (error) {
    if (!silent && error.status === 401) {
      setAuthToken(null);
      window.dispatchEvent(new CustomEvent("expense-auth-expired"));
    }
    throw error;
  }
}

async function fetchWithAuth(path, options = {}, { retry = true } = {}) {
  const token = getAuthToken();
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    credentials: "include",
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers
    }
  });
  if (response.status === 401 && retry && !["/auth/login", "/auth/signup", "/auth/refresh"].includes(path)) {
    try {
      await refreshAccessToken();
      return fetchWithAuth(path, options, { retry: false });
    } catch (error) {
      throw error;
    }
  }
  return response;
}

function withQuery(path, params = {}) {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") query.set(key, value);
  });
  const queryString = query.toString();
  return queryString ? `${path}?${queryString}` : path;
}

async function request(path, options = {}) {
  let response;
  const method = options.method || "GET";

  if (method !== "GET" && typeof navigator !== "undefined" && navigator.onLine === false) {
    const error = new Error("You appear to be offline. Financial changes were not saved.");
    error.kind = "offline";
    throw error;
  }

  try {
    response = await fetchWithAuth(path, {
      ...options,
      headers: { "Content-Type": "application/json", ...options.headers }
    });
  } catch (err) {
    if (err.status || err.kind) throw err;
    const error = new Error("Unable to connect to server. Try again.");
    error.kind = "network";
    throw error;
  }

  const payload = await response.json().catch(() => null);

  if (!response.ok || payload?.success === false) {
    const message = response.status >= 500 ? friendlyStatusMessage(response.status) : payload?.message || friendlyStatusMessage(response.status);
    const error = new Error(message);
    error.details = payload?.errors || null;
    error.status = response.status;
    if (response.status === 401 && !["/auth/login", "/auth/signup", "/auth/refresh"].includes(path)) {
      window.dispatchEvent(new CustomEvent("expense-auth-expired"));
    }
    throw error;
  }

  return payload?.data;
}

async function requestText(path, options = {}) {
  const response = await fetchWithAuth(path, options);
  if (!response.ok) {
    const error = new Error(friendlyStatusMessage(response.status));
    error.status = response.status;
    throw error;
  }
  return response.text();
}

async function requestBlob(path, options = {}) {
  const response = await fetchWithAuth(path, options);
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    const error = new Error(payload?.message || friendlyStatusMessage(response.status));
    error.status = response.status;
    throw error;
  }
  const disposition = response.headers.get("content-disposition") || "";
  const nameMatch = disposition.match(/filename="?([^"]+)"?/i);
  return { blob: await response.blob(), filename: nameMatch?.[1] || "Expense_Report" };
}

function friendlyStatusMessage(status) {
  if (status === 400) return "Please check the highlighted fields.";
  if (status === 401) return "Please login again.";
  if (status === 404) return "We could not find that record.";
  if (status === 409) return "This already exists.";
  if (status >= 500) return "Unable to save. Your entry has not been lost. Retry.";
  return "Something went wrong. Please retry.";
}

export const api = {
  list: (resource, params) => request(withQuery(`/${resource}`, params)),
  get: (resource, id) => request(`/${resource}/${id}`),
  create: (resource, data, { idempotencyKey } = {}) =>
    idempotentRequest(`/${resource}`, {
      method: "POST",
      body: JSON.stringify(data)
    }, idempotencyKey),
  update: (resource, id, data, { idempotencyKey } = {}) =>
    idempotentRequest(`/${resource}/${id}`, {
      method: "PUT",
      body: JSON.stringify(data)
    }, idempotencyKey),
  remove: (resource, id, { idempotencyKey } = {}) =>
    idempotentRequest(`/${resource}/${id}`, { method: "DELETE" }, idempotencyKey),
  summary: (params) => request(withQuery("/transactions/summary", params)),
  reports: (params) => request(withQuery("/transactions/reports", params)),
  personLedger: (id, params) => request(withQuery(`/people/${id}/ledger`, params)),
  accountLedger: (id) => request(`/accounts/${id}/ledger`),
  obligations: (params) => request(withQuery("/obligations", params)),
  obligation: (id) => request(`/obligations/${id}`),
  settleObligation: (id, data, { idempotencyKey } = {}) =>
    idempotentRequest(`/obligations/${id}/settlements`, {
      method: "POST",
      body: JSON.stringify(data)
    }, idempotencyKey),
  settleObligations: (data, { idempotencyKey } = {}) =>
    idempotentRequest("/obligations/settlements", {
      method: "POST",
      body: JSON.stringify(data)
    }, idempotencyKey),
  reverseSettlement: (id, { idempotencyKey } = {}) =>
    idempotentRequest(`/obligations/settlements/${id}/reverse`, { method: "PATCH" }, idempotencyKey),
  notifications: (params) => request(withQuery("/notifications", params)),
  pushConfig: () => request("/notifications/push/config"),
  pushStatus: () => request("/notifications/push/status"),
  pushDevices: () => request("/notifications/push/devices"),
  disablePushDevice: (id) => request(`/notifications/push/devices/${id}`, { method: "DELETE" }),
  notificationSettings: () => request("/notifications/settings"),
  updateNotificationSettings: (settings) => request("/notifications/settings", { method: "PATCH", body: JSON.stringify(settings) }),
  savePushSubscription: (subscription) => request("/notifications/push/subscriptions", { method: "POST", body: JSON.stringify({ subscription, deviceId: pushDeviceId(), deviceLabel: navigator.userAgent.slice(0, 110), platform: pushPlatform() }) }),
  removePushSubscription: (subscription) => request("/notifications/push/subscriptions", { method: "DELETE", body: JSON.stringify({ endpoint: subscription.endpoint }) }),
  markNotificationRead: (id) =>
    request(`/notifications/${id}/read`, {
      method: "PATCH"
    }),
  completeNotification: (id, data) =>
    request(`/notifications/${id}/complete`, {
      method: "PATCH",
      body: JSON.stringify(data || {})
    }),
  markAllNotificationsRead: () =>
    request("/notifications/read-all", {
      method: "PATCH"
    }),
  archiveNotification: (id) =>
    request(`/notifications/${id}`, {
      method: "DELETE"
    }),
  runRecurring: () =>
    request("/recurring/run", {
      method: "POST"
    }),
  exportBackup: () => request("/backups/full.json"),
  exportTransactionsCsv: (params) => requestText(withQuery("/backups/transactions.csv", params)),
  exportReport: (format, params) => requestBlob(withQuery(`/reports/export.${format}`, params)),
  previewImport: (data) =>
    request("/backups/import/preview", {
      method: "POST",
      body: JSON.stringify(data)
    }),
  restoreImport: (data) =>
    request("/backups/import/restore?confirm=true", {
      method: "POST",
      body: JSON.stringify({ backup: data, confirm: true })
    }),
  login: (data) =>
    request("/auth/login", {
      method: "POST",
      body: JSON.stringify(data)
    }),
  signup: (data) =>
    request("/auth/signup", {
      method: "POST",
      body: JSON.stringify(data)
    }),
  logout: () =>
    request("/auth/logout", {
      method: "POST"
    }),
  me: () => request("/auth/me"),
  restoreSession: () => refreshAccessToken({ silent: true }),
  updatePreferences: (data) =>
    request("/users/preferences", {
      method: "PATCH",
      body: JSON.stringify(data)
    })
};
