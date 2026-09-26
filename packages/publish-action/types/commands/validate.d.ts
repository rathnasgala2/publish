/**
 * @param {{repositoryDirectory: string}} options the repository to validate
 * @returns {Promise<import('../types.js').ResultEnvelope>} the closed result envelope
 */
export function runValidate({ repositoryDirectory }: {
    repositoryDirectory: string;
}): Promise<import("../types.js").ResultEnvelope>;
