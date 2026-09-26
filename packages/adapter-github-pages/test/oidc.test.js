/**
 * The `gala-pages-oidc-v2` binding checks and the exact
 * `gala-pages-create-deployment-jcs-v2` request entity (DEC-097 section 7).
 *
 * Every token here comes from the FAKE issuer in `test/fake-oidc-issuer.js`:
 * structurally valid, unsigned in any meaningful sense, and bound to no real
 * repository. That is sufficient and correct, because the adapter performs
 * no issuer-signature or JWKS verification at all — see `src/oidc.js`.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  assertCanonicalCreateBody,
  buildCreateDeploymentBody,
} from '../src/deployment.js';
import { verifyPagesOidcToken } from '../src/oidc.js';
import { assertFreeOfSecrets, collectStrings } from '../src/redaction.js';
import {
  FAKE_EXPECTATION,
  FAKE_IDENTITY,
  buildClaims,
  mintFakeToken,
} from './fake-oidc-issuer.js';

const BUILD_VERSION = 'a'.repeat(40);
const GITHUB_TOKEN = 'ghs-fake-installation-token-value';

/**
 * @param {Record<string, unknown>} overrides claim overrides
 * @param {'name' | 'identifier'} [subjectForm] the subject form
 * @returns {string} the minted token
 */
function tokenWith(overrides, subjectForm = 'name') {
  return mintFakeToken({ ...buildClaims({ subjectForm }), ...overrides });
}

test('both supported default-environment subject forms are accepted', () => {
  const byName = verifyPagesOidcToken(
    mintFakeToken(buildClaims({ subjectForm: 'name' })),
    FAKE_EXPECTATION,
  );
  assert.equal(byName.subjectForm, 'name');
  assert.equal(byName.issuerSignatureVerified, false);
  assert.equal(byName.profile, 'gala-pages-oidc-v2');

  const byId = verifyPagesOidcToken(
    mintFakeToken(buildClaims({ subjectForm: 'identifier' })),
    FAKE_EXPECTATION,
  );
  assert.equal(byId.subjectForm, 'identifier');
});

test('a missing or empty token fails closed with a typed code', () => {
  assert.throws(
    () => verifyPagesOidcToken(undefined, FAKE_EXPECTATION),
    /PAGES_OIDC_TOKEN_REQUIRED/u,
  );
  assert.throws(
    () => verifyPagesOidcToken('', FAKE_EXPECTATION),
    /PAGES_OIDC_TOKEN_REQUIRED/u,
  );
});

test('a token that is not three canonical unpadded-base64url segments is refused', () => {
  assert.throws(
    () => verifyPagesOidcToken('only.two', FAKE_EXPECTATION),
    /PAGES_OIDC_TOKEN_MALFORMED/u,
  );
  const valid = mintFakeToken(buildClaims({}));
  const [header, payload] = valid.split('.');
  assert.throws(
    () =>
      verifyPagesOidcToken(
        `${header}.${payload}.${Buffer.from('x').toString('base64')}==`,
        FAKE_EXPECTATION,
      ),
    /PAGES_OIDC_TOKEN_MALFORMED/u,
  );
  assert.throws(
    () =>
      verifyPagesOidcToken(
        `${header}.${String(payload)}A.sig`,
        FAKE_EXPECTATION,
      ),
    /PAGES_OIDC_TOKEN_MALFORMED/u,
  );
});

test('an expired token is refused, even beyond the skew tolerance (PUB-L5)', () => {
  const nowSeconds = Math.floor(Date.now() / 1000);
  assert.throws(
    () =>
      verifyPagesOidcToken(
        mintFakeToken(buildClaims({ exp: nowSeconds - 1000 })),
        FAKE_EXPECTATION,
      ),
    /PAGES_OIDC_TOKEN_EXPIRED/u,
  );
});

test('a token expired only within the skew tolerance is still accepted (PUB-L5)', () => {
  const nowSeconds = Math.floor(Date.now() / 1000);
  assert.doesNotThrow(() =>
    verifyPagesOidcToken(
      mintFakeToken(buildClaims({ exp: nowSeconds - 60 })),
      FAKE_EXPECTATION,
    ),
  );
});

test('a token issued in the future beyond the skew tolerance is refused (PUB-L5)', () => {
  const nowSeconds = Math.floor(Date.now() / 1000);
  assert.throws(
    () =>
      verifyPagesOidcToken(
        mintFakeToken(
          buildClaims({ iat: nowSeconds + 1000, exp: nowSeconds + 2000 }),
        ),
        FAKE_EXPECTATION,
      ),
    /PAGES_OIDC_TOKEN_NOT_YET_VALID/u,
  );
});

test('a not-before claim in the future beyond the skew tolerance is refused (PUB-L5)', () => {
  const nowSeconds = Math.floor(Date.now() / 1000);
  assert.throws(
    () =>
      verifyPagesOidcToken(
        mintFakeToken(buildClaims({ nbf: nowSeconds + 1000 })),
        FAKE_EXPECTATION,
      ),
    /PAGES_OIDC_TOKEN_NOT_YET_VALID/u,
  );
});

test('a token with no nbf claim at all is accepted (nbf is optional) (PUB-L5)', () => {
  assert.doesNotThrow(() =>
    verifyPagesOidcToken(
      mintFakeToken(buildClaims({ nbf: null })),
      FAKE_EXPECTATION,
    ),
  );
});

test('a missing exp or iat claim is refused as malformed (PUB-L5)', () => {
  const withoutExp = { ...buildClaims({}) };
  delete withoutExp.exp;
  assert.throws(
    () => verifyPagesOidcToken(mintFakeToken(withoutExp), FAKE_EXPECTATION),
    /PAGES_OIDC_CLAIM_MISSING/u,
  );

  const withoutIat = { ...buildClaims({}) };
  delete withoutIat.iat;
  assert.throws(
    () => verifyPagesOidcToken(mintFakeToken(withoutIat), FAKE_EXPECTATION),
    /PAGES_OIDC_CLAIM_MISSING/u,
  );
});

test('a duplicate member name in the header or payload is refused', () => {
  const claims = buildClaims({});
  const raw = JSON.stringify(claims);
  const duplicated = `{${JSON.stringify('sub')}:${JSON.stringify('repo:x/y:environment:github-pages')},${raw.slice(1)}`;
  assert.throws(
    () =>
      verifyPagesOidcToken(
        mintFakeToken(claims, { rawPayload: duplicated }),
        FAKE_EXPECTATION,
      ),
    /PAGES_OIDC_TOKEN_MALFORMED/u,
  );
});

test('a wrong audience and a custom-audience token are both refused', () => {
  assert.throws(
    () =>
      verifyPagesOidcToken(
        tokenWith({ aud: 'https://github.com/someone-else' }),
        FAKE_EXPECTATION,
      ),
    /PAGES_OIDC_AUDIENCE_MISMATCH/u,
  );
  assert.throws(
    () =>
      verifyPagesOidcToken(
        tokenWith({ aud: 'https://gala.example/workload' }),
        FAKE_EXPECTATION,
      ),
    /PAGES_OIDC_AUDIENCE_MISMATCH/u,
  );
});

test('a wrong issuer is refused', () => {
  assert.throws(
    () =>
      verifyPagesOidcToken(
        tokenWith({ iss: 'https://token.actions.githubusercontent.example' }),
        FAKE_EXPECTATION,
      ),
    /PAGES_OIDC_ISSUER_MISMATCH/u,
  );
});

test('a non-environment subject is refused', () => {
  assert.throws(
    () =>
      verifyPagesOidcToken(
        tokenWith({
          sub: `repo:${FAKE_IDENTITY.owner}/${FAKE_IDENTITY.repository}:ref:refs/heads/main`,
        }),
        FAKE_EXPECTATION,
      ),
    /PAGES_OIDC_SUBJECT_MISMATCH/u,
  );
});

test('a wrong repository, a cross-form subject and an ID substitution are all refused', () => {
  assert.throws(
    () =>
      verifyPagesOidcToken(
        mintFakeToken(
          buildClaims({ identity: { repository: 'some-other-repository' } }),
        ),
        FAKE_EXPECTATION,
      ),
    /PAGES_OIDC_REPOSITORY_MISMATCH/u,
  );
  // A hybrid of the two supported forms: names on one side, IDs on the other.
  assert.throws(
    () =>
      verifyPagesOidcToken(
        tokenWith({
          sub: `repo:${FAKE_IDENTITY.owner}@${FAKE_IDENTITY.repositoryOwnerId}/${FAKE_IDENTITY.repository}:environment:github-pages`,
        }),
        FAKE_EXPECTATION,
      ),
    /PAGES_OIDC_SUBJECT_MISMATCH/u,
  );
  // The ID form with the two IDs swapped: each component is recomputed from
  // the separately verified claims, so a substitution cannot pass.
  assert.throws(
    () =>
      verifyPagesOidcToken(
        tokenWith(
          {
            sub: `repo:${FAKE_IDENTITY.owner}@${FAKE_IDENTITY.repositoryId}/${FAKE_IDENTITY.repository}@${FAKE_IDENTITY.repositoryOwnerId}:environment:github-pages`,
          },
          'identifier',
        ),
        FAKE_EXPECTATION,
      ),
    /PAGES_OIDC_SUBJECT_MISMATCH/u,
  );
  // The subject keeps the true IDs but the identity claims are substituted.
  assert.throws(
    () =>
      verifyPagesOidcToken(
        mintFakeToken(
          buildClaims({
            subjectForm: 'identifier',
            identity: { repositoryId: '700001' },
          }),
        ),
        FAKE_EXPECTATION,
      ),
    /PAGES_OIDC_REPOSITORY_MISMATCH/u,
  );
});

test('a wrong ref, SHA, run id, run attempt or environment is refused', () => {
  for (const [claim, value] of [
    ['ref', 'refs/heads/main'],
    ['sha', 'c'.repeat(40)],
    ['run_id', '999'],
    ['run_attempt', '2'],
  ]) {
    assert.throws(
      () =>
        verifyPagesOidcToken(
          tokenWith({ [String(claim)]: value }),
          FAKE_EXPECTATION,
        ),
      /PAGES_OIDC_BINDING_MISMATCH/u,
      `${String(claim)} must be bound`,
    );
  }
  assert.throws(
    () =>
      verifyPagesOidcToken(
        tokenWith({ environment: 'production' }),
        FAKE_EXPECTATION,
      ),
    /PAGES_OIDC_ENVIRONMENT_MISMATCH/u,
  );
});

test('a substituted job_workflow_ref and a mismatched job_workflow_sha are refused', () => {
  assert.throws(
    () =>
      verifyPagesOidcToken(
        tokenWith({
          job_workflow_ref: `attacker/publish/.github/workflows/publish-v2.yml@${'b'.repeat(40)}`,
        }),
        FAKE_EXPECTATION,
      ),
    /PAGES_OIDC_BINDING_MISMATCH/u,
  );
  assert.throws(
    () =>
      verifyPagesOidcToken(
        tokenWith({ job_workflow_sha: 'd'.repeat(40) }),
        FAKE_EXPECTATION,
      ),
    /PAGES_OIDC_BINDING_MISMATCH/u,
  );
});

test('a substituted signature segment is accepted locally: Pages is the relying party, not this adapter', () => {
  const accepted = verifyPagesOidcToken(
    mintFakeToken(buildClaims({}), {
      signature: Buffer.from('a completely different signature').toString(
        'base64url',
      ),
    }),
    FAKE_EXPECTATION,
  );
  assert.equal(accepted.issuerSignatureVerified, false);
});

test('no failure message ever contains a token byte', () => {
  const token = tokenWith({ environment: 'production' });
  try {
    verifyPagesOidcToken(token, FAKE_EXPECTATION);
    assert.fail('expected a refusal');
  } catch (error) {
    const message = /** @type {Error} */ (error).message;
    assert.ok(!message.includes(token));
    for (const segment of token.split('.')) {
      assert.ok(!message.includes(segment), 'no segment may leak either');
    }
  }
});

test('the create body is exactly three members in JCS order and nothing else', () => {
  const token = mintFakeToken(buildClaims({}));
  const built = buildCreateDeploymentBody({
    pagesArtifactId: '42',
    pagesBuildVersion: BUILD_VERSION,
    oidcToken: token,
    githubToken: GITHUB_TOKEN,
  });
  assert.deepEqual(Object.keys(JSON.parse(built.bodyText)), [
    'artifact_id',
    'oidc_token',
    'pages_build_version',
  ]);
  assert.equal(JSON.parse(built.bodyText).artifact_id, 42);
  assert.equal(built.byteCount, Buffer.byteLength(built.bodyText, 'utf8'));

  assert.throws(
    () =>
      assertCanonicalCreateBody(
        JSON.stringify({
          artifact_id: 42,
          oidc_token: token,
          pages_build_version: BUILD_VERSION,
          extra: 1,
        }),
      ),
    /PAGES_CREATE_BODY_NONCANONICAL/u,
  );
  assert.throws(
    () =>
      assertCanonicalCreateBody(
        JSON.stringify({ artifact_id: 42, pages_build_version: BUILD_VERSION }),
      ),
    /PAGES_CREATE_BODY_NONCANONICAL/u,
  );
  assert.throws(
    () =>
      assertCanonicalCreateBody(
        JSON.stringify({
          pages_build_version: BUILD_VERSION,
          oidc_token: token,
          artifact_id: 42,
        }),
      ),
    /PAGES_CREATE_BODY_NONCANONICAL/u,
  );
  assert.throws(
    () =>
      assertCanonicalCreateBody(
        `{ "artifact_id": 42, "oidc_token": ${JSON.stringify(token)}, "pages_build_version": ${JSON.stringify(BUILD_VERSION)} }`,
      ),
    /PAGES_CREATE_BODY_NONCANONICAL/u,
  );
});

test('a string, zero, non-integer or unsafe artifact id is refused, and the token is mandatory', () => {
  const token = mintFakeToken(buildClaims({}));
  for (const artifactId of [
    'forty-two',
    '0',
    '4.5',
    '9007199254740992',
    '-1',
    ' 42',
  ]) {
    assert.throws(
      () =>
        buildCreateDeploymentBody({
          pagesArtifactId: artifactId,
          pagesBuildVersion: BUILD_VERSION,
          oidcToken: token,
          githubToken: GITHUB_TOKEN,
        }),
      /PAGES_ARTIFACT_ID_INVALID/u,
      `${artifactId} must be refused`,
    );
  }
  assert.throws(
    () =>
      buildCreateDeploymentBody({
        pagesArtifactId: '42',
        pagesBuildVersion: BUILD_VERSION,
        oidcToken: '',
        githubToken: GITHUB_TOKEN,
      }),
    /PAGES_OIDC_TOKEN_REQUIRED/u,
  );
});

test('the GitHub token can never reach the body, and the OIDC token reaches nothing else', () => {
  const token = mintFakeToken(buildClaims({}));
  assert.throws(
    () =>
      buildCreateDeploymentBody({
        pagesArtifactId: '42',
        pagesBuildVersion: BUILD_VERSION,
        // A caller that confuses the two credentials must fail closed.
        oidcToken: GITHUB_TOKEN,
        githubToken: GITHUB_TOKEN,
      }),
    /PAGES_SECRET_LEAK_DETECTED/u,
  );

  const built = buildCreateDeploymentBody({
    pagesArtifactId: '42',
    pagesBuildVersion: BUILD_VERSION,
    oidcToken: token,
    githubToken: GITHUB_TOKEN,
  });
  assert.ok(!built.bodyText.includes(GITHUB_TOKEN));
  assert.ok(built.bodyText.includes(token));

  // The header map is the only place the GitHub token may appear, and the
  // OIDC token may never appear there.
  const headers = { authorization: `Bearer ${GITHUB_TOKEN}` };
  assert.ok(!collectStrings(headers).some((value) => value.includes(token)));
  assert.throws(
    () =>
      assertFreeOfSecrets(
        { headers: { authorization: token } },
        [token],
        'a header',
      ),
    /PAGES_SECRET_LEAK_DETECTED/u,
  );
});

test('design check: the clock is injectable, and exp exactly at the 300s skew boundary is accepted (PUB-L5)', () => {
  const fixedNowSeconds = 1_800_000_000;
  const now = () => fixedNowSeconds * 1000;
  assert.doesNotThrow(() =>
    verifyPagesOidcToken(
      mintFakeToken(
        buildClaims({ iat: fixedNowSeconds - 30, exp: fixedNowSeconds - 300 }),
      ),
      FAKE_EXPECTATION,
      now,
    ),
  );
});

test('design check: exp one second past the 300s skew boundary is refused (PUB-L5)', () => {
  const fixedNowSeconds = 1_800_000_000;
  const now = () => fixedNowSeconds * 1000;
  assert.throws(
    () =>
      verifyPagesOidcToken(
        mintFakeToken(
          buildClaims({
            iat: fixedNowSeconds - 30,
            exp: fixedNowSeconds - 301,
          }),
        ),
        FAKE_EXPECTATION,
        now,
      ),
    /PAGES_OIDC_TOKEN_EXPIRED/u,
  );
});

test('design check: nbf exactly at the 300s skew boundary in the future is accepted (PUB-L5)', () => {
  const fixedNowSeconds = 1_800_000_000;
  const now = () => fixedNowSeconds * 1000;
  assert.doesNotThrow(() =>
    verifyPagesOidcToken(
      mintFakeToken(
        buildClaims({
          iat: fixedNowSeconds - 30,
          exp: fixedNowSeconds + 900,
          nbf: fixedNowSeconds + 300,
        }),
      ),
      FAKE_EXPECTATION,
      now,
    ),
  );
});

test('design check: nbf one second past the 300s skew boundary in the future is refused (PUB-L5)', () => {
  const fixedNowSeconds = 1_800_000_000;
  const now = () => fixedNowSeconds * 1000;
  assert.throws(
    () =>
      verifyPagesOidcToken(
        mintFakeToken(
          buildClaims({
            iat: fixedNowSeconds - 30,
            exp: fixedNowSeconds + 900,
            nbf: fixedNowSeconds + 301,
          }),
        ),
        FAKE_EXPECTATION,
        now,
      ),
    /PAGES_OIDC_TOKEN_NOT_YET_VALID/u,
  );
});

test('design check: default clock source is Date.now when none is injected', () => {
  const nowSeconds = Math.floor(Date.now() / 1000);
  // No explicit `now` argument: must fall back to the real wall clock, so a
  // freshly minted token (exp far in the future, iat/nbf now) is accepted.
  assert.doesNotThrow(() =>
    verifyPagesOidcToken(
      mintFakeToken(buildClaims({ exp: nowSeconds + 3600, iat: nowSeconds })),
      FAKE_EXPECTATION,
    ),
  );
});
