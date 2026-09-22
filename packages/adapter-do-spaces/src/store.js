/**
 * Per-run adapter state, keyed by the physical Spaces destination.
 *
 * DEC-097 section 7's closed Spaces catalog has no object-`GET` row, so this
 * adapter cannot read an object's bytes back out of the provider at all: not
 * the stage record it used to write, not the staged payload `activate` used
 * to copy, not a historical generation `rollback` used to re-promote. What it
 * staged during *this run* it can honestly remember; what it did not stage in
 * this run it must be given, or refuse.
 *
 * This module is exactly that run-scoped memory. Nothing here is durable,
 * nothing here is authority over what is served, and `inspectDestination` and
 * `observe` always prefer a live public read over anything recorded here.
 *
 * @module
 */

import { domainDigest } from '@rathnasgala2/adapter-protocol';

import { DOMAIN_SPACES_DESTINATION } from './constants.js';

/**
 * @typedef {Readonly<{path: string, bytes: Buffer, immutable?: boolean}>} StagedFile
 */

/**
 * @typedef {Readonly<{
 *   stageToken: string,
 *   operationId: string,
 *   attemptId: string,
 *   idempotencyKey: string,
 *   generationId: string,
 *   artifactId: string,
 *   artifactDigest: string,
 *   operationPrefix: string,
 *   rootPrefix: string,
 *   entryPaths: readonly string[],
 *   byteCount: string,
 *   files: readonly StagedFile[]
 * }>} StageRecord
 */

/**
 * @typedef {{stages: Map<string, StageRecord>}} DestinationState
 */

/** @type {Map<string, DestinationState>} */
const STATE = new Map();

/**
 * Compute the physical destination mutation key: the exact bucket pair and
 * region this adapter mutates. A logical alias, a public base URL or a
 * credential never creates a second physical identity.
 *
 * @param {{region: string, servedBucket: string, stagingBucket: string}} destination
 *   the destination identity
 * @returns {string} the destination key digest
 */
export function destinationKey(destination) {
  return domainDigest(DOMAIN_SPACES_DESTINATION, {
    region: destination.region,
    servedBucket: destination.servedBucket,
    stagingBucket: destination.stagingBucket,
  });
}

/**
 * Get (creating on first use) the run-scoped state for one destination.
 *
 * @param {{region: string, servedBucket: string, stagingBucket: string}} destination
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
  const created = { stages: new Map() };
  STATE.set(key, created);
  return created;
}

/**
 * Recall one stage this run recorded, by its stage token.
 *
 * @param {{region: string, servedBucket: string, stagingBucket: string}} destination
 *   the destination identity
 * @param {string} stageToken the stage token
 * @returns {StageRecord | null} the record, or `null` when this run did not
 *   stage it
 */
export function recallStage(destination, stageToken) {
  return stateFor(destination).stages.get(stageToken) ?? null;
}

/**
 * Recall the stage this run recorded for one generation identity.
 *
 * @param {{region: string, servedBucket: string, stagingBucket: string}} destination
 *   the destination identity
 * @param {string} generationId the generation identity
 * @returns {StageRecord | null} the record, or `null`
 */
export function recallStageForGeneration(destination, generationId) {
  for (const record of stateFor(destination).stages.values()) {
    if (record.generationId === generationId) {
      return record;
    }
  }
  return null;
}

/**
 * Record one completed stage.
 *
 * @param {{region: string, servedBucket: string, stagingBucket: string}} destination
 *   the destination identity
 * @param {StageRecord} record the stage record
 * @returns {void}
 */
export function rememberStage(destination, record) {
  stateFor(destination).stages.set(record.stageToken, record);
}

/**
 * Discard all run-scoped state for one destination. Used by a test fixture's
 * teardown so one conformance destination can never leak into the next.
 *
 * @param {{region: string, servedBucket: string, stagingBucket: string}} destination
 *   the destination identity
 * @returns {void}
 */
export function forgetDestination(destination) {
  STATE.delete(destinationKey(destination));
}
