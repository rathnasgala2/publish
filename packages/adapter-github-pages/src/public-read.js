/**
 * Credential-free public reads of the activated Pages origin.
 *
 * These are the adapter's `public-http` and `generation-marker` verification
 * capabilities. They carry no `authorization` header (the credential-egress
 * profile declares zero credentials on the public origin), follow no
 * redirect, and read a bounded body.
 *
 * @module
 */

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

/**
 * Read one public route.
 *
 * @param {PublicContext} context the public-origin context
 * @param {string} artifactRelativePath the artifact-relative POSIX path
 * @returns {Promise<{status: number, bytes: Buffer | null, etag: string | null}>}
 *   the bounded observation; `bytes` is `null` for any non-`200` status
 */
export async function readPublic(context, artifactRelativePath) {
  const doFetch = context.fetch ?? globalThis.fetch;
  const response = await doFetch(
    publicUrlFor(context.publicBaseUrl, artifactRelativePath),
    { method: 'GET', redirect: 'error', cache: 'no-store' },
  );
  const etag = response.headers.get('etag');
  if (response.status !== 200) {
    return { status: response.status, bytes: null, etag };
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.byteLength > MAXIMUM_PUBLIC_BODY_BYTES) {
    throw new Error(
      `PAGES_PUBLIC_BODY_TOO_LARGE: ${artifactRelativePath} returned ${bytes.byteLength} bytes`,
    );
  }
  return { status: 200, bytes, etag };
}
