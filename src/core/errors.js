// Errors cross the service-worker/content-script boundary as plain strings, so a class
// would not survive the trip. Everything that needs to recognize a failure kind goes
// through these helpers instead of re-matching message text at each call site.

const text = (err) => String(err?.message ?? err ?? '');

/** True for an HTTP 429 from either platform (see rateLimited). */
export const isRateLimited = (err) => /\b429\b/.test(text(err));

/** True for an HTTP 401 reported by the ESPN relay. */
export const isUnauthorized = (err) => /\b401\b/.test(text(err));

/** The error thrown on a 429, tagged so the poll loop backs off instead of retrying fast. */
export const rateLimited = (source) => new Error(`${source} 429: rate limited`);
