/**
 * Build and validate this adapter's `adapter-capability:2.0.0` declaration,
 * running a live (reduced-iteration, honestly documented) filesystem probe
 * against `destinationRoot` to compute `filesystemEvidenceDigest`.
 *
 * @param {{destinationRoot: string, rootStats: import('node:fs').Stats}} context
 *   the validated destination root and its `stat` result
 * @returns {Promise<Readonly<Record<string, unknown>>>} the validated,
 *   digested capability declaration
 */
export function describeCapabilities(context: {
    destinationRoot: string;
    rootStats: import("node:fs").Stats;
}): Promise<Readonly<Record<string, unknown>>>;
/**
 * This adapter's installed package version, read from its own `package.json`
 * rather than restated by hand: DEC-097 section 3 requires the capability
 * document's `adapter.adapterVersion` to byte-equal the locked package
 * version, and the only value that can never drift from what a lock records
 * for this package is the version the package manifest itself declares.
 */
export const ADAPTER_VERSION: string;
