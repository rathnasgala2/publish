/**
 * A FAKE Pages OIDC issuer for this package's tests.
 *
 * It emits structurally valid three-segment compact JWTs in canonical
 * unpadded base64url with an arbitrary signature segment. There is no key,
 * no signing and no real issuer: the adapter deliberately performs no
 * issuer-signature or JWKS verification (GitHub Pages is the relying party
 * that does), so a fixture never needs one — and this file exists precisely
 * so no real credential is required to prove the binding checks.
 */

/**
 * Encode one value as canonical unpadded base64url JSON.
 *
 * @param {unknown} value the value to encode
 * @returns {string} the segment
 */
function segment(value) {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

/** The default non-secret identity every fixture token is bound to. */
export const FAKE_IDENTITY = Object.freeze({
  owner: 'rathnasgala2',
  repository: 'disposable-pages-target',
  repositoryId: '812345',
  repositoryOwnerId: '99001',
  ref: 'refs/heads/gala/publish/01932f00-0000-7000-8000-000000000001',
  sha: 'a'.repeat(40),
  runId: '17654321098',
  runAttempt: '1',
  jobWorkflowRef: `rathnasgala2/publish/.github/workflows/publish-v2.yml@${'b'.repeat(40)}`,
  jobWorkflowSha: 'b'.repeat(40),
});

/** The exact claim bindings `verifyPagesOidcToken` is given as expected. */
export const FAKE_EXPECTATION = Object.freeze({
  owner: FAKE_IDENTITY.owner,
  repository: FAKE_IDENTITY.repository,
  repositoryId: FAKE_IDENTITY.repositoryId,
  repositoryOwnerId: FAKE_IDENTITY.repositoryOwnerId,
  ref: FAKE_IDENTITY.ref,
  sha: FAKE_IDENTITY.sha,
  runId: FAKE_IDENTITY.runId,
  runAttempt: FAKE_IDENTITY.runAttempt,
  jobWorkflowRef: FAKE_IDENTITY.jobWorkflowRef,
  jobWorkflowSha: FAKE_IDENTITY.jobWorkflowSha,
});

/**
 * The claim set a correct default-audience Pages token carries.
 *
 * @param {{
 *   subjectForm?: 'name' | 'identifier',
 *   identity?: Readonly<Record<string, string>>,
 *   exp?: number,
 *   iat?: number,
 *   nbf?: number | null
 * }} [options] which subject form to emit, which identity to bind to, and
 *   (PUB-L5) temporal claim overrides for negative fixtures -- `nbf: null`
 *   omits the claim entirely, since RFC 7519 makes it optional
 * @returns {Record<string, unknown>} the payload claims
 */
export function buildClaims(options = {}) {
  const identity = { ...FAKE_IDENTITY, ...options.identity };
  const subject =
    options.subjectForm === 'identifier'
      ? `repo:${identity.owner}@${identity.repositoryOwnerId}/${identity.repository}@${identity.repositoryId}:environment:github-pages`
      : `repo:${identity.owner}/${identity.repository}:environment:github-pages`;
  const nowSeconds = Math.floor(Date.now() / 1000);
  const issuedAt = options.iat ?? nowSeconds - 30;
  const notBefore =
    options.nbf === null ? undefined : (options.nbf ?? issuedAt);
  return {
    iss: 'https://token.actions.githubusercontent.com',
    aud: `https://github.com/${identity.owner}`,
    sub: subject,
    environment: 'github-pages',
    repository: `${identity.owner}/${identity.repository}`,
    repository_owner: identity.owner,
    repository_id: identity.repositoryId,
    repository_owner_id: identity.repositoryOwnerId,
    ref: identity.ref,
    sha: identity.sha,
    run_id: identity.runId,
    run_attempt: identity.runAttempt,
    job_workflow_ref: identity.jobWorkflowRef,
    job_workflow_sha: identity.jobWorkflowSha,
    iat: issuedAt,
    exp: options.exp ?? issuedAt + 900,
    ...(notBefore === undefined ? {} : { nbf: notBefore }),
  };
}

/**
 * Mint one fake compact JWT.
 *
 * @param {Record<string, unknown>} claims the payload claims
 * @param {{
 *   header?: Record<string, unknown>,
 *   rawPayload?: string,
 *   signature?: string
 * }} [options] structural overrides for negative fixtures
 * @returns {string} the compact JWT
 */
export function mintFakeToken(claims, options = {}) {
  const header = options.header ?? { alg: 'RS256', typ: 'JWT', kid: 'fake' };
  const payload =
    options.rawPayload === undefined
      ? segment(claims)
      : Buffer.from(options.rawPayload, 'utf8').toString('base64url');
  const signature =
    options.signature ??
    Buffer.from('fixture-signature-not-verified-anywhere', 'utf8').toString(
      'base64url',
    );
  return `${segment(header)}.${payload}.${signature}`;
}

/**
 * Mint the happy-path token for one subject form.
 *
 * @param {'name' | 'identifier'} [subjectForm] the subject form to emit
 * @returns {string} the compact JWT
 */
export function mintValidToken(subjectForm = 'name') {
  return mintFakeToken(buildClaims({ subjectForm }));
}
