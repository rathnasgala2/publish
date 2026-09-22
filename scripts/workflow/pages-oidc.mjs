/**
 * `gala-pages-oidc-v2`: the one Pages OIDC token acquisition (DEC-097
 * section 7's closed credential-source profile).
 *
 * The `deploy-github-pages` job is granted `id-token: write` for exactly one
 * purpose: to obtain, once, the default-audience GitHub Actions ID token the
 * official Pages create-deployment operation requires as its mandatory
 * `oidc_token` body member. This module is that acquisition, and nothing
 * else. It is deliberately not part of `@rathnasgala2/adapter-github-pages`:
 * the adapter takes the token as caller-supplied input and never mints,
 * refreshes or discovers a credential.
 *
 * Everything about the request is fixed before the runner bearer is read:
 * the request target is copied byte-for-byte from the already validated
 * `ACTIONS_ID_TOKEN_REQUEST_URL`, no `audience` parameter is added (this is
 * the no-argument default-audience operation the official Pages action
 * uses, not the distinct Gala workload audience used by
 * `scripts/workflow/exchange.mjs`), and the resulting origin must be an
 * exact member of the closed origin catalog below. There is exactly one
 * call, no redirect, no proxy, no retry and no second request.
 *
 * @module
 */

/**
 * The closed `githubActionsOidcOriginCatalog`. DEC-097 requires exact
 * catalog membership, established before the runner bearer is read or
 * emitted: a syntactically valid but uncataloged shard rejects. Extending
 * this list is a capability-decision change, not a runtime fallback.
 */
export const GITHUB_ACTIONS_OIDC_ORIGIN_CATALOG = Object.freeze([
  'https://pipelines.actions.githubusercontent.com',
  'https://pipelinesghubeus2.actions.githubusercontent.com',
  'https://pipelinesghubeus26.actions.githubusercontent.com',
]);

/** Maximum bytes of the source URL, per DEC-097. */
export const MAXIMUM_SOURCE_URL_BYTES = 8192;

/** Maximum response entity bytes the token endpoint may return. */
export const MAXIMUM_TOKEN_RESPONSE_BYTES = 16384;

/** Maximum bytes of the runner bearer value. */
export const MAXIMUM_RUNNER_BEARER_BYTES = 4096;

/** Maximum bytes of the returned compact JWT. */
export const MAXIMUM_OIDC_TOKEN_BYTES = 8000;

/** One request-target path segment: 1..128 bytes of `[A-Za-z0-9._~-]`. */
const SAFE_SEGMENT = '[A-Za-z0-9._~-]{1,128}';

/**
 * The exact request-target grammar DEC-097 fixes:
 *
 * ```text
 * path  = "/" safeSegment "/" safeSegment
 *         "/_apis/distributedtask/hubs/Actions/plans/" safeSegment
 *         "/jobs/" safeSegment "/idtoken"
 * query = "api-version=2.0"
 * ```
 */
const REQUEST_TARGET_PATTERN = new RegExp(
  `^/${SAFE_SEGMENT}/${SAFE_SEGMENT}/_apis/distributedtask/hubs/Actions/plans/${SAFE_SEGMENT}/jobs/${SAFE_SEGMENT}/idtoken$`,
  'u',
);

/** The exact, complete query component. */
const REQUIRED_QUERY = 'api-version=2.0';

/**
 * A typed acquisition failure. Its message never carries a credential byte.
 */
export class PagesOidcError extends Error {
  /**
   * @param {string} code the stable machine code
   * @param {string} detail the credential-free detail
   */
  constructor(code, detail) {
    super(`${code}: ${detail}`);
    this.name = 'PagesOidcError';
    /** @type {string} */
    this.code = code;
  }
}

/**
 * Refuse a path segment that is a dot segment. The grammar already excludes
 * `/`, percent escapes and empty segments; `.` and `..` match the character
 * class but are forbidden.
 *
 * @param {string} requestTarget the validated request target
 * @returns {boolean} whether every segment is a real segment
 */
function hasNoDotSegment(requestTarget) {
  return !(requestTarget.split('?')[0] ?? '')
    .split('/')
    .some((segment) => segment === '.' || segment === '..');
}

/**
 * Validate `ACTIONS_ID_TOKEN_REQUEST_URL` completely, before any credential
 * is read.
 *
 * @param {string | undefined} rawUrl the raw environment value
 * @returns {{origin: string, host: string, requestTarget: string}} the
 *   validated, catalog-admitted request coordinates
 */
export function validateTokenRequestUrl(rawUrl) {
  if (typeof rawUrl !== 'string' || rawUrl === '') {
    throw new PagesOidcError(
      'PAGES_OIDC_UNAVAILABLE',
      'ACTIONS_ID_TOKEN_REQUEST_URL is unset or empty; this job does not hold id-token: write',
    );
  }
  if (Buffer.byteLength(rawUrl, 'utf8') > MAXIMUM_SOURCE_URL_BYTES) {
    throw new PagesOidcError(
      'PAGES_OIDC_SOURCE_URL_TOO_LONG',
      `the source URL exceeds the ${MAXIMUM_SOURCE_URL_BYTES}-byte ceiling`,
    );
  }
  if (!/^[\x20-\x7e]*$/u.test(rawUrl)) {
    throw new PagesOidcError(
      'PAGES_OIDC_SOURCE_URL_INVALID',
      'the source URL contains non-ASCII or control bytes',
    );
  }

  /** @type {URL} */
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new PagesOidcError(
      'PAGES_OIDC_SOURCE_URL_INVALID',
      'the source URL does not parse',
    );
  }
  if (parsed.protocol !== 'https:') {
    throw new PagesOidcError(
      'PAGES_OIDC_SOURCE_URL_INVALID',
      'the source URL scheme is not the exact lowercase bytes "https"',
    );
  }
  if (parsed.username !== '' || parsed.password !== '') {
    throw new PagesOidcError(
      'PAGES_OIDC_SOURCE_URL_INVALID',
      'the source URL carries userinfo',
    );
  }
  if (parsed.port !== '') {
    throw new PagesOidcError(
      'PAGES_OIDC_SOURCE_URL_INVALID',
      'the source URL carries a port',
    );
  }
  if (parsed.hash !== '') {
    throw new PagesOidcError(
      'PAGES_OIDC_SOURCE_URL_INVALID',
      'the source URL carries a fragment',
    );
  }
  // `URL` lowercases an ASCII host and punycodes a Unicode one, so compare
  // against the raw authority bytes rather than the normalized host: an
  // uppercase or Unicode authority must reject, not be silently repaired.
  const rawAuthority = rawUrl.slice('https://'.length).split(/[/?#]/u)[0] ?? '';
  if (rawAuthority !== parsed.hostname) {
    throw new PagesOidcError(
      'PAGES_OIDC_SOURCE_URL_INVALID',
      'the source URL authority is not exact lowercase ASCII',
    );
  }

  const origin = `https://${parsed.hostname}`;
  if (!GITHUB_ACTIONS_OIDC_ORIGIN_CATALOG.includes(origin)) {
    throw new PagesOidcError(
      'PAGES_OIDC_ORIGIN_UNCATALOGED',
      `${JSON.stringify(origin)} is not an exact member of the closed githubActionsOidcOriginCatalog`,
    );
  }

  if (parsed.search.slice(1) !== REQUIRED_QUERY) {
    throw new PagesOidcError(
      'PAGES_OIDC_SOURCE_URL_INVALID',
      `the query component must be exactly ${JSON.stringify(REQUIRED_QUERY)}; an audience, extra, reordered or repeated parameter is refused`,
    );
  }
  if (
    !REQUEST_TARGET_PATTERN.test(parsed.pathname) ||
    !hasNoDotSegment(parsed.pathname)
  ) {
    throw new PagesOidcError(
      'PAGES_OIDC_SOURCE_URL_INVALID',
      'the request-target path does not match the exact closed grammar',
    );
  }

  return {
    origin,
    host: parsed.hostname,
    requestTarget: `${parsed.pathname}?${REQUIRED_QUERY}`,
  };
}

/**
 * Validate the runner bearer without ever emitting it.
 *
 * @param {string | undefined} rawToken the raw environment value
 * @returns {string} the accepted bearer
 */
function requireRunnerBearer(rawToken) {
  if (typeof rawToken !== 'string' || rawToken === '') {
    throw new PagesOidcError(
      'PAGES_OIDC_UNAVAILABLE',
      'ACTIONS_ID_TOKEN_REQUEST_TOKEN is unset or empty; this job does not hold id-token: write',
    );
  }
  if (
    Buffer.byteLength(rawToken, 'utf8') > MAXIMUM_RUNNER_BEARER_BYTES ||
    !/^[\x21-\x7e]+$/u.test(rawToken)
  ) {
    throw new PagesOidcError(
      'PAGES_OIDC_RUNNER_BEARER_INVALID',
      `the runner bearer must be 1..${MAXIMUM_RUNNER_BEARER_BYTES} visible ASCII bytes with no whitespace or control character`,
    );
  }
  return rawToken;
}

/**
 * Acquire the one `gala-pages-oidc-v2` token.
 *
 * @param {{
 *   env?: Record<string, string | undefined>,
 *   fetch?: typeof globalThis.fetch
 * }} [options] injection points so a test drives the exact same code path
 * @returns {Promise<{token: string, pagesOidcOrigin: string}>} the token and
 *   the non-secret credential-egress evidence value
 */
export async function acquirePagesOidcToken(options = {}) {
  const env = options.env ?? process.env;
  // Catalog membership is established before the bearer is read.
  const target = validateTokenRequestUrl(env.ACTIONS_ID_TOKEN_REQUEST_URL);
  const bearer = requireRunnerBearer(env.ACTIONS_ID_TOKEN_REQUEST_TOKEN);

  const doFetch = options.fetch ?? globalThis.fetch;
  const response = await doFetch(`${target.origin}${target.requestTarget}`, {
    method: 'GET',
    headers: {
      host: target.host,
      accept: 'application/json',
      'accept-encoding': 'identity',
      connection: 'close',
      authorization: `Bearer ${bearer}`,
    },
    redirect: 'error',
  });

  if (response.status !== 200) {
    throw new PagesOidcError(
      'PAGES_OIDC_REQUEST_REJECTED',
      `the token endpoint answered HTTP ${response.status}`,
    );
  }
  const mediaType = (
    (response.headers.get('content-type') ?? '').split(';')[0] ?? ''
  )
    .trim()
    .toLowerCase();
  if (mediaType !== 'application/json') {
    throw new PagesOidcError(
      'PAGES_OIDC_RESPONSE_INVALID',
      `the token endpoint answered media type ${JSON.stringify(mediaType)}`,
    );
  }
  const raw = Buffer.from(await response.arrayBuffer());
  if (raw.byteLength > MAXIMUM_TOKEN_RESPONSE_BYTES) {
    throw new PagesOidcError(
      'PAGES_OIDC_RESPONSE_TOO_LARGE',
      `${raw.byteLength} bytes exceed the ${MAXIMUM_TOKEN_RESPONSE_BYTES}-byte ceiling`,
    );
  }

  /** @type {unknown} */
  let body;
  try {
    body = JSON.parse(raw.toString('utf8'));
  } catch {
    throw new PagesOidcError(
      'PAGES_OIDC_RESPONSE_INVALID',
      'the token endpoint body is not parseable JSON',
    );
  }
  if (
    body === null ||
    typeof body !== 'object' ||
    Array.isArray(body) ||
    Object.keys(body).length !== 1 ||
    typeof (/** @type {Record<string, unknown>} */ (body).value) !== 'string'
  ) {
    throw new PagesOidcError(
      'PAGES_OIDC_RESPONSE_INVALID',
      'the token endpoint body must contain exactly one "value" string member and no other member',
    );
  }
  const token = String(/** @type {Record<string, unknown>} */ (body).value);
  if (
    token === '' ||
    Buffer.byteLength(token, 'utf8') > MAXIMUM_OIDC_TOKEN_BYTES
  ) {
    throw new PagesOidcError(
      'PAGES_OIDC_RESPONSE_INVALID',
      `the returned token must be 1..${MAXIMUM_OIDC_TOKEN_BYTES} bytes`,
    );
  }

  // Only the normalized origin is non-secret credential-egress evidence.
  // The token itself is returned to the immediate caller and never logged,
  // written, digested or placed in any evidence record here.
  return { token, pagesOidcOrigin: target.origin };
}
