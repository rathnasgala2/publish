/**
 * Duty 5: "Secret handling: structural redaction; reject credential
 * exposure in artifact, intent, observation, receipt, log, command argument
 * or exception text."
 *
 * This module is deliberately conservative: it matches well-known
 * credential *shapes* (bearer/authorization headers, cloud access-key
 * patterns, PEM private-key blocks, long high-entropy tokens carried in a
 * recognized credential-bearing key name) rather than attempting semantic
 * secret detection. A false positive over-redacts; the kernel never under-
 * redacts silently.
 *
 * @module
 */

import { REDACTION_PLACEHOLDER as REDACTED } from '@rathnasgala2/adapter-protocol';

import { kernelFinding } from './errors.js';

/** Key names that make an otherwise-plain string value credential-bearing. */
const CREDENTIAL_KEY_PATTERN =
  /(secret|password|passwd|token|credential|apikey|api[_-]?key|access[_-]?key|private[_-]?key|bearer)/iu;

/** Value-shape patterns matched regardless of the surrounding key name. */
const CREDENTIAL_VALUE_PATTERNS = Object.freeze([
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/gu,
  /\bAKIA[0-9A-Z]{16}\b/gu,
  /\bBearer\s+[A-Za-z0-9._~+/-]{16,}=*/gu,
  /\bAuthorization:[ \t]*\S(?:.*\S)?/giu,
  /\bghp_[A-Za-z0-9]{36,}\b/gu,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/gu,
]);

/**
 * Recursively walk a JSON-compatible value, applying `visit` to every
 * string leaf and its JSON Pointer-style location, and returning a
 * structurally identical clone built from `visit`'s replacement.
 *
 * @param {unknown} value value to walk
 * @param {string} location JSON Pointer-style path accumulated so far
 * @param {(text: string, location: string) => string} visit called once per
 *   string leaf; returns the (possibly redacted) replacement string
 * @returns {unknown} the walked clone
 */
function walk(value, location, visit) {
  if (typeof value === 'string') {
    return visit(value, location);
  }
  if (Array.isArray(value)) {
    return value.map((entry, index) =>
      walk(entry, `${location}/${index}`, visit),
    );
  }
  if (value !== null && typeof value === 'object') {
    /** @type {Record<string, unknown>} */
    const out = {};
    for (const [key, entry] of Object.entries(value)) {
      const keyLocation = `${location}/${key}`;
      const replacement =
        CREDENTIAL_KEY_PATTERN.test(key) &&
        typeof entry === 'string' &&
        entry.length > 0
          ? REDACTED
          : walk(entry, keyLocation, visit);
      // `Object.entries` yields "__proto__" as a genuine own enumerable key
      // for a value produced by `JSON.parse`. A plain `out[key] = ...`
      // assignment for that key name goes through `Object.prototype`'s
      // `__proto__` accessor instead of creating an own property, which
      // both drops the credential subtree from the redacted clone and lets
      // the input set the clone's prototype. `Object.defineProperty` always
      // creates (or overwrites) an own data property, regardless of key
      // name, so "__proto__", "constructor" and "prototype" are redacted
      // and cloned like any other key.
      Object.defineProperty(out, key, {
        value: replacement,
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }
    return out;
  }
  return value;
}

/**
 * Redact every credential-value-shaped substring in one string.
 *
 * @param {string} text candidate string
 * @returns {string} the string with every matched credential shape replaced
 */
function redactString(text) {
  let out = text;
  for (const pattern of CREDENTIAL_VALUE_PATTERNS) {
    out = out.replaceAll(pattern, REDACTED);
  }
  return out;
}

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
export function redactSecrets(value) {
  return /** @type {T} */ (walk(value, '', (text) => redactString(text)));
}

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
export function findSecretExposure(value) {
  /** @type {import('./errors.js').KernelFinding[]} */
  const findings = [];
  walk(value, '', (text, location) => {
    if (
      CREDENTIAL_VALUE_PATTERNS.some((pattern) =>
        new RegExp(pattern.source, pattern.flags).test(text),
      )
    ) {
      findings.push(
        kernelFinding(
          'SECRET_EXPOSURE_DETECTED',
          'ARTIFACT_SAFETY_ERROR',
          `A credential-shaped value was found at "${location || '/'}".`,
          'Remove the credential from the artifact, intent, observation, receipt, log, command argument or exception text before retaining or transmitting it.',
          { location: location || '/' },
        ),
      );
    }
    return text;
  });
  walkKeys(value, '', findings);
  return Object.freeze(findings);
}

/**
 * Recursively scan object keys for a credential-bearing key name whose
 * value is a non-empty string, pushing one finding per occurrence.
 *
 * @param {unknown} value value to scan
 * @param {string} location JSON Pointer-style path accumulated so far
 * @param {import('./errors.js').KernelFinding[]} findings accumulator
 * @returns {void}
 */
function walkKeys(value, location, findings) {
  if (Array.isArray(value)) {
    value.forEach((entry, index) =>
      walkKeys(entry, `${location}/${index}`, findings),
    );
    return;
  }
  if (value === null || typeof value !== 'object') {
    return;
  }
  for (const [key, entry] of Object.entries(value)) {
    const keyLocation = `${location}/${key}`;
    if (
      CREDENTIAL_KEY_PATTERN.test(key) &&
      typeof entry === 'string' &&
      entry.length > 0
    ) {
      findings.push(
        kernelFinding(
          'SECRET_EXPOSURE_DETECTED',
          'ARTIFACT_SAFETY_ERROR',
          `A credential-bearing field "${key}" carries a non-empty plain-text value at "${keyLocation}".`,
          'Remove the credential from the artifact, intent, observation, receipt, log, command argument or exception text before retaining or transmitting it.',
          { location: keyLocation },
        ),
      );
      continue;
    }
    walkKeys(entry, keyLocation, findings);
  }
}
