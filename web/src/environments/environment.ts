export const environment = {
  production: true,
  /**
   * Relative, and proxied to the API deployment by the `/api/(.*)` rewrite in
   * `vercel.json` — so the browser only ever talks to this site's own origin.
   *
   * This used to be the API's absolute URL, on the assumption that a
   * `SameSite=None; Secure` cookie would survive the trip. That assumption
   * expired: `sbc-api.vercel.app` and `sbc.caas-group.com` are different
   * registrable domains, which makes the session cookie a third-party cookie,
   * and current Chrome does not send those at all. The symptom is a sign-in
   * loop — the callback sets the cookie, the SPA's next `/auth/session` call
   * arrives without it, and the app sends the user back to CaaS One.
   *
   * Keeping the API on this origin sidesteps the whole question, and matches
   * how development has always run (see `proxy.conf.json`).
   */
  apiBaseUrl: '/api',
};
