/**
 * Provider limit profile discrimination for `adapterProviderLimits`
 * (`oneOf(filesystemProviderLimits, httpProviderLimits)`, DEC-097 section 7).
 * Full structural and cross-field validity is the schema's job
 * (`capability.js` delegates to `@rathnasgala2/schemas`); this module gives
 * a caller a narrow, dependency-free way to discriminate which branch a
 * limits object is before reading transport-specific fields.
 *
 * @module
 */
/**
 * @typedef {Readonly<{
 *   transport: 'filesystem',
 *   filesystemProfile: 'gala-local-directory-filesystem-v2',
 *   filesystemAllowlistDigest: string,
 *   maximumFiles: string,
 *   maximumFileBytes: string,
 *   maximumArtifactBytes: string,
 *   maximumProviderCallSeconds: number,
 *   maximumPathBytes: number,
 *   pathRuleProfile: 'gala-portable-v2'
 * }>} FilesystemProviderLimits
 */
/**
 * @typedef {Readonly<{
 *   transport: 'http',
 *   maximumFiles: string,
 *   maximumFileBytes: string,
 *   maximumArtifactBytes: string,
 *   maximumProviderCallSeconds: number,
 *   maximumPathBytes: number,
 *   pathRuleProfile: 'gala-portable-v2'
 * } & Record<string, unknown>>} HttpProviderLimits
 */
/**
 * Test whether a value is shaped as the filesystem provider-limit branch.
 *
 * @param {unknown} limits candidate `limits` value
 * @returns {limits is FilesystemProviderLimits} whether it is the filesystem branch
 */
export function isFilesystemProviderLimits(limits: unknown): limits is FilesystemProviderLimits;
/**
 * Test whether a value is shaped as the HTTP provider-limit branch.
 *
 * @param {unknown} limits candidate `limits` value
 * @returns {limits is HttpProviderLimits} whether it is the HTTP branch
 */
export function isHttpProviderLimits(limits: unknown): limits is HttpProviderLimits;
export type FilesystemProviderLimits = Readonly<{
    transport: "filesystem";
    filesystemProfile: "gala-local-directory-filesystem-v2";
    filesystemAllowlistDigest: string;
    maximumFiles: string;
    maximumFileBytes: string;
    maximumArtifactBytes: string;
    maximumProviderCallSeconds: number;
    maximumPathBytes: number;
    pathRuleProfile: "gala-portable-v2";
}>;
export type HttpProviderLimits = Readonly<{
    transport: "http";
    maximumFiles: string;
    maximumFileBytes: string;
    maximumArtifactBytes: string;
    maximumProviderCallSeconds: number;
    maximumPathBytes: number;
    pathRuleProfile: "gala-portable-v2";
} & Record<string, unknown>>;
