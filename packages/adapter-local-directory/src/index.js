/**
 * `@rathnasgala2/adapter-local-directory`: the reference POSIX
 * local-directory deployment adapter and `gala-local-directory-filesystem-v2`
 * conformance oracle (S2-T17; DEC-097 section 7's `local-directory` row).
 * Every adapter-protocol lifecycle function is implemented against a
 * caller-supplied absolute `publicationRoot`; there is no ambient
 * configuration, network access or credential of any kind.
 *
 * See the package README for the destination-root layout this adapter owns
 * and for the documented, deliberate reductions from DEC-097's full
 * raw-syscall oracle (this package uses Node.js's path-based `fs`
 * primitives, not directory-fd-relative `*at()` syscalls, which Node does
 * not expose without a native addon).
 *
 * @module
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';

import {
  computeArtifactDigest as computeArtifactDigestFromFiles,
  domainDigest,
  fenceDisagrees,
  fenceFor,
  requireGenerationFence,
  sha256Hex,
} from '@rathnasgala2/adapter-protocol';

import { describeCapabilities as buildCapabilities } from './capability.js';
import {
  CURRENT_LINK,
  DOMAIN_ARTIFACT,
  GENERATION_MARKER_FILENAME,
  MAXIMUM_PRIOR_GENERATIONS_ON_DISK,
  RELEASES_DIR,
} from './constants.js';
import {
  assertNoEscapingSymlink,
  assertValidRoot,
  atomicSymlinkSwap,
  bootstrap,
  fsyncPath,
  removeContainedTree,
  writeFileDurably,
} from './fs-safety.js';
import {
  appendJournal,
  listReleaseGenerations,
  readHistory,
  readJournal,
  retainAndPersist,
} from './history.js';
import { buildGenerationMarker, validateGenerationMarker } from './marker.js';

export {
  EXPECT_NOTHING_SERVED,
  fenceFor,
  generateUuidV7,
} from '@rathnasgala2/adapter-protocol';

/**
 * @typedef {Readonly<{root: string}>} LocalDirectoryDestination
 */

/**
 * @typedef {Readonly<{path: string, bytes: Buffer}>} StagedFile
 */

/**
 * Validate and prepare a destination root: assert it is a safe absolute
 * POSIX directory and idempotently bootstrap the adapter's control
 * directories.
 *
 * @param {LocalDirectoryDestination} destination the caller-supplied
 *   destination
 * @returns {Promise<string>} the validated root path
 */
async function prepareRoot(destination) {
  if (!destination || typeof destination.root !== 'string') {
    throw new TypeError('destination.root (absolute path string) is required');
  }
  const root = await assertValidRoot(destination.root);
  await bootstrap(root);
  return root;
}

/**
 * `describeCapabilities`: the adapter's exact `adapter-capability:2.0.0`
 * declaration for the `local-directory` row, computed live against the
 * destination root.
 *
 * @param {LocalDirectoryDestination} destination the destination whose root
 *   this declaration is bound to
 * @returns {Promise<Readonly<Record<string, unknown>>>} the validated
 *   capability declaration
 */
export async function describeCapabilities(destination) {
  const root = await prepareRoot(destination);
  const rootStats = await fs.stat(root);
  return buildCapabilities({ destinationRoot: root, rootStats });
}

/**
 * `inspectDestination`: report the destination's currently active
 * generation (if any) and its retained on-disk generation history, without
 * mutating anything beyond idempotent bootstrap.
 *
 * @param {LocalDirectoryDestination} destination the destination to inspect
 * @returns {Promise<Readonly<{
 *   currentGenerationId: string | null,
 *   retainedHistory: readonly Readonly<Record<string, unknown>>[],
 *   releaseGenerationsOnDisk: readonly string[]
 * }>>} the inspection result
 */
export async function inspectDestination(destination) {
  const root = await prepareRoot(destination);
  const currentGenerationId = await readCurrentGenerationId(root);
  const retainedHistory = await readHistory(root);
  const releaseGenerationsOnDisk = await listReleaseGenerations(root);
  return Object.freeze({
    currentGenerationId,
    retainedHistory,
    releaseGenerationsOnDisk,
  });
}

/**
 * Read the generation identity `current` points at, or `null` when no
 * generation has ever been activated.
 *
 * @param {string} root the validated publication root
 * @returns {Promise<string | null>} the active generation identity, or
 *   `null`
 */
async function readCurrentGenerationId(root) {
  const target = await fs
    .readlink(path.join(root, CURRENT_LINK))
    .catch((/** @type {NodeJS.ErrnoException} */ error) => {
      if (error.code === 'ENOENT') {
        return null;
      }
      throw error;
    });
  if (target === null) {
    return null;
  }
  const prefix = `${RELEASES_DIR}/`;
  return target.startsWith(prefix) ? target.slice(prefix.length) : null;
}

/**
 * `preflight`: validate every declared manifest path with the on-disk
 * symlink-escape probe `publish-kernel`'s path-containment module defers to
 * this adapter, and report the destination's current generation for
 * concurrency fencing.
 *
 * @param {{
 *   destination: LocalDirectoryDestination,
 *   entries: readonly {path: string}[],
 *   expectedGenerationId?: string
 * }} input the preflight input; `expectedGenerationId`, when supplied, is
 *   an activation fence value (a generation identity or the protocol's
 *   `EXPECT_NOTHING_SERVED` sentinel) and is validated as one. `null` is
 *   refused, and a destination that serves nothing no longer silently
 *   satisfies an expectation of some generation (LOCAL-47).
 * @returns {Promise<Readonly<{
 *   verdict: 'proceed' | 'refuse',
 *   observedGenerationId: string | null,
 *   findings: readonly string[]
 * }>>} the preflight result
 */
export async function preflight(input) {
  const root = await prepareRoot(input.destination);
  /** @type {string[]} */
  const findings = [];
  for (const entry of input.entries) {
    await assertNoEscapingSymlink(
      root,
      path.join(RELEASES_DIR, entry.path),
    ).catch((/** @type {Error} */ error) => {
      findings.push(`${entry.path}: ${error.message}`);
    });
  }
  const observedGenerationId = await readCurrentGenerationId(root);
  if (input.expectedGenerationId !== undefined) {
    const fence = requireGenerationFence(
      input.expectedGenerationId,
      'local-directory',
    );
    if (fenceDisagrees(fence, observedGenerationId)) {
      findings.push(
        `expected generation ${JSON.stringify(input.expectedGenerationId)} disagrees with observed generation ${JSON.stringify(observedGenerationId)}`,
      );
    }
  }
  return Object.freeze({
    verdict: findings.length === 0 ? 'proceed' : 'refuse',
    observedGenerationId,
    findings: Object.freeze(findings),
  });
}

/**
 * `stage`: write a candidate generation's complete file set into a private,
 * unreachable staging directory (`staging: unreachable-generation`), plus
 * the generation marker. Idempotent: replaying the same
 * `operationId`/`attemptId`/`generationId` returns the existing stage
 * without rewriting bytes.
 *
 * @param {{
 *   destination: LocalDirectoryDestination,
 *   operationId: string,
 *   attemptId: string,
 *   idempotencyKey: string,
 *   generationId: string,
 *   artifactId: string,
 *   artifactDigest: string,
 *   files: readonly StagedFile[]
 * }} input the stage input
 * @returns {Promise<Readonly<{
 *   stageToken: string,
 *   stagedPath: string,
 *   fileCount: number,
 *   byteCount: string,
 *   idempotent: boolean
 * }>>} the stage result
 */
export async function stage(input) {
  const root = await prepareRoot(input.destination);

  const journal = await readJournal(root);
  const priorSameKey = journal.find(
    (entry) => entry.idempotencyKey === input.idempotencyKey,
  );
  if (priorSameKey !== undefined) {
    if (priorSameKey.artifactDigest !== input.artifactDigest) {
      throw new Error(
        `IDEMPOTENCY_KEY_REUSE_CONFLICT: idempotency key ${JSON.stringify(input.idempotencyKey)} was already used for a different artifact digest`,
      );
    }
    const stageToken = stageTokenFor(input);
    return Object.freeze({
      stageToken,
      stagedPath: path.join(root, RELEASES_DIR, `.gala-stage-${stageToken}`),
      fileCount: input.files.length,
      byteCount: totalBytes(input.files),
      idempotent: true,
    });
  }

  const stageToken = stageTokenFor(input);
  const stageDir = path.join(root, RELEASES_DIR, `.gala-stage-${stageToken}`);
  await assertNoEscapingSymlink(
    root,
    path.join(RELEASES_DIR, `.gala-stage-${stageToken}`),
  );

  for (const file of input.files) {
    await assertNoEscapingSymlink(
      root,
      path.join(RELEASES_DIR, `.gala-stage-${stageToken}`, file.path),
    );

    await writeFileDurably(path.join(stageDir, file.path), file.bytes);
  }

  const marker = buildGenerationMarker({
    artifactId: input.artifactId,
    artifactDigest: input.artifactDigest,
    generationId: input.generationId,
  });
  const markerValidation = validateGenerationMarker(marker);
  if (!markerValidation.valid) {
    throw new Error(
      `Generation marker failed schema validation: ${JSON.stringify(markerValidation.diagnostics)}`,
    );
  }
  await writeFileDurably(
    path.join(stageDir, GENERATION_MARKER_FILENAME),
    Buffer.from(JSON.stringify(marker), 'utf8'),
  );
  await fsyncPath(stageDir);

  await appendJournal(root, {
    operationId: input.operationId,
    attemptId: input.attemptId,
    idempotencyKey: input.idempotencyKey,
    artifactDigest: input.artifactDigest,
    generationId: input.generationId,
  });

  return Object.freeze({
    stageToken,
    stagedPath: stageDir,
    fileCount: input.files.length,
    byteCount: totalBytes(input.files),
    idempotent: false,
  });
}

/**
 * @param {{operationId: string, attemptId: string, generationId: string}} input
 *   the fields the stage token is derived from
 * @returns {string} a stable 32-character lowercase hexadecimal stage token
 */
function stageTokenFor(input) {
  return sha256Hex(
    Buffer.from(
      JSON.stringify({
        operationId: input.operationId,
        attemptId: input.attemptId,
        generationId: input.generationId,
      }),
      'utf8',
    ),
  )
    .replace('sha256:', '')
    .slice(0, 32);
}

/**
 * @param {readonly StagedFile[]} files staged files
 * @returns {string} the decimal total byte count across every file
 */
function totalBytes(files) {
  return files
    .reduce((sum, file) => sum + BigInt(file.bytes.byteLength), 0n)
    .toString(10);
}

/**
 * `activate`: promote a staged generation to `current` under the
 * `expected-generation` concurrency fence (`activation: pointer-swap`).
 * Never overwrites blindly: when the destination's currently observed
 * generation disagrees with `expectedCurrentGenerationId`, the candidate
 * reconciles instead of activating.
 *
 * `expectedCurrentGenerationId` is mandatory and is either a generation
 * identity or the protocol's `EXPECT_NOTHING_SERVED` sentinel. `null` and
 * `undefined` are refused with `EXPECTED_GENERATION_FENCE_INVALID`: under
 * adapter protocol 2.1.0 there is no value that silently disables the
 * activation fence (LOCAL-47).
 *
 * @param {{
 *   destination: LocalDirectoryDestination,
 *   stageToken: string,
 *   generationId: string,
 *   expectedCurrentGenerationId: string,
 *   expectedArtifactDigest?: string,
 *   crashInjectionHook?: () => void | Promise<void>
 * }} input the activate input; when `expectedArtifactDigest` is supplied,
 *   the staged bytes are re-walked and digested before promotion and
 *   activation refuses (never promoting a partial or tampered stage) on
 *   disagreement. `crashInjectionHook`, when supplied, is awaited after
 *   staging is durably committed into `releases/<generationId>` but
 *   strictly before the `current` pointer swap; a caller (only ever a
 *   conformance test — no production caller ever supplies this) uses it to
 *   prove a genuine interruption at that boundary never serves a partial
 *   generation. If it throws, `activate` propagates the error without
 *   swapping the pointer.
 * @returns {Promise<Readonly<{
 *   decision: 'activate' | 'reconcile',
 *   generationId: string,
 *   previousGenerationId: string | null,
 *   idempotent: boolean
 * }>>} the activation decision
 */
export async function activate(input) {
  const fence = requireGenerationFence(
    input.expectedCurrentGenerationId,
    'local-directory',
  );
  const root = await prepareRoot(input.destination);
  const observedGenerationId = await readCurrentGenerationId(root);

  if (observedGenerationId === input.generationId) {
    // Idempotent replay: this generation is already active.
    return Object.freeze({
      decision: 'activate',
      generationId: input.generationId,
      previousGenerationId: observedGenerationId,
      idempotent: true,
    });
  }

  if (fenceDisagrees(fence, observedGenerationId)) {
    return Object.freeze({
      decision: 'reconcile',
      generationId: input.generationId,
      previousGenerationId: observedGenerationId,
      idempotent: false,
    });
  }

  const stageDir = path.join(
    root,
    RELEASES_DIR,
    `.gala-stage-${input.stageToken}`,
  );

  if (input.expectedArtifactDigest !== undefined) {
    const stagedEntries = await walkGenerationEntries(stageDir);
    const stagedDigest = domainDigest(DOMAIN_ARTIFACT, stagedEntries);
    if (stagedDigest !== input.expectedArtifactDigest) {
      throw new Error(
        `STAGE_INTEGRITY_MISMATCH: staged bytes digest ${stagedDigest} disagree with expected artifact digest ${input.expectedArtifactDigest}; refusing to activate a partial or tampered stage`,
      );
    }
  }

  const releaseDir = path.join(root, RELEASES_DIR, input.generationId);
  const releaseExists = await fs
    .stat(releaseDir)
    .then(() => true)
    .catch(() => false);
  if (!releaseExists) {
    await assertNoEscapingSymlink(
      root,
      path.join(RELEASES_DIR, input.generationId),
    );
    await fs.rename(stageDir, releaseDir);
    await fsyncPath(path.join(root, RELEASES_DIR));
  }

  if (input.crashInjectionHook !== undefined) {
    // Staging is now durably committed (the generation directory exists
    // under `releases/`) but `current` has not moved yet: this is exactly
    // the boundary a real process crash could land on, and the only
    // caller ever allowed to reach this branch is a conformance test.
    await input.crashInjectionHook();
  }

  await atomicSymlinkSwap(
    path.join(root, CURRENT_LINK),
    path.join(RELEASES_DIR, input.generationId),
  );

  const markerText = await fs.readFile(
    path.join(releaseDir, GENERATION_MARKER_FILENAME),
    'utf8',
  );
  const marker = /** @type {{artifactDigest: string}} */ (
    JSON.parse(markerText)
  );
  const retainedHistory = await retainAndPersist(
    root,
    {
      generationId: input.generationId,
      artifactDigest: marker.artifactDigest,
      certifiedAt: new Date().toISOString(),
    },
    MAXIMUM_PRIOR_GENERATIONS_ON_DISK,
  );
  await sweepRetiredGenerations(root, retainedHistory);

  return Object.freeze({
    decision: 'activate',
    generationId: input.generationId,
    previousGenerationId: observedGenerationId,
    idempotent: false,
  });
}

/**
 * Physically remove every on-disk `releases/<generationId>` directory that
 * has fallen out of the retained history (duty 9's default: the active
 * generation plus five priors) after a successful activation. The
 * currently active generation is always the head of `retainedHistory`
 * (`retainAndPersist` inserts it there), so it is never a sweep candidate;
 * a generation still physically staged (`.gala-stage-*`) is never listed by
 * `listReleaseGenerations` in the first place. Every deletion goes through
 * `removeContainedTree`, which refuses to touch anything outside the
 * validated destination root.
 *
 * @param {string} root the validated publication root
 * @param {readonly import('./history.js').RetainedGenerationRecord[]} retainedHistory
 *   the just-pruned retained history (most-recent-first)
 * @returns {Promise<void>} resolves once every retired generation directory
 *   has been removed
 */
async function sweepRetiredGenerations(root, retainedHistory) {
  const retainedIds = new Set(
    retainedHistory.map((record) => record.generationId),
  );
  const onDisk = await listReleaseGenerations(root);
  for (const generationId of onDisk) {
    if (retainedIds.has(generationId)) {
      continue;
    }
    await removeContainedTree(
      root,
      path.join(root, RELEASES_DIR, generationId),
    );
  }
}

/**
 * `observe`: verify the currently served generation against its manifest-
 * equal artifact digest and its generation marker
 * (`providerInventoryAssurance: complete-artifact-digest`).
 *
 * @param {{
 *   destination: LocalDirectoryDestination,
 *   generationId: string,
 *   expectedArtifactDigest: string
 * }} input the observe input
 * @returns {Promise<Readonly<{
 *   verified: boolean,
 *   observedArtifactDigest: string,
 *   currentGenerationId: string | null,
 *   markerValid: boolean,
 *   findings: readonly string[]
 * }>>} the observation result
 */
export async function observe(input) {
  const root = await prepareRoot(input.destination);
  const currentGenerationId = await readCurrentGenerationId(root);
  const releaseDir = path.join(root, RELEASES_DIR, input.generationId);

  const entries = await walkGenerationEntries(releaseDir);
  const observedArtifactDigest = domainDigest(DOMAIN_ARTIFACT, entries);

  /** @type {string[]} */
  const findings = [];
  if (currentGenerationId !== input.generationId) {
    findings.push(
      `current points at ${JSON.stringify(currentGenerationId)}, not the observed generation ${JSON.stringify(input.generationId)}`,
    );
  }
  if (observedArtifactDigest !== input.expectedArtifactDigest) {
    findings.push(
      `observed artifact digest ${observedArtifactDigest} disagrees with expected ${input.expectedArtifactDigest}`,
    );
  }

  let markerValid = false;
  try {
    const markerText = await fs.readFile(
      path.join(releaseDir, GENERATION_MARKER_FILENAME),
      'utf8',
    );
    const marker = JSON.parse(markerText);
    const validation = validateGenerationMarker(marker);
    markerValid =
      validation.valid &&
      marker.generationId === input.generationId &&
      marker.artifactDigest === input.expectedArtifactDigest;
    if (!markerValid) {
      findings.push(
        'generation marker is missing, invalid or disagrees with the expected identity',
      );
    }
  } catch {
    findings.push('generation marker could not be read');
  }

  return Object.freeze({
    verified: findings.length === 0,
    observedArtifactDigest,
    currentGenerationId,
    markerValid,
    findings: Object.freeze(findings),
  });
}

/**
 * Walk a generation directory (excluding the reserved marker file) and
 * return its `{path,byteLength,sha256}` entries, UTF-8 path sorted — the
 * same closed shape and sort DEC-097 section 8 requires for artifact-digest
 * projection.
 *
 * @param {string} releaseDir the absolute generation directory
 * @returns {Promise<readonly {path: string, byteLength: string, sha256: string}[]>}
 *   the sorted entries
 */
async function walkGenerationEntries(releaseDir) {
  /** @type {{path: string, byteLength: string, sha256: string}[]} */
  const entries = [];

  /**
   * @param {string} relativeDir the directory, relative to `releaseDir`
   * @returns {Promise<void>} resolves once this subtree has been walked
   */
  async function walk(relativeDir) {
    const absoluteDir = path.join(releaseDir, relativeDir);
    const dirEntries = await fs.readdir(absoluteDir, { withFileTypes: true });
    for (const dirEntry of dirEntries) {
      const relativePath = path.join(relativeDir, dirEntry.name);
      if (dirEntry.isDirectory()) {
        await walk(relativePath);
      } else if (
        dirEntry.isFile() &&
        relativePath !== GENERATION_MARKER_FILENAME
      ) {
        const bytes = await fs.readFile(path.join(releaseDir, relativePath));
        entries.push({
          path: relativePath.split(path.sep).join('/'),
          byteLength: String(bytes.byteLength),
          sha256: sha256Hex(bytes),
        });
      }
    }
  }

  await walk('.');
  entries.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return entries;
}

/**
 * `cleanupStaged`: remove exactly this operation's private staging
 * scratch directory, never touching `current`, a selected release or
 * another operation's staging directory. When `generationId` is also
 * supplied, this additionally recovers an *abandoned* release directory
 * left behind by an activation interrupted after staging completed (the
 * `releases/<generationId>` rename already happened) but before the
 * pointer swap: that directory is only ever removed when it is neither the
 * currently active generation nor present in the retained
 * (activation-certified) history, so a genuinely completed activation can
 * never be cleaned up by this path.
 *
 * @param {{
 *   destination: LocalDirectoryDestination,
 *   stageToken: string,
 *   generationId?: string
 * }} input the cleanup input
 * @returns {Promise<Readonly<{removed: boolean}>>} whether the staging
 *   scratch directory, the abandoned release directory, or both were
 *   present and removed
 */
export async function cleanupStaged(input) {
  const root = await prepareRoot(input.destination);
  const stageDir = path.join(
    root,
    RELEASES_DIR,
    `.gala-stage-${input.stageToken}`,
  );
  const stageExisted = await fs
    .stat(stageDir)
    .then(() => true)
    .catch(() => false);
  if (stageExisted) {
    await removeContainedTree(root, stageDir);
  }

  let releaseExisted = false;
  if (input.generationId !== undefined) {
    const currentGenerationId = await readCurrentGenerationId(root);
    const retainedHistory = await readHistory(root);
    const isRetainedOrActive =
      input.generationId === currentGenerationId ||
      retainedHistory.some(
        (record) => record.generationId === input.generationId,
      );
    if (!isRetainedOrActive) {
      const abandonedReleaseDir = path.join(
        root,
        RELEASES_DIR,
        input.generationId,
      );
      releaseExisted = await fs
        .stat(abandonedReleaseDir)
        .then(() => true)
        .catch(() => false);
      if (releaseExisted) {
        await removeContainedTree(root, abandonedReleaseDir);
      }
    }
  }

  return Object.freeze({ removed: stageExisted || releaseExisted });
}

/**
 * `rollback`: `rollback: reupload` semantics — stage a fresh copy of a
 * retained prior generation's bytes under a new generation identity, then
 * activate it through the ordinary pointer-swap path. Refuses before any
 * mutation when the target generation is not physically retained on disk.
 *
 * @param {{
 *   destination: LocalDirectoryDestination,
 *   targetGenerationId: string,
 *   newGenerationId: string,
 *   newArtifactId: string,
 *   operationId: string,
 *   attemptId: string,
 *   idempotencyKey: string
 * }} input the rollback input
 * @returns {Promise<Readonly<{
 *   decision: 'activate' | 'reconcile',
 *   generationId: string,
 *   previousGenerationId: string | null,
 *   idempotent: boolean
 * }>>} the activation decision for the reuploaded generation
 */
export async function rollback(input) {
  const root = await prepareRoot(input.destination);
  const targetDir = path.join(root, RELEASES_DIR, input.targetGenerationId);
  const targetExists = await fs
    .stat(targetDir)
    .then(() => true)
    .catch(() => false);
  if (!targetExists) {
    throw new Error(
      `ROLLBACK_GENERATION_NOT_RETAINED: generation ${JSON.stringify(input.targetGenerationId)} is not retained on disk`,
    );
  }

  const entries = await walkGenerationEntries(targetDir);
  const artifactDigest = domainDigest(DOMAIN_ARTIFACT, entries);
  /** @type {StagedFile[]} */
  const files = [];
  for (const entry of entries) {
    const bytes = await fs.readFile(path.join(targetDir, entry.path));
    files.push({ path: entry.path, bytes });
  }

  const staged = await stage({
    destination: input.destination,
    operationId: input.operationId,
    attemptId: input.attemptId,
    idempotencyKey: input.idempotencyKey,
    generationId: input.newGenerationId,
    artifactId: input.newArtifactId,
    artifactDigest,
    files,
  });

  const currentGenerationId = await readCurrentGenerationId(root);
  return activate({
    destination: input.destination,
    stageToken: staged.stageToken,
    generationId: input.newGenerationId,
    expectedCurrentGenerationId: fenceFor(currentGenerationId),
  });
}

export { ADAPTER_VERSION } from './capability.js';

/** This package's runtime status: fully implemented per S2-T17. */
/**
 * Compute the same `GALA-ARTIFACT-V2 ` artifact digest `stage`/`activate`/
 * `observe` verify against, directly from an in-memory file set. Exported
 * so a caller (a test fixture, `publish-action`'s composition root, or the
 * conformance kit) can compute the correct `artifactDigest` to pass into
 * `stage` for a given file set, without duplicating the digest formula.
 *
 * PUB-M5: this is `@rathnasgala2/adapter-protocol`'s
 * `computeArtifactDigest`, the single implementation of the formula every
 * S2 destination adapter verifies against — this package restates nothing.
 *
 * @param {readonly StagedFile[]} files the complete file set
 * @returns {string} the `GALA-ARTIFACT-V2 ` artifact digest
 */
export function computeArtifactDigest(files) {
  return computeArtifactDigestFromFiles(files);
}

export const PACKAGE_STATUS = Object.freeze({
  name: '@rathnasgala2/adapter-local-directory',
  implemented: true,
  implementingTask: 'S2-T17',
});
