/**
 * Replace every occurrence of every secret in one string.
 *
 * @param {string} text the text to scrub
 * @param {readonly (string | undefined)[]} secrets the secret byte strings
 * @returns {string} the scrubbed text
 */
export function scrubSecrets(text: string, secrets: readonly (string | undefined)[]): string;
/**
 * Collect every string that appears anywhere in a JSON-like value, including
 * object keys, so a secret cannot hide in a nested evidence member.
 *
 * @param {unknown} value the value to walk
 * @param {string[]} [into] the accumulator
 * @returns {string[]} every string found
 */
export function collectStrings(value: unknown, into?: string[]): string[];
/**
 * Refuse a value that carries any secret's bytes anywhere inside it.
 *
 * @param {unknown} value the value to check (evidence, headers, a body text)
 * @param {readonly (string | undefined)[]} secrets the secret byte strings
 * @param {string} label where the value is bound for, for the diagnostic
 * @returns {void}
 * @throws {Error} `PAGES_SECRET_LEAK_DETECTED` when a secret is present
 */
export function assertFreeOfSecrets(value: unknown, secrets: readonly (string | undefined)[], label: string): void;
/**
 * Run one function with every thrown message scrubbed of every secret.
 *
 * @template T
 * @param {readonly (string | undefined)[]} secrets the secret byte strings
 * @param {() => Promise<T>} run the function to run
 * @returns {Promise<T>} the function's result
 */
export function withRedactedFailures<T>(secrets: readonly (string | undefined)[], run: () => Promise<T>): Promise<T>;
/** The placeholder a redacted secret is replaced with. */
export const REDACTION_PLACEHOLDER: "[redacted]";
