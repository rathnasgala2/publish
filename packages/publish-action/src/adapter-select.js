/**
 * Adapter selection for the GitHub Action deploy path. Only
 * `local-directory` is implemented in this repository; `github-pages` and
 * `do-spaces` selection fails closed with `TARGET_CAPABILITY_UNAVAILABLE`
 * until S2-T18/S2-T19 land (S2-T20 deliverable (3)).
 *
 * @module
 */

import { AdapterProtocolError, finding } from '@rathnasgala2/adapter-protocol';

import { ADAPTER_IDS, IMPLEMENTED_ADAPTER_ID } from './constants.js';

/**
 * Assert the author-selected adapter is the one this repository implements.
 * Throws {@link AdapterProtocolError} with a `TARGET_CAPABILITY_UNAVAILABLE`
 * finding for `github-pages`/`do-spaces` (valid closed-vocabulary members,
 * just not yet implemented here) and a distinct finding for any other,
 * unrecognized value.
 *
 * @param {string} adapterId the author-selected `adapter` input
 * @returns {void}
 */
export function assertImplementedAdapter(adapterId) {
  if (adapterId === IMPLEMENTED_ADAPTER_ID) {
    return;
  }
  if (ADAPTER_IDS.includes(adapterId)) {
    throw new AdapterProtocolError(
      `Adapter "${adapterId}" is a valid destination kind but is not yet implemented in this repository (S2-T18/S2-T19).`,
      [
        finding(
          'TARGET_CAPABILITY_UNAVAILABLE',
          'TARGET_CONSTRAINT_ERROR',
          `Adapter "${adapterId}" is not implemented; only "${IMPLEMENTED_ADAPTER_ID}" is available in this repository.`,
          { location: '/adapter' },
        ),
      ],
    );
  }
  throw new AdapterProtocolError(`Unknown adapter "${adapterId}".`, [
    finding(
      'TARGET_CAPABILITY_UNAVAILABLE',
      'TARGET_CONSTRAINT_ERROR',
      `"${adapterId}" is not one of the closed adapter identities (${ADAPTER_IDS.join(', ')}).`,
      { location: '/adapter' },
    ),
  ]);
}
