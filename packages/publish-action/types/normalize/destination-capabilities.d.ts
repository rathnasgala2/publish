/**
 * Select the one adapter row of a lock's `publisher` closure.
 *
 * @param {{publisher: readonly {package: string, version: string, integrity: string}[]}} lock
 *   the validated `lock:2.0.0` document
 * @returns {{package: string, version: string, integrity: string}} the
 *   selected adapter row
 */
export function selectLockedAdapterRow(lock: {
    publisher: readonly {
        package: string;
        version: string;
        integrity: string;
    }[];
}): {
    package: string;
    version: string;
    integrity: string;
};
/**
 * Build the `destinationCapabilityProfile` for the adapter the lock selects.
 *
 * @param {{
 *   lock: {publisher: readonly {package: string, version: string, integrity: string}[]},
 *   baseUrl: string
 * }} input the validated lock and the publication's canonical base
 * @returns {{
 *   adapter: {adapterId: string, adapterVersion: string, adapterDigest: string},
 *   baseUrl: string,
 *   capabilityDigest: string
 * }} the destination-capability profile
 */
export function destinationCapabilitiesFromLock(input: {
    lock: {
        publisher: readonly {
            package: string;
            version: string;
            integrity: string;
        }[];
    };
    baseUrl: string;
}): {
    adapter: {
        adapterId: string;
        adapterVersion: string;
        adapterDigest: string;
    };
    baseUrl: string;
    capabilityDigest: string;
};
export { ADAPTER_PACKAGES } from "../adapter-artifact-catalog.js";
