import path from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * Run an async command only when its module is the process entry point.
 *
 * @param {string} moduleUrl current module URL
 * @param {() => Promise<void>} command command entry point
 * @returns {Promise<void>} command completion
 */
export async function runIfMain(moduleUrl, command) {
  if (
    process.argv[1] !== undefined &&
    moduleUrl === pathToFileURL(path.resolve(process.argv[1])).href
  ) {
    await command();
  }
}
