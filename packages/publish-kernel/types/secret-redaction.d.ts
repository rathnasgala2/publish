/**
 * Deep-clone a JSON-compatible value, structurally redacting every
 * credential-bearing key's value and every credential-value-shaped
 * substring anywhere else. Safe to call on an artifact record, an intent,
 * an observation, a receipt, a log line, a command-argument list or
 * exception text before it is retained, logged or reported.
 *
 * @template T
 * @param {T} value the value to redact
 * @returns {T} a structurally identical, redacted clone
 */
export function redactSecrets<T>(value: T): T;
/**
 * Detect credential exposure without mutating the input: returns one
 * `ARTIFACT_SAFETY_ERROR` finding per location where a credential-bearing
 * key or a credential-shaped value was found. The kernel calls this before
 * an artifact, intent, observation, receipt, log line, command argument or
 * exception text is retained or transmitted, and refuses to proceed on any
 * finding (fail closed) rather than silently redacting and continuing.
 *
 * @param {unknown} value the candidate value (artifact record, intent,
 *   observation, receipt, log line, command-argument list or exception
 *   text) to scan
 * @returns {readonly import('./errors.js').KernelFinding[]} empty when no
 *   credential exposure was detected
 */
export function findSecretExposure(value: unknown): readonly import("./errors.js").KernelFinding[];
