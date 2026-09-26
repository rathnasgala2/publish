/**
 * Build and validate the declaration for one bound destination.
 *
 * @param {{apiOrigin: string, fileCountCeiling?: number}} context the
 *   canonical GitHub REST origin this adapter is bound to
 * @returns {Readonly<Record<string, unknown>>} the validated declaration
 */
export function describeCapabilities(context: {
    apiOrigin: string;
    fileCountCeiling?: number;
}): Readonly<Record<string, unknown>>;
/**
 * The schema package's own `providerCallClassBinding` digest profile
 * (2.8.1). The inventory is typed as an open record, so the profile is
 * required here once, by name, and its absence is a refusal rather than an
 * `undefined` digest.
 *
 * @type {NonNullable<(typeof ACTIVE_DIGEST_PROFILES)['providerCallClassBinding']>}
 */
export const CALL_CLASS_BINDING_PROFILE: NonNullable<(typeof ACTIVE_DIGEST_PROFILES)["providerCallClassBinding"]>;
/** This adapter's stable identity digest. */
export const ADAPTER_DIGEST: string;
import { ACTIVE_DIGEST_PROFILES } from '@rathnasgala2/schemas/digest-profiles';
