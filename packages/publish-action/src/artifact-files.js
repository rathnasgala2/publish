/**
 * Read every file an `artifact-manifest:2.0.0` instance names (routes plus
 * generated assets) into an in-memory file set, shared by `build`'s own
 * artifact-digest reporting and the Action path's deploy step.
 *
 * @module
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';

/**
 * @param {string} outputDirectory the rendered candidate output directory
 * @param {Record<string, unknown>} manifest the `artifact-manifest:2.0.0` instance
 * @returns {Promise<{path: string, bytes: Buffer}[]>} the complete file set
 */
export async function readManifestFileBytes(outputDirectory, manifest) {
  const routes = /** @type {{path: string}[]} */ (manifest.routes ?? []);
  const assets = /** @type {{path: string}[]} */ (manifest.assets ?? []);
  const entries = [...routes, ...assets];
  return Promise.all(
    entries.map(async (entry) => ({
      path: entry.path,
      bytes: await fs.readFile(path.join(outputDirectory, entry.path)),
    })),
  );
}
