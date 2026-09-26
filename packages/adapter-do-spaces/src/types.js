/**
 * Type-only declarations shared across this package's source. This module
 * has no runtime behavior; `SpacesDestination` lives here rather than in
 * `index.js` so `control-plane.js` (which `index.js` imports from) can
 * reference it without creating a source-level import cycle between
 * `index.js` and `control-plane.js` (the two modules are already coupled
 * one direction; both depending on this leaf module instead keeps that
 * coupling acyclic, including in the generated `.d.ts` graph the
 * declaration-drift gate and the architecture gate both check).
 *
 * @module
 */

/**
 * @typedef {Readonly<{
 *   region: string,
 *   servedBucket: string,
 *   stagingBucket: string,
 *   accessKeyId: string,
 *   secretAccessKey: string,
 *   sessionToken?: string,
 *   publicBaseUrl?: string,
 *   controlPlaneEvidence?: Readonly<Record<string, unknown>>,
 *   fetch?: typeof globalThis.fetch,
 *   publicFetch?: typeof globalThis.fetch,
 *   onProviderCall?: (
 *     record: import('./s3.js').ProviderCallRecord
 *   ) => void
 * }>} SpacesDestination
 */

export {};
