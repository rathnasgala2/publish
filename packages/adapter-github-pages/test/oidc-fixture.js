/**
 * The fake-issuer OIDC credentials a fixture attaches to one destination.
 * Kept out of any `*.test.js` file so importing it never re-runs a suite.
 */

import {
  FAKE_IDENTITY,
  buildClaims,
  mintFakeToken,
} from './fake-oidc-issuer.js';

/**
 * Build the fake-issuer token and its expected bindings for a destination.
 *
 * @param {{
 *   owner: string,
 *   repository: string,
 *   repositoryId: string | number,
 *   repositoryOwnerId: string | number
 * }} destination the destination the token must be bound to
 * @returns {{
 *   pagesOidcToken: string,
 *   pagesOidcClaims: import('../src/oidc.js').PagesOidcExpectation
 * }} the credentials, shaped exactly as `activate` accepts them
 */
export function oidcFor(destination) {
  const identity = {
    ...FAKE_IDENTITY,
    owner: destination.owner,
    repository: destination.repository,
    repositoryId: String(destination.repositoryId),
    repositoryOwnerId: String(destination.repositoryOwnerId),
  };
  return {
    pagesOidcToken: mintFakeToken(buildClaims({ identity })),
    pagesOidcClaims: /** @type {any} */ ({
      ref: identity.ref,
      sha: identity.sha,
      runId: identity.runId,
      runAttempt: identity.runAttempt,
      jobWorkflowRef: identity.jobWorkflowRef,
      jobWorkflowSha: identity.jobWorkflowSha,
    }),
  };
}
