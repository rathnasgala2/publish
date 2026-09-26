/**
 * Serve `rootDirectory` read-only, bound to loopback only (`127.0.0.1`) on
 * an OS-assigned ephemeral port (`port: 0`) so `preview` never claims a
 * fixed, potentially-in-use port and never becomes reachable off the local
 * machine.
 *
 * @param {string} rootDirectory the absolute directory to serve
 * @returns {Promise<{url: string, close: () => Promise<void>}>} the bound
 *   preview server's URL and a teardown callback
 */
export function serveDirectoryReadOnly(rootDirectory: string): Promise<{
    url: string;
    close: () => Promise<void>;
}>;
/**
 * Build the repository, then serve the rendered candidate directory
 * read-only on loopback. Returns immediately once the server is listening;
 * the caller (the CLI, or a test) owns the server's lifetime through the
 * returned `close()`.
 *
 * @param {{
 *   repositoryDirectory: string,
 *   outputDirectory: string,
 *   workDirectory: string
 * }} options build inputs, identical to `build`
 * @returns {Promise<{
 *   envelope: Record<string, unknown>,
 *   server?: {url: string, close: () => Promise<void>}
 * }>} the build's result envelope (stamped with `previewUrl` on success) and
 *   the running server, when the build succeeded
 */
export function runPreview({ repositoryDirectory, outputDirectory, workDirectory, }: {
    repositoryDirectory: string;
    outputDirectory: string;
    workDirectory: string;
}): Promise<{
    envelope: Record<string, unknown>;
    server?: {
        url: string;
        close: () => Promise<void>;
    };
}>;
