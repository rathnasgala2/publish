/**
 * Per-run adapter state, keyed by the physical Pages destination.
 *
 * The GitHub Pages API has no list-deployments operation and no
 * server-side notion of a retained generation, so an honest adapter cannot
 * *discover* what it staged earlier: it can only remember, within the run
 * that staged it, and re-read the public marker for what is actually served
 * now. This module holds exactly that run-scoped memory. Nothing here is
 * durable, nothing here is authority, and `inspectDestination`/`observe`
 * always prefer a live public read over anything recorded here.
 *
 * @module
 */

import { domainDigest } from '@rathnasgala2/adapter-protocol';

import { DOMAIN_PAGES_DESTINATION } from './constants.js';

/**
 * @typedef {Readonly<{
 *   stageToken: string,
 *   operationId: string,
 *   attemptId: string,
 *   idempotencyKey: string,
 *   generationId: string,
 *   artifactId: string,
 *   artifactDigest: string,
 *   entryPaths: readonly string[],
 *   carrierBytes: Buffer,
 *   carrierDigest: string,
 *   pagesArtifactId: string,
 *   pagesArtifactDigest: string,
 *   carrierByteCount: number
 * }>} StageRecord
 */

/**
 * @typedef {{
 *   stages: Map<string, StageRecord>,
 *   activations: Map<string, {generationId: string, pagesDeploymentId: string, certifiedAt: string, entryPaths: readonly string[]}>,
 *   inFlight: Map<string, string>
 * }} DestinationState
 */

/** @type {Map<string, DestinationState>} */
const STATE = new Map();

/**
 * Compute the physical destination mutation key. DEC-097 section 4.3 fixes
 * it as the immutable Pages repository identity: a logical alias, name or
 * URL never creates a second physical fence, so the numeric repository id
 * is preferred and `owner/repository` is only the fallback when the caller
 * has not supplied one.
 *
 * @param {{owner: string, repository: string, repositoryId?: string | number}} destination
 *   the destination identity
 * @returns {string} the destination key digest
 */
export function destinationKey(destination) {
  return domainDigest(DOMAIN_PAGES_DESTINATION, {
    repositoryId:
      destination.repositoryId === undefined
        ? null
        : String(destination.repositoryId),
    owner: destination.owner.toLowerCase(),
    repository: destination.repository.toLowerCase(),
  });
}

/**
 * Get (creating on first use) the run-scoped state for one destination.
 *
 * @param {{owner: string, repository: string, repositoryId?: string | number}} destination
 *   the destination identity
 * @returns {DestinationState} the mutable run-scoped state
 */
export function stateFor(destination) {
  const key = destinationKey(destination);
  const existing = STATE.get(key);
  if (existing !== undefined) {
    return existing;
  }
  /** @type {DestinationState} */
  const created = {
    stages: new Map(),
    activations: new Map(),
    inFlight: new Map(),
  };
  STATE.set(key, created);
  return created;
}

/**
 * Discard all run-scoped state for one destination. Used by a test fixture's
 * teardown so one conformance destination can never leak into the next.
 *
 * @param {{owner: string, repository: string, repositoryId?: string | number}} destination
 *   the destination identity
 * @returns {void}
 */
export function forgetDestination(destination) {
  STATE.delete(destinationKey(destination));
}
