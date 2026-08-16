import axios, { AxiosError, InternalAxiosRequestConfig } from "axios";

const baseURL = import.meta.env.VITE_API_URL || "http://localhost:4000";

export const api = axios.create({
  baseURL,
  headers: { "Content-Type": "application/json" }
});

const ACCESS = "accessToken";
const REFRESH = "refreshToken";
const ROLE = "role";

let refreshInFlight: Promise<string | null> | null = null;

const AUTH_EVENT = "nftaix:auth-change";

function emitAuthChanged() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(AUTH_EVENT));
}

function getAccess(): string | null {
  return localStorage.getItem(ACCESS);
}

function getRefresh(): string | null {
  return localStorage.getItem(REFRESH);
}

export function setTokens(accessToken: string, refreshToken: string) {
  localStorage.setItem(ACCESS, accessToken);
  localStorage.setItem(REFRESH, refreshToken);
  emitAuthChanged();
}

export function clearTokens() {
  localStorage.removeItem(ACCESS);
  localStorage.removeItem(REFRESH);
  localStorage.removeItem(ROLE);
  emitAuthChanged();
}

async function refreshAccessToken(): Promise<string | null> {
  const rt = getRefresh();
  if (!rt) return null;
  const { data } = await axios.post<{ accessToken: string; refreshToken: string }>(`${baseURL}/api/auth/refresh`, {
    refreshToken: rt
  });
  setTokens(data.accessToken, data.refreshToken);
  return data.accessToken;
}

function queueRefresh(): Promise<string | null> {
  if (!refreshInFlight) {
    refreshInFlight = refreshAccessToken().finally(() => {
      refreshInFlight = null;
    });
  }
  return refreshInFlight;
}

api.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const token = getAccess();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (res) => res,
  async (err: AxiosError) => {
    const original = err.config as InternalAxiosRequestConfig & { _retry?: boolean };
    if (!original || original._retry) return Promise.reject(err);
    if (err.response?.status !== 401) return Promise.reject(err);
    if (original.url?.includes("/api/auth/refresh") || original.url?.includes("/api/auth/login")) {
      return Promise.reject(err);
    }
    original._retry = true;
    try {
      const newAccess = await queueRefresh();
      if (!newAccess) {
        clearTokens();
        return Promise.reject(err);
      }
      original.headers.Authorization = `Bearer ${newAccess}`;
      return api(original);
    } catch {
      clearTokens();
      return Promise.reject(err);
    }
  }
);

export { ACCESS, REFRESH, ROLE, baseURL };
export { AUTH_EVENT };
