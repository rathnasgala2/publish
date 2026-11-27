/**
 * Preloaded by `npm test` (`node --import`): answers the platform sharing
 * document locally so no test reaches the network for it. Every other URL
 * passes through to the real `fetch` only when it targets a loopback host; any
 * other host throws, so no test depends on a live service. Test files import
 * this module (it is idempotent), so running one file directly is safe too.
 *
 * @module
 */

const realFetch = globalThis.fetch;
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);

globalThis.fetch = /** @type {typeof fetch} */ (
  async (input, init) => {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof Request
          ? input.url
          : String(input);
    if (url.endsWith('/v2/public/sharing')) {
      return new Response(
        JSON.stringify({
          networks: [
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
          ],
          defaults: ['copy-link', 'x', 'bluesky', 'threads'],
          reddit: { community: 'Galascribe' },
          x: { via: 'galascribe' },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }
    if (!LOOPBACK.has(new URL(url).hostname)) {
      throw new Error(`test attempted a non-loopback fetch: ${url}`);
    }
    return realFetch(input, init);
  }
);
