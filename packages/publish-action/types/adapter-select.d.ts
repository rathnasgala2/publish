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
export function assertImplementedAdapter(adapterId: string): void;
