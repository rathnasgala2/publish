/**
 * Credential-free public reads of the activated Pages origin.
 *
 * These are the adapter's `public-http` and `generation-marker` verification
 * capabilities. They carry no `authorization` header (the credential-egress
 * profile declares zero credentials on the public origin), follow no
 * redirect, and read a bounded body.
 *
 * A redirect is an answer, not a crash: the public base URL a site carries
 * can name a host the site has since moved away from (a custom domain on the
 * Pages site, a base URL still on `github.io`), and the origin then answers
 * 301/302/307/308. The read classifies that as `status: 'redirect'` with the
 * target host, so the adapter can refuse with `PAGES_PUBLIC_REDIRECT` instead
 * of throwing out of the lifecycle.
 *
 * @module
 */

import { PagesAdapterError } from './errors.js';
/** Maximum bytes any single public read will accept. */
export const MAXIMUM_PUBLIC_BODY_BYTES = 33554432;

/**
 * @typedef {Readonly<{
 *   publicBaseUrl: string,
 *   fetch?: typeof globalThis.fetch
 * }>} PublicContext
 */

/**
 * Join the canonical base path to an artifact-relative route exactly once.
 *
 * @param {string} publicBaseUrl the destination's public base URL
 * @param {string} artifactRelativePath the artifact-relative POSIX path
 * @returns {string} the absolute public URL
 */
export function publicUrlFor(publicBaseUrl, artifactRelativePath) {
  const base = publicBaseUrl.endsWith('/')
    ? publicBaseUrl.slice(0, -1)
    : publicBaseUrl;
  return `${base}/${artifactRelativePath}`;
}

/** How long the redirect-target probe may take before the target is unknown. */
const REDIRECT_PROBE_TIMEOUT_MS = 10_000;

/**
 * Whether a failed fetch failed because the origin answered with a redirect
 * the fetch was told not to follow (`redirect: 'error'`). Undici reports it
 * as a `TypeError('fetch failed')` whose `cause` is an `Error` with the exact
 * message `unexpected redirect` (it carries no `code`); no other failure
 * matches.
 *
 * @param {unknown} error the thrown value
 * @returns {boolean} whether it is the refused-redirect failure
 */
function isRefusedRedirect(error) {
  return (
    error instanceof TypeError &&
    /** @type {{message?: unknown} | undefined} */ (error.cause)?.message ===
      'unexpected redirect'
  );
}

/**
 * Learn where a refused redirect pointed. A fetch that refused to follow
 * exposes no `Location`, so the same credential-free URL is asked once more
 * with `redirect: 'manual'`, which hands back the 3xx response itself and
 * still follows nothing. The probe is bounded to ten seconds and its body is
 * cancelled unread. Any failure here, and any `Location` that is not an
 * absolute-or-relative http(s) URL, leaves the target unknown; it never hides
 * the redirect.
 *
 * @param {typeof globalThis.fetch} doFetch the fetch implementation
 * @param {string} url the requested public URL
 * @returns {Promise<{toHost: string | null, location: string | null}>} the
 *   redirect target, `null` where it could not be read
 */
async function redirectTarget(doFetch, url) {
  const unknown = { toHost: null, location: null };
  try {
    const response = await doFetch(url, {
      method: 'GET',
      redirect: 'manual',
      cache: 'no-store',
      signal: AbortSignal.timeout(REDIRECT_PROBE_TIMEOUT_MS),
    });
    await response.body?.cancel().catch(() => undefined);
    const header = response.headers.get('location');
    if (header === null) {
      return unknown;
    }
    const target = new URL(header, url);
    if (target.protocol !== 'https:' && target.protocol !== 'http:') {
      return unknown;
    }
    return { toHost: target.host, location: target.href };
  } catch {
    return unknown;
  }
}

/**
 * Read one public route.
 *
 * @param {PublicContext} context the public-origin context
 * @param {string} artifactRelativePath the artifact-relative POSIX path
 * @returns {Promise<{status: number | 'redirect', bytes: Buffer | null, etag: string | null, toHost?: string | null, location?: string | null}>}
 *   the bounded observation; `bytes` is `null` for any non-`200` status. A
 *   `'redirect'` status carries the `toHost` and absolute `location` the
 *   origin named (`null` when it named none that could be read).
 */
export async function readPublic(context, artifactRelativePath) {
  const doFetch = context.fetch ?? globalThis.fetch;
  const url = publicUrlFor(context.publicBaseUrl, artifactRelativePath);
  let response;
  try {
    response = await doFetch(url, {
      method: 'GET',
      redirect: 'error',
      cache: 'no-store',
    });
  } catch (error) {
    if (!isRefusedRedirect(error)) {
      throw error;
    }
    return {
      status: 'redirect',
      bytes: null,
      etag: null,
      ...(await redirectTarget(doFetch, url)),
    };
  }
  const etag = response.headers.get('etag');
  if (response.status !== 200) {
    return { status: response.status, bytes: null, etag };
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.byteLength > MAXIMUM_PUBLIC_BODY_BYTES) {
    throw new PagesAdapterError(
      `PAGES_PUBLIC_BODY_TOO_LARGE`,
      `${artifactRelativePath} returned ${bytes.byteLength} bytes`,
    );
  }
  return { status: 200, bytes, etag };
}
