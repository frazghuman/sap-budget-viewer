export const environment = {
  production: true,
  /**
   * Absolute, because the deployed API is a separate origin from the site.
   * `/api` is the Nest global prefix (see the backend's `main.ts`).
   *
   * Cross-origin means the session cookie only survives if the API sets it
   * with `SameSite=None; Secure` and allows this site's origin with
   * `credentials: true` — every request here already sends `withCredentials`.
   */
  apiBaseUrl: 'https://sbc-api.vercel.app/api',
};
