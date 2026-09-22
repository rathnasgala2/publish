/**
 * Secret redaction for the two credentials this adapter handles.
 *
 * DEC-097 section 7 is explicit and bidirectional: "The OIDC token never
 * appears in a header, evidence, digest, output or log; the GitHub token
 * never appears in the body. Redaction occurs before any structured
 * error/log serialization, and retained evidence records only body profile,
 * byte count and the non-secret artifact ID/build version."
 *
 * This module is the enforcement point rather than a convention. Every
 * evidence object and every error message that leaves `deployment.js` or
 * `recovery.js` passes through {@link assertFreeOfSecrets} or
 * {@link scrubSecrets}, so a future edit that accidentally interpolates a
 * credential fails a test instead of shipping.
 *
 * @module
 */

/** The placeholder a redacted secret is replaced with. */
export const REDACTION_PLACEHOLDER = '[redacted]';

/**
 * Replace every occurrence of every secret in one string.
 *
 * @param {string} text the text to scrub
 * @param {readonly (string | undefined)[]} secrets the secret byte strings
 * @returns {string} the scrubbed text
 */
export function scrubSecrets(text, secrets) {
  let scrubbed = text;
  for (const secret of secrets) {
    if (typeof secret !== 'string' || secret.length === 0) {
      continue;
    }
    scrubbed = scrubbed.split(secret).join(REDACTION_PLACEHOLDER);
  }
  return scrubbed;
}

/**
 * Collect every string that appears anywhere in a JSON-like value, including
 * object keys, so a secret cannot hide in a nested evidence member.
 *
 * @param {unknown} value the value to walk
 * @param {string[]} [into] the accumulator
 * @returns {string[]} every string found
 */
export function collectStrings(value, into = []) {
  if (typeof value === 'string') {
    into.push(value);
    return into;
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      collectStrings(entry, into);
    }
    return into;
  }
  if (value !== null && typeof value === 'object') {
    for (const [key, member] of Object.entries(value)) {
      into.push(key);
      collectStrings(member, into);
    }
  }
  return into;
}

/**
 * Refuse a value that carries any secret's bytes anywhere inside it.
 *
 * @param {unknown} value the value to check (evidence, headers, a body text)
 * @param {readonly (string | undefined)[]} secrets the secret byte strings
 * @param {string} label where the value is bound for, for the diagnostic
 * @returns {void}
 * @throws {Error} `PAGES_SECRET_LEAK_DETECTED` when a secret is present
 */
export function assertFreeOfSecrets(value, secrets, label) {
  const strings = collectStrings(value);
  for (const secret of secrets) {
    if (typeof secret !== 'string' || secret.length === 0) {
      continue;
    }
    if (strings.some((candidate) => candidate.includes(secret))) {
      throw new Error(
        `PAGES_SECRET_LEAK_DETECTED: a credential's bytes reached ${label}; DEC-097 section 7 forbids it`,
      );
    }
  }
}

/**
 * Run one function with every thrown message scrubbed of every secret.
 *
 * @template T
 * @param {readonly (string | undefined)[]} secrets the secret byte strings
 * @param {() => Promise<T>} run the function to run
 * @returns {Promise<T>} the function's result
 */
export async function withRedactedFailures(secrets, run) {
  try {
    return await run();
  } catch (error) {
    const original = /** @type {Error} */ (error);
    const scrubbed = scrubSecrets(String(original.message), secrets);
    if (scrubbed === original.message) {
      throw original;
    }
    const replacement = new Error(scrubbed);
    replacement.stack = scrubSecrets(String(original.stack ?? ''), secrets);
    throw replacement;
  }
}
