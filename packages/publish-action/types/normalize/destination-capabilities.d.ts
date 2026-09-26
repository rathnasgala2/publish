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
/**
 * The closed DEC-097 section 3 package-to-adapter-id mapping. The selected
 * row must match in both directions; no alias is admitted.
 */
export const ADAPTER_PACKAGES: Readonly<{
    '@rathnasgala2/adapter-local-directory': "local-directory";
    '@rathnasgala2/adapter-github-pages': "github-pages";
    '@rathnasgala2/adapter-do-spaces': "do-spaces";
}>;
