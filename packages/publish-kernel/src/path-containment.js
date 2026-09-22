/**
 * Duty 2: "Path containment: reject traversal, absolute or escaping paths,
 * escaping symlinks, devices, sockets, unsupported special files, unsafe
 * archive members, destructive Unicode or case collisions, reserved target
 * paths."
 *
 * The kernel checks the declared shape of every manifest entry the caller
 * hands it; it never touches a filesystem itself (a concrete adapter, such
 * as `adapter-local-directory` in S2-T17, is responsible for a corroborating
 * on-disk probe using its own POSIX profile). Every check here is a pure
 * string/kind evaluation over an explicit entry list.
 *
 * @module
 */

import { kernelFinding } from './errors.js';

/** Entry kinds the kernel ever admits as a staged artifact member. */
const ADMITTED_KINDS = Object.freeze(['file']);

/** Case-insensitive Windows/DOS reserved device names, checked stem-only. */
const RESERVED_STEMS = Object.freeze(
  new Set([
    'con',
    'prn',
    'aux',
    'nul',
    'com0',
    'com1',
    'com2',
    'com3',
    'com4',
    'com5',
    'com6',
    'com7',
    'com8',
    'com9',
    'lpt0',
    'lpt1',
    'lpt2',
    'lpt3',
    'lpt4',
    'lpt5',
    'lpt6',
    'lpt7',
    'lpt8',
    'lpt9',
  ]),
);

/** Reserved target path segments no artifact member may ever occupy. */
const RESERVED_SEGMENTS = Object.freeze(new Set(['.git', '.well-known']));

/**
 * @typedef {Readonly<{
 *   path: string,
 *   kind: 'file' | 'directory' | 'symlink' | 'device' | 'socket' | 'fifo' | 'other'
 * }>} ArtifactPathEntry
 */

/**
 * Check one path for traversal, absoluteness, NUL/backslash bytes and
 * non-NFC normalization (a source of case- and look-alike collisions).
 *
 * @param {string} entryPath candidate repository-relative path
 * @returns {string[]} zero or more short rule-violation labels
 */
function checkPathSyntax(entryPath) {
  /** @type {string[]} */
  const violations = [];
  if (entryPath.length === 0) {
    violations.push('empty');
    return violations;
  }
  if (entryPath.startsWith('/')) {
    violations.push('absolute');
  }
  if (entryPath.includes('\\')) {
    violations.push('backslash');
  }
  if (entryPath.includes('\x00')) {
    violations.push('nul-byte');
  }
  const segments = entryPath.split('/');
  if (segments.some((segment) => segment === '..')) {
    violations.push('traversal');
  }
  if (segments.some((segment) => segment === '.' || segment === '')) {
    violations.push('dot-or-empty-segment');
  }
  if (entryPath.normalize('NFC') !== entryPath) {
    violations.push('non-nfc');
  }
  for (const segment of segments) {
    const stem = segment.includes('.')
      ? segment.slice(0, segment.indexOf('.'))
      : segment;
    if (RESERVED_STEMS.has(stem.toLowerCase())) {
      violations.push('reserved-device-name');
    }
    if (RESERVED_SEGMENTS.has(segment)) {
      violations.push('reserved-target-path');
    }
  }
  return violations;
}

/**
 * Check an artifact's complete path set for containment safety: traversal,
 * absolute/escaping paths, disallowed member kinds (a symlink, device,
 * socket, fifo or any other non-regular-file archive member), destructive
 * Unicode normalization, case collisions and reserved target paths. The set
 * is evaluated as a whole so cross-entry collisions (two distinct declared
 * paths that collapse to the same case-folded or NFC form) are caught, not
 * only per-entry syntax.
 *
 * @param {readonly ArtifactPathEntry[]} entries the complete declared
 *   artifact member list
 * @returns {readonly import('./errors.js').KernelFinding[]} empty when
 *   every entry and the set as a whole is safe
 */
export function checkPathContainment(entries) {
  /** @type {import('./errors.js').KernelFinding[]} */
  const findings = [];
  /** @type {Map<string, string>} */
  const caseFoldedSeen = new Map();

  for (const entry of entries) {
    if (!ADMITTED_KINDS.includes(entry.kind)) {
      findings.push(
        kernelFinding(
          'ARTIFACT_MEMBER_KIND_UNSAFE',
          'ARTIFACT_SAFETY_ERROR',
          `Artifact member "${entry.path}" has kind "${entry.kind}"; only regular files are admitted as staged archive members.`,
          'Remove the symlink, device, socket, fifo or other special-file member from the artifact before freezing.',
          { location: entry.path, evidence: { kind: entry.kind } },
        ),
      );
    }

    const violations = checkPathSyntax(entry.path);
    for (const violation of violations) {
      findings.push(
        kernelFinding(
          `ARTIFACT_PATH_${violation.toUpperCase().replaceAll('-', '_')}`,
          'ARTIFACT_SAFETY_ERROR',
          `Artifact member path "${entry.path}" violates containment rule "${violation}".`,
          'Rewrite the artifact path to a normalized, relative, NFC-form path with no traversal, absolute, backslash, NUL or reserved segment.',
          { location: entry.path, evidence: { violation } },
        ),
      );
    }

    const caseFolded = entry.path.toLowerCase();
    const priorPath = caseFoldedSeen.get(caseFolded);
    if (priorPath !== undefined && priorPath !== entry.path) {
      findings.push(
        kernelFinding(
          'ARTIFACT_PATH_CASE_COLLISION',
          'ARTIFACT_SAFETY_ERROR',
          `Artifact member paths "${priorPath}" and "${entry.path}" collide under case-insensitive comparison.`,
          'Rename one of the colliding members; a case-insensitive destination filesystem cannot host both.',
          { location: entry.path, evidence: { with: priorPath } },
        ),
      );
    } else {
      caseFoldedSeen.set(caseFolded, entry.path);
    }
  }

  return Object.freeze(findings);
}
