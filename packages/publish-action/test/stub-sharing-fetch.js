/**
 * Preloaded by `npm test` (`node --import`): answers the platform sharing
 * document locally (without `threads` until the schemas pin accepts it) so no test reaches the network for it. Every other URL
 * passes through to the real `fetch`.
 *
 * @module
 */

const realFetch = globalThis.fetch;

globalThis.fetch = /** @type {typeof fetch} */ (
  async (input, init) => {
    const url = typeof input === 'string' ? input : String(input);
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
          defaults: ['copy-link', 'x', 'bluesky'],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }
    return realFetch(input, init);
  }
);
