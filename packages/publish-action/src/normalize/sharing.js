/**
 * Resolve the build input's `sharing` member (One sharing list round).
 *
 * The platform publishes its sharing catalogue at
 * `GET <apiOrigin>/v2/public/sharing` (no auth). The site's own
 * `publication.sharing.targets` is intersected with the catalogue's
 * `networks` (order kept); a site without the member gets `defaults`. When
 * the document cannot be fetched or is malformed, the site's own targets are
 * kept as authored (else `['copy-link']`) and a `SHARING_DEFAULTS_UNAVAILABLE`
 * warning is raised, so a platform outage never blocks a publish.
 *
 * @module
 */

/** Every share target the toolchain knows, in display order. */
export const SHARING_NETWORKS = Object.freeze([
  'copy-link',
  'native',
  'x',
  'bluesky',
  'threads',
  'linkedin',
  'facebook',
  'hacker-news',
  'reddit',
  'whatsapp',
  'telegram',
  'email',
]);

export const SHARING_TIMEOUT_MS = 5000;
const FALLBACK_TARGETS = Object.freeze(['copy-link']);

/**
 * @param {unknown} value candidate
 * @returns {value is string[]} true for an array of strings
 */
function isStringArray(value) {
  return (
    Array.isArray(value) && value.every((item) => typeof item === 'string')
  );
}

/**
 * Validate the public sharing document's shape.
 *
 * @param {unknown} doc parsed JSON
 * @returns {{networks: string[], defaults: string[], reddit?: {community: string}, x?: {via: string}} | null}
 *   the document, or `null` when the shape is wrong
 */
export function parseSharingDocument(doc) {
  if (typeof doc !== 'object' || doc === null || Array.isArray(doc)) {
    return null;
  }
  const d = /** @type {Record<string, any>} */ (doc);
  if (!isStringArray(d.networks) || !isStringArray(d.defaults)) {
    return null;
  }
  if (d.reddit !== undefined) {
    if (
      typeof d.reddit !== 'object' ||
      d.reddit === null ||
      (d.reddit.community !== undefined &&
        typeof d.reddit.community !== 'string')
    ) {
      return null;
    }
  }
  if (d.x !== undefined) {
    if (
      typeof d.x !== 'object' ||
      d.x === null ||
      (d.x.via !== undefined && typeof d.x.via !== 'string')
    ) {
      return null;
    }
  }
  return /** @type {any} */ (d);
}

/**
 * One GET with a timeout.
 *
 * @param {typeof fetch} fetchImpl fetch implementation
 * @param {string} url the document URL
 * @param {number} timeoutMs abort after this many milliseconds
 * @returns {Promise<unknown>} parsed JSON
 */
async function fetchOnce(fetchImpl, url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * @param {string} detail what went wrong
 * @param {string} url the document URL
 * @returns {import('../types.js').PublishActionFinding} the warning
 */
function unavailableWarning(detail, url) {
  return {
    code: 'SHARING_DEFAULTS_UNAVAILABLE',
    severity: 'WARNING',
    detail: `The platform sharing list could not be used (${detail}); the site's own share targets were kept, or copy-link when it has none.`,
    location: url,
    evidence: { url },
    recovery:
      'Nothing to do; the next publish picks up the platform sharing list again.',
    overridable: false,
  };
}

/**
 * Resolve the build input's `sharing` member.
 *
 * @param {object} options options
 * @param {string} options.apiOrigin API origin (the interactions module's, or the default)
 * @param {readonly string[] | undefined} options.siteTargets `publication.sharing.targets`, when the site has the member
 * @param {import('../types.js').PublishActionFinding[]} options.warnings receives the non-blocking finding
 * @param {typeof fetch} [options.fetchImpl] injected fetch
 * @param {number} [options.timeoutMs] per-attempt timeout
 * @returns {Promise<{targets: string[], reddit?: {community: string}, x?: {via: string}}>} the resolved member
 */
export async function resolveSharing({
  apiOrigin,
  siteTargets,
  warnings,
  fetchImpl = globalThis.fetch,
  timeoutMs = SHARING_TIMEOUT_MS,
}) {
  const url = `${apiOrigin}/v2/public/sharing`;
  let document = null;
  let failure = 'unknown failure';
  for (let attempt = 0; attempt < 2 && document === null; attempt += 1) {
    try {
      const parsed = parseSharingDocument(
        await fetchOnce(fetchImpl, url, timeoutMs),
      );
      if (parsed === null) {
        failure = 'unexpected document shape';
        break;
      }
      document = parsed;
    } catch (error) {
      failure = error instanceof Error ? error.message : String(error);
    }
  }
  if (document === null) {
    warnings.push(unavailableWarning(failure, url));
    return {
      targets: siteTargets ? [...siteTargets] : [...FALLBACK_TARGETS],
    };
  }
  const catalogue = new Set(document.networks);
  const targets = siteTargets
    ? siteTargets.filter((target) => catalogue.has(target))
    : [...document.defaults];
  return {
    targets,
    ...(document.reddit?.community
      ? { reddit: { community: document.reddit.community } }
      : {}),
    ...(document.x?.via ? { x: { via: document.x.via } } : {}),
  };
}
