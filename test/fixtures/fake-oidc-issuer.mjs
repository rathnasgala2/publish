/**
 * A loopback stand-in for the two OIDC surfaces the workload exchange
 * depends on: the runner's own ID-token endpoint, and the issuer's JWKS.
 *
 * It is deliberately not a mock. The assertions it mints are real RS256
 * JWTs over a real generated key pair, published at a real JWKS document,
 * and `test/fixtures/fake-gala-api.mjs` verifies them the way the API does —
 * key from the JWKS and never from the token's own header, exact issuer,
 * exact audience per purpose, bounded lifetime. A test that passes here is a
 * test where the signature actually had to verify.
 *
 * @module
 */

import { createServer } from 'node:http';
import { createSign, generateKeyPairSync, randomUUID } from 'node:crypto';

/**
 * base64url without padding.
 *
 * @param {Buffer | string} value the bytes
 * @returns {string} the encoded text
 */
function base64url(value) {
  return Buffer.from(value)
    .toString('base64')
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '');
}

/**
 * Sign one compact RS256 JWT.
 *
 * @param {import('node:crypto').KeyObject} privateKey the signing key
 * @param {string} kid the key id
 * @param {Record<string, unknown>} claims the payload claims
 * @returns {string} the compact assertion
 */
export function signAssertion(privateKey, kid, claims) {
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid }));
  const payload = base64url(JSON.stringify(claims));
  const signature = createSign('RSA-SHA256')
    .update(`${header}.${payload}`)
    .sign(privateKey);
  return `${header}.${payload}.${base64url(signature)}`;
}

/**
 * The twenty-one claims DEC-097 requires, built around one bound repository
 * and publish ref. A test overrides exactly the members it is about.
 *
 * @param {{
 *   issuer: string,
 *   audience: string,
 *   repository: string,
 *   repositoryId: string,
 *   repositoryOwnerId: string,
 *   operationId: string,
 *   runId: string,
 *   runAttempt: number,
 *   sha: string,
 *   jobWorkflowRef: string,
 *   workflowRef: string,
 *   now?: number
 * }} binding the bound identity
 * @returns {Record<string, unknown>} the claim set
 */
export function boundClaims(binding) {
  const owner = binding.repository.split('/')[0];
  const ref = `refs/heads/gala/publish/${binding.operationId}`;
  const issuedAt = Math.floor((binding.now ?? Date.now()) / 1000);
  return {
    iss: binding.issuer,
    aud: binding.audience,
    sub: `repo:${binding.repository}:ref:${ref}`,
    jti: randomUUID(),
    iat: issuedAt,
    nbf: issuedAt,
    exp: issuedAt + 300,
    repository: binding.repository,
    repository_id: binding.repositoryId,
    repository_owner: owner,
    repository_owner_id: binding.repositoryOwnerId,
    ref,
    ref_type: 'branch',
    sha: binding.sha,
    run_id: binding.runId,
    run_number: 1,
    run_attempt: String(binding.runAttempt),
    event_name: 'create',
    runner_environment: 'github-hosted',
    job_workflow_ref: binding.jobWorkflowRef,
    job_workflow_sha: binding.sha,
    workflow_ref: binding.workflowRef,
    workflow_sha: binding.sha,
  };
}

/**
 * Start the loopback issuer.
 *
 * @param {{
 *   claimsFor: (audience: string) => Record<string, unknown>,
 *   runnerBearer?: string
 * }} options the issuer configuration
 * @returns {Promise<{
 *   issuer: string,
 *   jwksUri: string,
 *   tokenRequestUrl: string,
 *   runnerBearer: string,
 *   publicKey: import('node:crypto').KeyObject,
 *   kid: string,
 *   close: () => Promise<void>
 * }>} the running issuer
 */
export async function startFakeOidcIssuer(options) {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
  });
  const kid = randomUUID();
  const runnerBearer = options.runnerBearer ?? randomUUID();
  const jwk = publicKey.export({ format: 'jwk' });

  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    if (url.pathname === '/.well-known/jwks') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(
        JSON.stringify({ keys: [{ ...jwk, kid, use: 'sig', alg: 'RS256' }] }),
      );
      return;
    }
    if (url.pathname === '/idtoken') {
      if (request.headers.authorization !== `Bearer ${runnerBearer}`) {
        response.writeHead(401).end();
        return;
      }
      const audience = url.searchParams.get('audience') ?? '';
      const claims = options.claimsFor(audience);
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(
        JSON.stringify({
          value: signAssertion(privateKey, kid, claims),
        }),
      );
      return;
    }
    response.writeHead(404).end();
  });
  await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(undefined));
  });
  const address = /** @type {import('node:net').AddressInfo} */ (
    server.address()
  );
  const issuer = `http://127.0.0.1:${address.port}`;
  return {
    issuer,
    jwksUri: `${issuer}/.well-known/jwks`,
    tokenRequestUrl: `${issuer}/idtoken?api-version=2.0`,
    runnerBearer,
    publicKey,
    kid,
    close: () =>
      new Promise((resolve) => {
        server.close(() => resolve(undefined));
      }),
  };
}
