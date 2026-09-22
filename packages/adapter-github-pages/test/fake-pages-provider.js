/**
 * A local fake GitHub Pages provider for this package's tests.
 *
 * It is a real `node:http` server speaking real HTTP on the loopback
 * interface, not a stubbed `fetch`: the adapter builds the canonical
 * `https://api.github.com/...` request line, renders every cataloged header
 * and serialises a real JSON body, and only the transport hop is redirected
 * here (the original origin travels in `x-fake-origin`, so the server routes
 * exactly as the real split between the control plane and the public origin
 * would). The carrier the adapter produces is genuinely gunzipped and
 * untarred here before it is served, so the deterministic ustar codec is
 * exercised end to end rather than trusted.
 */

import { createServer } from 'node:http';

import { decodeCarrier } from '../src/carrier.js';

const API_ORIGIN = 'https://api.github.com';

/**
 * @typedef {{
 *   apiOrigin: string,
 *   publicBaseUrl: string,
 *   token: string,
 *   owner: string,
 *   repository: string,
 *   fetch: typeof globalThis.fetch,
 *   publishCarrier: (input: {bytes: Buffer}) => Promise<{pagesArtifactId: string}>,
 *   served: Map<string, Buffer>,
 *   deployments: Map<string, {statusIndex: number, artifactId: string}>,
 *   cancelled: string[],
 *   createCalls: {
 *     pagesBuildVersion: string,
 *     artifactId: string,
 *     oidcToken: string,
 *     bodyText: string,
 *     memberNames: string[]
 *   }[],
 *   requestLog: {method: string, target: string, headers: Record<string, string>}[],
 *   seedDeployment: (id: string, statuses: readonly string[]) => void,
 *   pagesEnabled: boolean,
 *   stop: () => Promise<void>
 * }} FakePagesProvider
 */

/**
 * Start one isolated fake provider.
 *
 * @param {{
 *   owner?: string,
 *   repository?: string,
 *   token?: string,
 *   cancelBehaviour?: 'terminal' | 'ambiguous',
 *   statusSequence?: readonly string[]
 * }} [options] optional overrides; `statusSequence` is the exact status
 *   series the deployment status endpoint returns, one per poll
 * @returns {Promise<FakePagesProvider>} the started provider
 */
export async function startFakePagesProvider(options = {}) {
  const owner = options.owner ?? 'rathnasgala2';
  const repository = options.repository ?? 'disposable-pages-target';
  const token = options.token ?? 'ghs-fake-installation-token';
  const statusSequence = options.statusSequence ?? [
    'deployment_in_progress',
    'syncing_files',
    'succeed',
  ];
  const publicBaseUrl = `https://${owner}.github.io/${repository}`;
  const publicPathPrefix = `/${repository}/`;

  /** @type {Map<string, Buffer>} */
  const artifacts = new Map();
  /** @type {Map<string, Buffer>} */
  const served = new Map();
  /** @type {Map<string, {statusIndex: number, artifactId: string, statuses?: readonly string[]}>} */
  const deployments = new Map();
  /** @type {string[]} */
  const cancelled = [];
  /** @type {any[]} */
  const createCalls = [];
  /** @type {{method: string, target: string, headers: Record<string, string>}[]} */
  const requestLog = [];
  const cancelBehaviour = options.cancelBehaviour ?? 'terminal';
  const state = { pagesEnabled: true };

  const server = createServer((request, response) => {
    void handle(request, response);
  });

  /**
   * @param {import('node:http').IncomingMessage} request the request
   * @param {import('node:http').ServerResponse} response the response
   * @returns {Promise<void>} resolves once the response has been written
   */
  async function handle(request, response) {
    const origin = String(request.headers['x-fake-origin'] ?? '');
    const target = String(request.url ?? '/');
    /** @type {Buffer[]} */
    const chunks = [];
    for await (const chunk of request) {
      chunks.push(Buffer.from(chunk));
    }
    const body = Buffer.concat(chunks);

    if (origin === API_ORIGIN) {
      respondApi(request, response, target, body);
      return;
    }
    respondPublic(response, target);
  }

  /**
   * @param {import('node:http').ServerResponse} response the response
   * @param {number} status the HTTP status
   * @param {unknown} payload a JSON payload, or `null` for an empty body
   * @returns {void}
   */
  function json(response, status, payload) {
    if (payload === null) {
      response.writeHead(status);
      response.end();
      return;
    }
    const bytes = Buffer.from(JSON.stringify(payload), 'utf8');
    response.writeHead(status, {
      'content-type': 'application/json',
      'content-length': String(bytes.byteLength),
    });
    response.end(bytes);
  }

  /**
   * @param {import('node:http').IncomingMessage} request the request
   * @param {import('node:http').ServerResponse} response the response
   * @param {string} target the request target
   * @param {Buffer} body the request body
   * @returns {void}
   */
  function respondApi(request, response, target, body) {
    requestLog.push({
      method: String(request.method),
      target,
      headers: /** @type {Record<string, string>} */ (
        JSON.parse(JSON.stringify(request.headers))
      ),
    });
    if (request.headers.authorization !== `Bearer ${token}`) {
      json(response, 401, { message: 'Bad credentials' });
      return;
    }
    const base = `/repos/${owner}/${repository}/pages`;
    if (target === base) {
      if (!state.pagesEnabled) {
        json(response, 404, { message: 'Not Found' });
        return;
      }
      json(response, 200, { url: `${API_ORIGIN}${base}`, status: 'built' });
      return;
    }
    if (target === `${base}/deployments` && request.method === 'POST') {
      const bodyText = body.toString('utf8');
      const parsed = JSON.parse(bodyText);
      const id = String(parsed.pages_build_version);
      const artifactId = String(parsed.artifact_id);
      if (typeof parsed.oidc_token !== 'string' || parsed.oidc_token === '') {
        json(response, 422, { message: 'oidc_token is required' });
        return;
      }
      if (!artifacts.has(artifactId)) {
        json(response, 422, { message: 'artifact not found' });
        return;
      }
      createCalls.push({
        pagesBuildVersion: id,
        artifactId,
        oidcToken: String(parsed.oidc_token),
        bodyText,
        memberNames: Object.keys(parsed),
      });
      if (!deployments.has(id)) {
        deployments.set(id, { statusIndex: 0, artifactId });
      }
      json(response, 200, {
        id,
        status_url: `${API_ORIGIN}${base}/deployments/${id}/status`,
        page_url: publicBaseUrl,
      });
      return;
    }
    const cancelMatch = target.match(
      new RegExp(`^${base}/deployments/([^/]+)/cancel$`, 'u'),
    );
    if (cancelMatch !== null && request.method === 'POST') {
      const cancelId = decodeURIComponent(String(cancelMatch[1]));
      cancelled.push(cancelId);
      const target_ = deployments.get(cancelId);
      if (target_ !== undefined && cancelBehaviour === 'terminal') {
        target_.statuses = ['deployment_cancelled'];
        target_.statusIndex = 0;
      }
      json(response, 204, null);
      return;
    }
    const statusMatch = target.match(
      new RegExp(`^${base}/deployments/([^/]+)$`, 'u'),
    );
    if (statusMatch !== null && request.method === 'GET') {
      const id = decodeURIComponent(String(statusMatch[1]));
      const deployment = deployments.get(id);
      if (deployment === undefined) {
        json(response, 404, { message: 'Not Found' });
        return;
      }
      const series = deployment.statuses ?? statusSequence;
      const index = Math.min(deployment.statusIndex, series.length - 1);
      const status = String(series[index]);
      deployment.statusIndex += 1;
      if (status === 'succeed') {
        materialize(deployment.artifactId);
      }
      json(response, 200, { status });
      return;
    }
    json(response, 404, { message: 'Not Found' });
  }

  /**
   * Replace the served content with one carrier's exact decoded members.
   *
   * @param {string} artifactId the artifact whose carrier is being deployed
   * @returns {void}
   */
  function materialize(artifactId) {
    const carrier = artifacts.get(artifactId);
    if (carrier === undefined) {
      return;
    }
    served.clear();
    for (const file of decodeCarrier(carrier)) {
      served.set(file.path, file.bytes);
    }
  }

  /**
   * @param {import('node:http').ServerResponse} response the response
   * @param {string} target the request target
   * @returns {void}
   */
  function respondPublic(response, target) {
    if (!target.startsWith(publicPathPrefix)) {
      response.writeHead(404);
      response.end();
      return;
    }
    const bytes = served.get(target.slice(publicPathPrefix.length));
    if (bytes === undefined) {
      response.writeHead(404);
      response.end();
      return;
    }
    response.writeHead(200, { 'content-length': String(bytes.byteLength) });
    response.end(bytes);
  }

  await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve(undefined);
    });
  });
  const address = /** @type {import('node:net').AddressInfo} */ (
    server.address()
  );
  const local = `http://127.0.0.1:${address.port}`;

  /**
   * A `fetch` that preserves the adapter's canonical request line and only
   * redirects the transport hop to this server.
   *
   * @param {string | URL | Request} input the request target
   * @param {RequestInit} [init] the request init
   * @returns {Promise<Response>} the response
   */
  const fakeFetch = (input, init = {}) => {
    const url = new URL(String(input));
    const headers = new Headers(init.headers ?? {});
    headers.set('x-fake-origin', url.origin);
    return globalThis.fetch(`${local}${url.pathname}${url.search}`, {
      ...init,
      headers,
    });
  };

  let nextArtifactId = 1;
  return {
    apiOrigin: API_ORIGIN,
    publicBaseUrl,
    token,
    owner,
    repository,
    fetch: /** @type {typeof globalThis.fetch} */ (fakeFetch),
    /**
     * The Actions-artifact publisher the workflow supplies in production.
     *
     * @param {{bytes: Buffer}} input the carrier bytes
     * @returns {Promise<{pagesArtifactId: string}>} the artifact identity
     */
    publishCarrier(input) {
      const id = String(nextArtifactId);
      nextArtifactId += 1;
      artifacts.set(id, Buffer.from(input.bytes));
      return Promise.resolve({ pagesArtifactId: id });
    },
    served,
    deployments,
    cancelled,
    createCalls,
    requestLog,
    /**
     * Seed one deployment with its own status series, so a recovery test can
     * stand a prior attempt up without going through create.
     *
     * @param {string} id the deployment identity
     * @param {readonly string[]} statuses the status series to return
     * @returns {void}
     */
    seedDeployment(id, statuses) {
      deployments.set(id, { statusIndex: 0, artifactId: 'seeded', statuses });
    },
    get pagesEnabled() {
      return state.pagesEnabled;
    },
    set pagesEnabled(value) {
      state.pagesEnabled = value;
    },
    /**
     * @returns {Promise<void>} resolves once the server has closed
     */
    stop() {
      return new Promise((resolve) => {
        server.close(() => {
          resolve(undefined);
        });
      });
    },
  };
}
