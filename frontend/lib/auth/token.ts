const KEY = "plancatch.access_token";
export const tokenStore = {
  get: () =>
    typeof window === "undefined" ? null : window.sessionStorage.getItem(KEY),
  set: (token: string) => window.sessionStorage.setItem(KEY, token),
  clear: () => window.sessionStorage.removeItem(KEY),
};
export const SESSION_EXPIRED = "plancatch:session-expired";
