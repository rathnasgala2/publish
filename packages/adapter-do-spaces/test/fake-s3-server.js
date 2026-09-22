/**
 * A local S3-compatible fake for this package's always-on tests.
 *
 * It is a real `node:http` server: the adapter constructs and signs the
 * canonical `https://<bucket>.<region>.digitaloceanspaces.com` request line
 * and `host` header exactly as it would against DigitalOcean, and only the
 * TCP hop is redirected here. It implements the subset of the S3 API this
 * adapter's request catalog declares — PUT/GET/HEAD/DELETE object,
 * `ListObjectsV2` with continuation, the four multipart calls, `If-Match`
 * and `If-None-Match` on the pointer object — plus a separate public
 * website origin for the served bucket.
 *
 * It verifies every request's SigV4 signature. That check is not itself
 * proof the signer is correct (it uses the same module), which is why the
 * signer is separately replayed against the published AWS test-suite vector
 * in `sigv4.test.js` and against a real MinIO server in
 * `minio-conformance.test.js`.
 */

import { createServer } from 'node:http';

import { computeSignature } from '../src/sigv4.js';

/**
 * Start one isolated fake Spaces provider.
 *
 * @param {{
 *   region?: string,
 *   servedBucket?: string,
 *   stagingBucket?: string,
 *   accessKeyId?: string,
 *   secretAccessKey?: string,
 *   websiteResponse?: (bucket: string) => {status: number, body: string}
 * }} [options] optional overrides; `websiteResponse` answers the
 *   control-plane `GET /?website=` row per bucket, defaulting to the
 *   403 `AccessDenied` a correctly limited deployment key must receive
 * @returns {Promise<Record<string, any>>} the started provider
 */
export async function startFakeSpaces(options = {}) {
  const region = options.region ?? 'nyc3';
  const servedBucket = options.servedBucket ?? 'gala-served-disposable';
  const stagingBucket = options.stagingBucket ?? 'gala-staging-disposable';
  const accessKeyId = options.accessKeyId ?? 'DO00FAKEACCESSKEYID';
  const secretAccessKey = options.secretAccessKey ?? 'fake-secret-access-key';
  const websiteResponse =
    options.websiteResponse ??
    (() => ({
      status: 403,
      body: '<?xml version="1.0"?><Error><Code>AccessDenied</Code><Message>Access Denied.</Message></Error>',
    }));

  /** @type {Map<string, Map<string, {bytes: Buffer, headers: Record<string, string>, etag: string}>>} */
  const buckets = new Map([
    [servedBucket, new Map()],
    [stagingBucket, new Map()],
  ]);
  /** @type {Map<string, {bucket: string, key: string, parts: Map<number, Buffer>}>} */
  const uploads = new Map();
  let uploadSequence = 0;
  let etagSequence = 0;

  const server = createServer((request, response) => {
    void handle(request, response);
  });

  /**
   * @param {import('node:http').IncomingMessage} request the request
   * @returns {Promise<Buffer>} the complete request body
   */
  async function readBody(request) {
    /** @type {Buffer[]} */
    const chunks = [];
    for await (const chunk of request) {
      chunks.push(Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }

  /**
   * @param {import('node:http').ServerResponse} response the response
   * @param {number} status the status
   * @param {string} code the S3 error code
   * @returns {void}
   */
  function error(response, status, code) {
    const body = Buffer.from(
      `<?xml version="1.0"?><Error><Code>${code}</Code></Error>`,
      'utf8',
    );
    response.writeHead(status, {
      'content-type': 'application/xml',
      'content-length': String(body.byteLength),
    });
    response.end(body);
  }

  /**
   * Verify the request's SigV4 signature exactly the way S3 does: parse the
   * header names out of the presented `Authorization`, take those values as
   * they actually arrived, and recompute. A header the client added or
   * rewrote outside that list therefore cannot break a valid signature, and
   * a forged value inside it cannot pass.
   *
   * @param {import('node:http').IncomingMessage} request the request
   * @param {string} host the original signed host
   * @param {string} key the object key
   * @param {Readonly<Record<string, string>>} query the query parameters
   * @returns {boolean} whether the signature verifies
   */
  function signatureVerifies(request, host, key, query) {
    const presented = String(request.headers.authorization ?? '');
    const amzDate = String(request.headers['x-amz-date'] ?? '');
    const contentSha = String(request.headers['x-amz-content-sha256'] ?? '');
    const signedHeaderNames =
      presented.match(/SignedHeaders=([^,]+)/u)?.[1]?.split(';') ?? [];
    if (presented === '' || amzDate === '' || contentSha === '') {
      return false;
    }

    /** @type {Record<string, string>} */
    const headers = { host };
    for (const name of signedHeaderNames) {
      if (name === 'host') {
        continue;
      }
      headers[name] = String(request.headers[name] ?? '');
    }

    const { signature, scope, signedHeaders } = computeSignature(
      {
        method: String(request.method),
        key,
        query,
        headers,
        signedHeaderNames,
        payloadSha256: contentSha,
        amzDate,
        dateStamp: amzDate.slice(0, 8),
      },
      {
        accessKeyId,
        secretAccessKey,
        region,
        ...(request.headers['x-amz-security-token'] === undefined
          ? {}
          : { sessionToken: String(request.headers['x-amz-security-token']) }),
      },
    );
    return (
      presented ===
      `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`
    );
  }

  /**
   * @param {import('node:http').IncomingMessage} request the request
   * @param {import('node:http').ServerResponse} response the response
   * @returns {Promise<void>} resolves once the response has been written
   */
  async function handle(request, response) {
    const host = String(request.headers['x-fake-host'] ?? '');
    const body = await readBody(request);
    const parsed = new URL(`http://placeholder${request.url ?? '/'}`);
    const key = decodeURIComponent(parsed.pathname.slice(1));
    /** @type {Record<string, string>} */
    const query = {};
    for (const [name, value] of parsed.searchParams) {
      query[name] = value;
    }

    if (host === `${servedBucket}.${region}-static.digitaloceanspaces.com`) {
      servePublic(response, key);
      return;
    }
    const bucket = host.endsWith(`.${region}.digitaloceanspaces.com`)
      ? host.slice(0, host.indexOf('.'))
      : '';
    const store = buckets.get(bucket);
    if (store === undefined) {
      error(response, 404, 'NoSuchBucket');
      return;
    }
    if (!signatureVerifies(request, host, key, query)) {
      error(response, 403, 'SignatureDoesNotMatch');
      return;
    }
    respondApi(request, response, store, key, query, body, bucket);
  }

  /**
   * @param {import('node:http').ServerResponse} response the response
   * @param {string} key the requested public key
   * @returns {void}
   */
  function servePublic(response, key) {
    const object = buckets.get(servedBucket)?.get(key);
    if (object === undefined) {
      response.writeHead(404);
      response.end();
      return;
    }
    response.writeHead(200, {
      'content-type':
        object.headers['content-type'] ?? 'application/octet-stream',
      'content-length': String(object.bytes.byteLength),
      etag: `"${object.etag}"`,
    });
    response.end(object.bytes);
  }

  /**
   * @param {import('node:http').IncomingMessage} request the request
   * @param {import('node:http').ServerResponse} response the response
   * @param {Map<string, {bytes: Buffer, headers: Record<string, string>, etag: string}>} store the bucket
   * @param {string} key the object key
   * @param {Readonly<Record<string, string>>} query the query parameters
   * @param {Buffer} body the request body
   * @param {string} bucket the bucket name
   * @returns {void}
   */
  function respondApi(request, response, store, key, query, body, bucket) {
    const method = String(request.method);

    if (method === 'GET' && 'website' in query) {
      const answer = websiteResponse(bucket);
      writeXml(response, answer.status, answer.body);
      return;
    }
    if (method === 'GET' && query['list-type'] === '2') {
      listObjects(response, store, query);
      return;
    }
    if (method === 'POST' && 'uploads' in query) {
      uploadSequence += 1;
      const uploadId = `upload-${uploadSequence}`;
      uploads.set(uploadId, { bucket, key, parts: new Map() });
      const xml = `<?xml version="1.0"?><InitiateMultipartUploadResult><UploadId>${uploadId}</UploadId></InitiateMultipartUploadResult>`;
      writeXml(response, 200, xml);
      return;
    }
    if (method === 'PUT' && query.uploadId !== undefined) {
      const upload = uploads.get(query.uploadId);
      if (upload === undefined) {
        error(response, 404, 'NoSuchUpload');
        return;
      }
      upload.parts.set(Number.parseInt(String(query.partNumber), 10), body);
      etagSequence += 1;
      response.writeHead(200, { etag: `"part-${etagSequence}"` });
      response.end();
      return;
    }
    if (method === 'POST' && query.uploadId !== undefined) {
      const upload = uploads.get(query.uploadId);
      if (upload === undefined) {
        error(response, 404, 'NoSuchUpload');
        return;
      }
      const assembled = Buffer.concat(
        [...upload.parts.keys()]
          .sort((left, right) => left - right)
          .map((part) => /** @type {Buffer} */ (upload.parts.get(part))),
      );
      etagSequence += 1;
      store.set(upload.key, {
        bytes: assembled,
        headers: {},
        etag: `multipart-${etagSequence}`,
      });
      uploads.delete(String(query.uploadId));
      writeXml(
        response,
        200,
        `<?xml version="1.0"?><CompleteMultipartUploadResult><ETag>"multipart-${etagSequence}"</ETag></CompleteMultipartUploadResult>`,
      );
      return;
    }
    if (method === 'DELETE' && query.uploadId !== undefined) {
      uploads.delete(String(query.uploadId));
      response.writeHead(204);
      response.end();
      return;
    }
    if (method === 'PUT') {
      const existing = store.get(key);
      const ifMatch = request.headers['if-match'];
      const ifNoneMatch = request.headers['if-none-match'];
      if (ifNoneMatch === '*' && existing !== undefined) {
        error(response, 412, 'PreconditionFailed');
        return;
      }
      if (
        ifMatch !== undefined &&
        (existing === undefined ||
          String(ifMatch).replaceAll('"', '') !== existing.etag)
      ) {
        error(response, 412, 'PreconditionFailed');
        return;
      }
      etagSequence += 1;
      const etag = `object-${etagSequence}`;
      /** @type {Record<string, string>} */
      const headers = {};
      for (const name of [
        'content-type',
        'cache-control',
        'x-amz-meta-gala-sha256',
      ]) {
        const value = request.headers[name];
        if (value !== undefined) {
          headers[name] = String(value);
        }
      }
      store.set(key, { bytes: body, headers, etag });
      response.writeHead(200, { etag: `"${etag}"` });
      response.end();
      return;
    }
    if (method === 'GET' || method === 'HEAD') {
      const object = store.get(key);
      if (object === undefined) {
        error(response, 404, 'NoSuchKey');
        return;
      }
      response.writeHead(200, {
        ...object.headers,
        'content-length': String(object.bytes.byteLength),
        etag: `"${object.etag}"`,
      });
      response.end(method === 'HEAD' ? undefined : object.bytes);
      return;
    }
    if (method === 'DELETE') {
      store.delete(key);
      response.writeHead(204);
      response.end();
      return;
    }
    error(response, 405, 'MethodNotAllowed');
  }

  /**
   * @param {import('node:http').ServerResponse} response the response
   * @param {number} status the status
   * @param {string} xml the XML body
   * @returns {void}
   */
  function writeXml(response, status, xml) {
    const bytes = Buffer.from(xml, 'utf8');
    response.writeHead(status, {
      'content-type': 'application/xml',
      'content-length': String(bytes.byteLength),
    });
    response.end(bytes);
  }

  /**
   * @param {import('node:http').ServerResponse} response the response
   * @param {Map<string, {bytes: Buffer, headers: Record<string, string>, etag: string}>} store the bucket
   * @param {Readonly<Record<string, string>>} query the query parameters
   * @returns {void}
   */
  function listObjects(response, store, query) {
    const prefix = query.prefix ?? '';
    const maxKeys = Number.parseInt(query['max-keys'] ?? '1000', 10);
    const after = query['continuation-token'];
    const all = [...store.keys()]
      .filter((key) => key.startsWith(prefix))
      .sort();
    const start = after === undefined ? 0 : all.indexOf(after) + 1;
    const page = all.slice(start, start + maxKeys);
    const truncated = start + maxKeys < all.length;
    const contents = page
      .map((key) => {
        const object = /** @type {{bytes: Buffer, etag: string}} */ (
          store.get(key)
        );
        return `<Contents><Key>${escapeXml(key)}</Key><ETag>&quot;${object.etag}&quot;</ETag><Size>${object.bytes.byteLength}</Size></Contents>`;
      })
      .join('');
    writeXml(
      response,
      200,
      `<?xml version="1.0"?><ListBucketResult><IsTruncated>${truncated}</IsTruncated>${contents}${
        truncated
          ? `<NextContinuationToken>${escapeXml(String(page.at(-1)))}</NextContinuationToken>`
          : ''
      }</ListBucketResult>`,
    );
  }

  /**
   * @param {string} value raw text
   * @returns {string} XML-escaped text
   */
  function escapeXml(value) {
    return value
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;');
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
   * @param {string | URL | Request} input the request target
   * @param {RequestInit} [init] the request init
   * @returns {Promise<Response>} the response
   */
  const fakeFetch = (input, init = {}) => {
    const url = new URL(String(input));
    const headers = new Headers(
      /** @type {HeadersInit} */ (init.headers ?? {}),
    );
    headers.set('x-fake-host', url.hostname);
    return globalThis.fetch(`${local}${url.pathname}${url.search}`, {
      ...init,
      headers,
    });
  };

  return {
    region,
    servedBucket,
    stagingBucket,
    accessKeyId,
    secretAccessKey,
    buckets,
    fetch: /** @type {typeof globalThis.fetch} */ (fakeFetch),
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
