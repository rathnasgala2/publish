/**
 * The `gala-pages-oidc-v2` credential-source profile: the local, structural
 * binding checks this adapter performs on the Pages OIDC JWT immediately
 * before placing it — and only it — in the create-deployment request body.
 *
 * ## Trust boundary (read this before changing anything here)
 *
 * This adapter **never mints a credential**. The JWT is caller-supplied
 * input: DEC-097 section 7 places the one token acquisition in the Pages
 * environment job, which calls the GitHub-hosted runner URL from
 * `ACTIONS_ID_TOKEN_REQUEST_URL` exactly once with
 * `ACTIONS_ID_TOKEN_REQUEST_TOKEN` (that is what the job's `id-token: write`
 * permission is for), against an origin that must byte-equal one member of
 * the capability-authorized `githubActionsOidcOriginCatalog`.
 *
 * For this in-job, single-use credential the trust boundary is therefore
 * that exact catalog-authorized, DNS/TLS-authenticated runner token endpoint
 * and bearer exchange — **not** anything this module does. GitHub Pages is
 * the relying party that cryptographically validates the JWT when it
 * processes create-deployment. Accordingly this module **deliberately
 * performs no issuer-signature or JWKS verification and makes no discovery,
 * issuer-key or JWKS network call of any kind**; no such unbudgeted request,
 * cache or key-set digest may be inferred from it. The checks below prevent
 * a token minted for another bound context from being forwarded; they are
 * expressly not an independent issuer-authenticity proof, and a stale or
 * signature-substituted token is not a locally authenticated finding — it
 * reaches the disposable Pages relying party, which must reject it before
 * any candidate activation can be derived.
 *
 * ## What is checked
 *
 * Three compact-JWT segments in canonical unpadded base64url; duplicate-key-
 * free JSON object header and payload; and the exact binding claims: issuer,
 * audience `https://github.com/<repository_owner>`, one of the two supported
 * default-environment subject forms with every inserted component recomputed
 * from the separately verified `repository`, `repository_owner`,
 * `repository_id` and `repository_owner_id` claims, `environment`, and the
 * caller-supplied ref/SHA/run id/run attempt/`job_workflow_ref`/
 * `job_workflow_sha` expectations.
 *
 * No error raised here ever contains a token byte.
 *
 * @module
 */

import { PagesAdapterError } from './errors.js';
/** The closed credential-source profile this module implements. */
export const PAGES_OIDC_PROFILE = 'gala-pages-oidc-v2';

/** The exact required `iss` claim. */
export const PAGES_OIDC_ISSUER = 'https://token.actions.githubusercontent.com';

/** The exact required `environment` claim and subject environment segment. */
export const PAGES_OIDC_ENVIRONMENT = 'github-pages';

/** Inclusive byte bounds on the compact JWT (DEC-097 section 7). */
export const PAGES_OIDC_MINIMUM_BYTES = 1;
/** Inclusive upper byte bound on the compact JWT. */
export const PAGES_OIDC_MAXIMUM_BYTES = 8000;

const BASE64URL_SEGMENT = /^[A-Za-z0-9_-]+$/u;
const CANONICAL_DECIMAL = /^(?:0|[1-9][0-9]*)$/u;

/**
 * @typedef {Readonly<{
 *   owner: string,
 *   repository: string,
 *   repositoryId: string | number,
 *   repositoryOwnerId: string | number,
 *   ref: string,
 *   sha: string,
 *   runId: string | number,
 *   runAttempt: string | number,
 *   jobWorkflowRef: string,
 *   jobWorkflowSha: string
 * }>} PagesOidcExpectation
 */

/**
 * Raise a typed, token-free failure.
 *
 * @param {string} code the stable error code
 * @param {string} detail a detail that contains no token byte
 * @returns {never} never returns
 */
function refuse(code, detail) {
  throw new PagesAdapterError(code, detail);
}

/**
 * Decode one canonical unpadded base64url segment.
 *
 * @param {string} segment the segment text
 * @param {string} label the segment name, for the diagnostic
 * @returns {Buffer} the decoded bytes
 */
export function decodeCanonicalBase64Url(segment, label) {
  if (!BASE64URL_SEGMENT.test(segment)) {
    refuse(
      'PAGES_OIDC_TOKEN_MALFORMED',
      `the ${label} segment is not unpadded base64url`,
    );
  }
  const bytes = Buffer.from(segment, 'base64url');
  if (bytes.toString('base64url') !== segment) {
    refuse(
      'PAGES_OIDC_TOKEN_MALFORMED',
      `the ${label} segment is not canonical unpadded base64url`,
    );
  }
  return bytes;
}

/**
 * Parse one JSON object, refusing any duplicate member name at any depth.
 *
 * `JSON.parse` silently keeps the last of two identical member names, which
 * would let a crafted token present one `sub` to a scanner and another to a
 * parser. This scanner rejects that before the value is used.
 *
 * @param {string} text the JSON text
 * @param {string} label the value's name, for the diagnostic
 * @returns {Record<string, unknown>} the parsed object
 */
export function parseDuplicateKeyFreeJsonObject(text, label) {
  /** @type {unknown} */
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    refuse('PAGES_OIDC_TOKEN_MALFORMED', `the ${label} is not JSON`);
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    refuse('PAGES_OIDC_TOKEN_MALFORMED', `the ${label} is not a JSON object`);
  }
  assertNoDuplicateKeys(text, label);
  return /** @type {Record<string, unknown>} */ (parsed);
}

/**
 * Scan JSON text and refuse a repeated member name within one object.
 *
 * @param {string} text the JSON text, already known to parse
 * @param {string} label the value's name, for the diagnostic
 * @returns {void}
 */
function assertNoDuplicateKeys(text, label) {
  /** @type {Set<string>[]} */
  const scopes = [];
  /** @type {('object' | 'array')[]} */
  const kinds = [];
  let index = 0;
  let expectingKey = false;
  while (index < text.length) {
    const character = text[index];
    if (character === '{') {
      scopes.push(new Set());
      kinds.push('object');
      expectingKey = true;
      index += 1;
      continue;
    }
    if (character === '[') {
      kinds.push('array');
      expectingKey = false;
      index += 1;
      continue;
    }
    if (character === '}' || character === ']') {
      if (kinds.pop() === 'object') {
        scopes.pop();
      }
      expectingKey = false;
      index += 1;
      continue;
    }
    if (character === ',') {
      expectingKey = kinds[kinds.length - 1] === 'object';
      index += 1;
      continue;
    }
    if (character === '"') {
      const { value, next } = readJsonString(text, index);
      if (expectingKey) {
        const scope = scopes[scopes.length - 1];
        if (scope !== undefined && scope.has(value)) {
          refuse(
            'PAGES_OIDC_TOKEN_MALFORMED',
            `the ${label} repeats the member name ${JSON.stringify(value)}`,
          );
        }
        scope?.add(value);
        expectingKey = false;
      }
      index = next;
      continue;
    }
    index += 1;
  }
}

/**
 * Read one JSON string literal starting at an opening quote.
 *
 * @param {string} text the JSON text
 * @param {number} start the index of the opening quote
 * @returns {{value: string, next: number}} the decoded value and next index
 */
function readJsonString(text, start) {
  let index = start + 1;
  let raw = '';
  while (index < text.length) {
    const character = text[index];
    if (character === '\\') {
      raw += text.slice(index, index + 2);
      index += 2;
      continue;
    }
    if (character === '"') {
      return {
        value: /** @type {string} */ (JSON.parse(`"${raw}"`)),
        next: index + 1,
      };
    }
    raw += character;
    index += 1;
  }
  return refuse(
    'PAGES_OIDC_TOKEN_MALFORMED',
    'an unterminated JSON string literal',
  );
}

/**
 * Read one required string claim.
 *
 * @param {Record<string, unknown>} payload the parsed payload
 * @param {string} name the claim name
 * @returns {string} the claim value
 */
function requireStringClaim(payload, name) {
  const value = payload[name];
  if (typeof value !== 'string' || value === '') {
    refuse(
      'PAGES_OIDC_CLAIM_MISSING',
      `the ${JSON.stringify(name)} claim is absent or not a non-empty string`,
    );
  }
  return /** @type {string} */ (value);
}

/**
 * Normalize a claim or expectation that must be a canonical decimal string.
 *
 * @param {unknown} value the claim or expectation value
 * @param {string} name the claim name, for the diagnostic
 * @returns {string} the canonical decimal string
 */
function requireCanonicalDecimal(value, name) {
  const text =
    typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
      ? String(value)
      : value;
  if (typeof text !== 'string' || !CANONICAL_DECIMAL.test(text)) {
    refuse(
      'PAGES_OIDC_CLAIM_INVALID',
      `${JSON.stringify(name)} is not a canonical decimal value`,
    );
  }
  return /** @type {string} */ (text);
}

/**
 * Compare one claim against its expectation without echoing either value's
 * observed bytes where the claim could carry caller content.
 *
 * @param {string} observed the claim value
 * @param {string} expected the expected value
 * @param {string} name the claim name
 * @param {string} code the stable code to raise on disagreement
 * @returns {void}
 */
function requireClaimEquals(observed, expected, name, code) {
  if (observed !== expected) {
    refuse(
      code,
      `the ${JSON.stringify(name)} claim does not byte-equal the expected ${JSON.stringify(expected)}`,
    );
  }
}

/**
 * The two GitHub-supported default-environment subject forms, recomputed
 * from the separately verified identity claims.
 *
 * @param {{
 *   owner: string,
 *   repository: string,
 *   repositoryId: string,
 *   repositoryOwnerId: string
 * }} identity the verified identity claims
 * @returns {{name: string, id: string}} the two admitted subject forms
 */
export function buildSubjectForms(identity) {
  return {
    name: `repo:${identity.owner}/${identity.repository}:environment:${PAGES_OIDC_ENVIRONMENT}`,
    id: `repo:${identity.owner}@${identity.repositoryOwnerId}/${identity.repository}@${identity.repositoryId}:environment:${PAGES_OIDC_ENVIRONMENT}`,
  };
}

/**
 * Verify one caller-supplied Pages OIDC JWT against its expected bindings.
 *
 * Performs no network call and no signature verification; see this module's
 * header for why that is correct and where the real trust boundary is.
 *
 * @param {unknown} token the caller-supplied compact JWT
 * @param {PagesOidcExpectation} expected the expected bindings
 * @returns {Readonly<{
 *   profile: string,
 *   subjectForm: 'name' | 'identifier',
 *   issuerSignatureVerified: false,
 *   tokenByteCount: number
 * }>} non-secret evidence about the accepted token
 */
export function verifyPagesOidcToken(token, expected) {
  if (typeof token !== 'string' || token === '') {
    refuse(
      'PAGES_OIDC_TOKEN_REQUIRED',
      'the Pages OIDC token is mandatory: DEC-097 section 7 makes oidc_token a required create-body member, and this adapter never mints one',
    );
  }
  const tokenText = /** @type {string} */ (token);
  const tokenByteCount = Buffer.byteLength(tokenText, 'utf8');
  if (
    tokenByteCount < PAGES_OIDC_MINIMUM_BYTES ||
    tokenByteCount > PAGES_OIDC_MAXIMUM_BYTES
  ) {
    refuse(
      'PAGES_OIDC_TOKEN_MALFORMED',
      `the token is ${tokenByteCount} bytes, outside the admitted ${PAGES_OIDC_MINIMUM_BYTES}..${PAGES_OIDC_MAXIMUM_BYTES}`,
    );
  }
  const segments = tokenText.split('.');
  if (segments.length !== 3) {
    refuse(
      'PAGES_OIDC_TOKEN_MALFORMED',
      `the token has ${segments.length} compact segments, not 3`,
    );
  }
  const headerBytes = decodeCanonicalBase64Url(
    /** @type {string} */ (segments[0]),
    'header',
  );
  // The signature segment must be canonical unpadded base64url, but it is
  // deliberately never verified here: Pages is the relying party.
  decodeCanonicalBase64Url(/** @type {string} */ (segments[2]), 'signature');
  parseDuplicateKeyFreeJsonObject(headerBytes.toString('utf8'), 'JWT header');
  const payload = parseDuplicateKeyFreeJsonObject(
    decodeCanonicalBase64Url(
      /** @type {string} */ (segments[1]),
      'payload',
    ).toString('utf8'),
    'JWT payload',
  );

  const repositoryOwner = requireStringClaim(payload, 'repository_owner');
  const repositoryClaim = requireStringClaim(payload, 'repository');
  const repositoryId = requireCanonicalDecimal(
    payload.repository_id,
    'repository_id',
  );
  const repositoryOwnerId = requireCanonicalDecimal(
    payload.repository_owner_id,
    'repository_owner_id',
  );
  requireClaimEquals(
    repositoryOwner,
    expected.owner,
    'repository_owner',
    'PAGES_OIDC_REPOSITORY_MISMATCH',
  );
  requireClaimEquals(
    repositoryClaim,
    `${expected.owner}/${expected.repository}`,
    'repository',
    'PAGES_OIDC_REPOSITORY_MISMATCH',
  );
  requireClaimEquals(
    repositoryId,
    requireCanonicalDecimal(expected.repositoryId, 'expected repositoryId'),
    'repository_id',
    'PAGES_OIDC_REPOSITORY_MISMATCH',
  );
  requireClaimEquals(
    repositoryOwnerId,
    requireCanonicalDecimal(
      expected.repositoryOwnerId,
      'expected repositoryOwnerId',
    ),
    'repository_owner_id',
    'PAGES_OIDC_REPOSITORY_MISMATCH',
  );

  requireClaimEquals(
    requireStringClaim(payload, 'iss'),
    PAGES_OIDC_ISSUER,
    'iss',
    'PAGES_OIDC_ISSUER_MISMATCH',
  );
  requireClaimEquals(
    requireStringClaim(payload, 'aud'),
    `https://github.com/${repositoryOwner}`,
    'aud',
    'PAGES_OIDC_AUDIENCE_MISMATCH',
  );
  requireClaimEquals(
    requireStringClaim(payload, 'environment'),
    PAGES_OIDC_ENVIRONMENT,
    'environment',
    'PAGES_OIDC_ENVIRONMENT_MISMATCH',
  );

  const forms = buildSubjectForms({
    owner: repositoryOwner,
    repository: repositoryClaim.slice(repositoryOwner.length + 1),
    repositoryId,
    repositoryOwnerId,
  });
  const subject = requireStringClaim(payload, 'sub');
  /** @type {'name' | 'identifier' | undefined} */
  let subjectForm;
  if (subject === forms.name) {
    subjectForm = 'name';
  } else if (subject === forms.id) {
    subjectForm = 'identifier';
  } else {
    refuse(
      'PAGES_OIDC_SUBJECT_MISMATCH',
      'the "sub" claim is neither of the two supported default-environment forms recomputed from the verified repository/owner/id claims; a hybrid, omitted, substituted or reordered name/ID form is refused',
    );
  }

  requireClaimEquals(
    requireStringClaim(payload, 'ref'),
    expected.ref,
    'ref',
    'PAGES_OIDC_BINDING_MISMATCH',
  );
  requireClaimEquals(
    requireStringClaim(payload, 'sha'),
    expected.sha,
    'sha',
    'PAGES_OIDC_BINDING_MISMATCH',
  );
  requireClaimEquals(
    requireCanonicalDecimal(payload.run_id, 'run_id'),
    requireCanonicalDecimal(expected.runId, 'expected runId'),
    'run_id',
    'PAGES_OIDC_BINDING_MISMATCH',
  );
  requireClaimEquals(
    requireCanonicalDecimal(payload.run_attempt, 'run_attempt'),
    requireCanonicalDecimal(expected.runAttempt, 'expected runAttempt'),
    'run_attempt',
    'PAGES_OIDC_BINDING_MISMATCH',
  );
  requireClaimEquals(
    requireStringClaim(payload, 'job_workflow_ref'),
    expected.jobWorkflowRef,
    'job_workflow_ref',
    'PAGES_OIDC_BINDING_MISMATCH',
  );
  requireClaimEquals(
    requireStringClaim(payload, 'job_workflow_sha'),
    expected.jobWorkflowSha,
    'job_workflow_sha',
    'PAGES_OIDC_BINDING_MISMATCH',
  );

  return Object.freeze({
    profile: PAGES_OIDC_PROFILE,
    subjectForm: /** @type {'name' | 'identifier'} */ (subjectForm),
    issuerSignatureVerified: /** @type {false} */ (false),
    tokenByteCount,
  });
}

/**
 * Validate one caller-supplied expectation record before it is used.
 *
 * @param {unknown} expected the caller-supplied expectation
 * @returns {PagesOidcExpectation} the validated expectation
 */
export function requireOidcExpectation(expected) {
  if (expected === null || typeof expected !== 'object') {
    refuse(
      'PAGES_OIDC_EXPECTATION_INVALID',
      'the expected OIDC bindings record is required; this adapter cannot invent the ref, SHA, run identity or reusable-workflow identity a token must be bound to',
    );
  }
  const record = /** @type {Record<string, unknown>} */ (expected);
  for (const field of ['ref', 'sha', 'jobWorkflowRef', 'jobWorkflowSha']) {
    if (typeof record[field] !== 'string' || record[field] === '') {
      refuse(
        'PAGES_OIDC_EXPECTATION_INVALID',
        `the expected OIDC binding ${JSON.stringify(field)} (non-empty string) is required`,
      );
    }
  }
  requireCanonicalDecimal(record.runId, 'expected runId');
  requireCanonicalDecimal(record.runAttempt, 'expected runAttempt');
  return /** @type {PagesOidcExpectation} */ (
    /** @type {unknown} */ (Object.freeze({ ...record }))
  );
}
