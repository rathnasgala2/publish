/**
 * One bounded-retry GET for GitHub REST reads of Actions resources.
 *
 * GitHub's artifact and run REST views are eventually consistent: an artifact
 * uploaded by an earlier job can answer 404 for a short while. A read that
 * does not return 200 is retried with backoff when the failure is transient
 * (404, 5xx, a network error, or a 403/429 that carries a rate-limit signal).
 * A 200 is returned to the caller at once and is never retried: verifying its
 * body (identity, digest, size) stays the caller's hard-failure decision.
 */

/** Seconds waited before each retry; the sum is the retry budget. */
export const RETRY_DELAYS_SECONDS = Object.freeze([1, 2, 4, 8, 16, 30]);

/** The longest single wait honoured from a Retry-After header. */
const MAX_RETRY_AFTER_SECONDS = 60;

/**
 * @param {Response} response the response to classify
 * @returns {boolean} whether the status is worth retrying
 */
function isTransient(response) {
  const { status } = response;
  if (status === 404 || status >= 500) {
    return true;
  }
  if (status === 429) {
    return true;
  }
  if (status === 403) {
    return (
      response.headers.get('retry-after') !== null ||
      response.headers.get('x-ratelimit-remaining') === '0'
    );
  }
  return false;
}

/**
 * @param {Response} response the throttling response
 * @param {number} fallback the backoff delay in seconds
 * @returns {number} the delay in seconds
 */
function delayFor(response, fallback) {
  const header = response.headers.get('retry-after');
  const seconds = header === null ? Number.NaN : Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(Math.max(seconds, fallback), MAX_RETRY_AFTER_SECONDS);
  }
  return fallback;
}

/**
 * @param {string} url the REST URL
 * @param {RequestInit} init the fetch options
 * @param {object} [hooks] test seams
 * @param {typeof fetch} [hooks.fetchImpl] the fetch implementation
 * @param {(milliseconds: number) => Promise<void>} [hooks.sleep] the waiter
 * @param {(line: string) => void} [hooks.log] the retry logger
 * @param {readonly number[]} [hooks.delays] the backoff schedule in seconds
 * @returns {Promise<Response>} the final response (200, a non-transient
 *   status, or the last transient status once the budget is spent)
 */
export async function getWithRetry(url, init, hooks = {}) {
  const fetchImpl = hooks.fetchImpl ?? fetch;
  const sleep =
    hooks.sleep ??
    ((milliseconds) =>
      new Promise((resolve) => setTimeout(resolve, milliseconds)));
  const log = hooks.log ?? ((line) => process.stderr.write(`${line}\n`));
  const delays = hooks.delays ?? RETRY_DELAYS_SECONDS;

  for (let attempt = 0; ; attempt += 1) {
    /** @type {Response | undefined} */
    let response;
    /** @type {string} */
    let observed;
    try {
      response = await fetchImpl(url, init);
      observed = `HTTP ${response.status}`;
      if (!isTransient(response)) {
        return response;
      }
    } catch (error) {
      if (attempt >= delays.length) {
        throw error;
      }
      observed = `network error (${error instanceof Error ? error.name : 'unknown'})`;
    }
    if (attempt >= delays.length) {
      return /** @type {Response} */ (response);
    }
    const base = delays[attempt] ?? 0;
    const seconds = response === undefined ? base : delayFor(response, base);
    log(
      `GITHUB_REST_RETRY: ${observed}; retry ${attempt + 1} of ${delays.length} in ${seconds}s`,
    );
    await sleep(seconds * 1000);
  }
}
