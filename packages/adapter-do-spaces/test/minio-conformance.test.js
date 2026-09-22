/**
 * Run the identical Spaces conformance fixture against a real, throwaway
 * S3-compatible server.
 *
 * This is the strongest local evidence available for this adapter without
 * DigitalOcean credentials (W4-16 owns the live disposable-bucket run). The
 * adapter constructs and signs the canonical
 * `https://<bucket>.nyc3.digitaloceanspaces.com` request line and `host`
 * header exactly as it would in production; only the TCP hop is redirected
 * to the container, whose `MINIO_DOMAIN` is set to
 * `nyc3.digitaloceanspaces.com` so it resolves those virtual-host-style
 * requests, and whose `MINIO_REGION` is `nyc3` so it validates the SigV4
 * scope. Every signature is verified by MinIO, which shares no code with
 * this repository.
 *
 * It is opt-in because `npm test` must pass on a machine with no container
 * runtime: set `SPACES_MINIO_ENDPOINT` (and, when they differ from the
 * defaults below, `SPACES_MINIO_ACCESS_KEY_ID` /
 * `SPACES_MINIO_SECRET_ACCESS_KEY`) to enable it. `scripts/minio-spaces.sh`
 * starts and removes a container pinned to the digest in
 * `infra/release/container-images.json`.
 */

import { request as httpRequest } from 'node:http';
import { test } from 'node:test';

import { runAdapterConformanceSuite } from '@rathnasgala2/adapter-conformance-kit';

import {
  canonicalQuery,
  canonicalUriForKey,
  payloadHash,
  signRequest,
} from '../src/sigv4.js';
import { buildSpacesFixture } from './spaces-fixture.js';

const ENDPOINT = process.env.SPACES_MINIO_ENDPOINT;
const ACCESS_KEY_ID = process.env.SPACES_MINIO_ACCESS_KEY_ID ?? 'galas4testkey';
const SECRET_ACCESS_KEY =
  process.env.SPACES_MINIO_SECRET_ACCESS_KEY ?? 'galas4testsecret0123456789';
const REGION = 'nyc3';

/**
 * Build a `fetch` that keeps the canonical Spaces request line and `host`
 * header and only redirects the TCP hop to the throwaway container.
 *
 * It is written on `node:http` rather than on `globalThis.fetch` for one
 * specific reason: `Host` is a forbidden header name in the fetch standard,
 * so a `fetch`-based forwarder silently rewrites it to the container's own
 * address — and MinIO, like Spaces, resolves the bucket and validates the
 * SigV4 signature from the `Host` header it receives. Preserving the signed
 * host verbatim is exactly what makes this an honest test of the real
 * virtual-host-style request.
 *
 * @param {string} endpoint the container's `http://host:port` endpoint
 * @returns {typeof globalThis.fetch} the forwarding fetch
 */
function forwardingFetch(endpoint) {
  const target = new URL(endpoint);
  /**
   * @param {string | URL | Request} input the request target
   * @param {RequestInit} [init] the request init
   * @returns {Promise<Response>} the response
   */
  const forward = async (input, init = {}) => {
    const url = new URL(String(input));
    // MinIO has no separate static-website endpoint, so the one host this
    // harness rewrites is the `<bucket>.<region>-static...` website origin,
    // mapped onto the same bucket's ordinary virtual-host address. The
    // request is still anonymous and credential-free, which is the property
    // the public-verification path is being tested for.
    /** @type {Record<string, string>} */
    const headers = {
      host: url.host.replace(`.${REGION}-static.`, `.${REGION}.`),
    };
    new Headers(/** @type {HeadersInit} */ (init.headers ?? {})).forEach(
      (value, name) => {
        headers[name] = value;
      },
    );
    /** @type {Buffer | undefined} */
    let body;
    if (init.body !== undefined && init.body !== null) {
      body = Buffer.isBuffer(init.body)
        ? init.body
        : Buffer.from(String(init.body), 'utf8');
    }

    return new Promise((resolve, reject) => {
      const request = httpRequest(
        {
          hostname: target.hostname,
          port: target.port,
          method: init.method ?? 'GET',
          path: `${url.pathname}${url.search}`,
          headers: {
            ...headers,
            ...(body === undefined
              ? {}
              : { 'content-length': String(body.byteLength) }),
          },
        },
        (response) => {
          /** @type {Buffer[]} */
          const chunks = [];
          response.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
          response.on('end', () => {
            /** @type {Record<string, string>} */
            const responseHeaders = {};
            for (const [name, value] of Object.entries(response.headers)) {
              if (typeof value === 'string') {
                responseHeaders[name] = value;
              }
            }
            const status = response.statusCode ?? 0;
            resolve(
              new Response(
                status === 204 || status === 304 ? null : Buffer.concat(chunks),
                { status, headers: responseHeaders },
              ),
            );
          });
        },
      );
      request.on('error', reject);
      if (body !== undefined) {
        request.write(body);
      }
      request.end();
    });
  };
  return /** @type {typeof globalThis.fetch} */ (forward);
}

/**
 * @typedef {Readonly<{
 *   host: string,
 *   origin: string,
 *   fetch: typeof globalThis.fetch
 * }>} FixtureClient
 */

/**
 * @param {string} bucket the bucket name
 * @param {typeof globalThis.fetch} boundFetch the forwarding fetch
 * @returns {FixtureClient} a root-credential fixture client
 */
function rootClient(bucket, boundFetch) {
  const host = `${bucket}.${REGION}.digitaloceanspaces.com`;
  return Object.freeze({ host, origin: `https://${host}`, fetch: boundFetch });
}

/**
 * Issue one signed request *outside* the adapter's request catalog.
 *
 * Creating a bucket, making it anonymously readable and deleting it are
 * control-plane acts, and `gala-do-spaces-sigv4-v2` deliberately declares no
 * row for any of them: the adapter is never permitted to perform them, so it
 * must not be able to. This fixture therefore signs them itself, with the
 * throwaway container's root credential, exactly as a human operator or the
 * separate configuration job would — which is also why the adapter's own
 * `send` is not reachable from here.
 *
 * @param {FixtureClient} client the fixture client
 * @param {{
 *   method: string,
 *   key: string,
 *   query?: Readonly<Record<string, string>>,
 *   headers?: Readonly<Record<string, string>>,
 *   body?: Buffer
 * }} request the control-plane request
 * @returns {Promise<{status: number, bytes: Buffer}>} the response
 */
async function fixtureSend(client, request) {
  const query = request.query ?? {};
  const signed = signRequest(
    {
      method: request.method,
      host: client.host,
      key: request.key,
      query,
      ...(request.headers === undefined ? {} : { headers: request.headers }),
      payloadSha256: payloadHash(request.body),
    },
    {
      accessKeyId: ACCESS_KEY_ID,
      secretAccessKey: SECRET_ACCESS_KEY,
      region: REGION,
    },
  );
  const canonical = canonicalQuery(query);
  const response = await client.fetch(
    `${client.origin}${canonicalUriForKey(request.key)}${canonical === '' ? '' : `?${canonical}`}`,
    {
      method: request.method,
      headers: /** @type {Record<string, string>} */ ({ ...signed }),
      redirect: 'error',
      ...(request.body === undefined
        ? {}
        : { body: /** @type {BodyInit} */ (request.body) }),
    },
  );
  return {
    status: response.status,
    bytes: Buffer.from(await response.arrayBuffer()),
  };
}

/**
 * Delete every object in a bucket and then the bucket itself.
 *
 * @param {FixtureClient} client the fixture client
 * @returns {Promise<void>} resolves once the bucket is gone
 */
async function dropBucket(client) {
  const listing = await fixtureSend(client, {
    method: 'GET',
    key: '',
    query: { 'list-type': '2', 'max-keys': '1000' },
  });
  for (const match of listing.bytes
    .toString('utf8')
    .matchAll(/<Key>([\s\S]*?)<\/Key>/gu)) {
    await fixtureSend(client, { method: 'DELETE', key: String(match[1]) });
  }
  await fixtureSend(client, { method: 'DELETE', key: '' });
}

if (ENDPOINT === undefined) {
  test(
    'do-spaces conformance against a throwaway MinIO server',
    { skip: 'SPACES_MINIO_ENDPOINT is not set' },
    () => {},
  );
} else {
  const boundFetch = forwardingFetch(ENDPOINT);
  let sequence = 0;
  runAdapterConformanceSuite(
    buildSpacesFixture(async () => {
      sequence += 1;
      const stamp = `${Date.now().toString(36)}-${sequence}`;
      const servedBucket = `gala-served-minio-${stamp}`;
      const stagingBucket = `gala-staging-minio-${stamp}`;
      const served = rootClient(servedBucket, boundFetch);
      const staging = rootClient(stagingBucket, boundFetch);

      await fixtureSend(served, { method: 'PUT', key: '' });
      await fixtureSend(staging, { method: 'PUT', key: '' });
      // Anonymous read on the served bucket only: that is what a Spaces
      // website origin is, and it is a control-plane act the adapter itself
      // is never permitted to perform.
      const policyWrite = await fixtureSend(served, {
        method: 'PUT',
        key: '',
        query: { policy: '' },
        headers: { 'content-type': 'application/json' },
        body: Buffer.from(
          JSON.stringify({
            Version: '2012-10-17',
            Statement: [
              {
                Effect: 'Allow',
                Principal: { AWS: ['*'] },
                Action: ['s3:GetObject'],
                Resource: [`arn:aws:s3:::${servedBucket}/*`],
              },
            ],
          }),
          'utf8',
        ),
      });
      if (policyWrite.status !== 204 && policyWrite.status !== 200) {
        throw new Error(
          `minio fixture: could not make ${servedBucket} anonymously readable (HTTP ${policyWrite.status})`,
        );
      }

      return {
        region: REGION,
        servedBucket,
        stagingBucket,
        accessKeyId: ACCESS_KEY_ID,
        secretAccessKey: SECRET_ACCESS_KEY,
        fetch: boundFetch,
        /**
         * Overwrite one served object out of band, through the same real
         * server, so `observe` has a genuine tamper to detect.
         *
         * @param {string} key the served object key
         * @returns {Promise<void>} resolves once the object is rewritten
         */
        async tamper(key) {
          const current = await fixtureSend(served, { method: 'GET', key });
          const mutated = Buffer.from(current.bytes);
          mutated.writeUInt8((mutated.readUInt8(0) + 1) % 256, 0);
          await fixtureSend(served, { method: 'PUT', key, body: mutated });
        },
        /**
         * @returns {Promise<void>} resolves once both buckets are removed
         */
        async stop() {
          await dropBucket(served);
          await dropBucket(staging);
        },
      };
    }, 'minio'),
  );
}
