/**
 * Adapter-owned on-disk retention bookkeeping: which generation directories
 * under `releases/` this adapter keeps physically present (the active
 * generation plus, by default, five priors), and the parallel idempotency
 * journal. This is distinct from `publish-kernel`'s duty-9
 * `retainCertifiedDigest`/`selectRetainedGeneration`, which operate over an
 * abstract digest history a *caller* persists; this module persists the
 * adapter's own record of which release directories physically exist on
 * this destination, so `cleanupStaged` and a future retention sweep know
 * what is safe to delete.
 *
 * @module
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';

import { HISTORY_FILE_RELATIVE, JOURNAL_FILE_RELATIVE } from './constants.js';
import { readJsonOr, writeFileDurably } from './fs-safety.js';

/**
 * @typedef {Readonly<{generationId: string, artifactDigest: string, certifiedAt: string}>} RetainedGenerationRecord
 */

/**
 * Read the retained-generation history, most-recent-first.
 *
 * @param {string} root the validated publication root
 * @returns {Promise<readonly RetainedGenerationRecord[]>} the retained
 *   history, or an empty array when none has been recorded yet
 */
export async function readHistory(root) {
  const parsed = await readJsonOr(path.join(root, HISTORY_FILE_RELATIVE), {
    records: [],
  });
  return /** @type {{records: RetainedGenerationRecord[]}} */ (parsed).records;
}

/**
 * Insert a newly certified generation at the head of the retained history
 * and prune anything beyond the retention cap, then persist the result
 * durably.
 *
 * @param {string} root the validated publication root
 * @param {RetainedGenerationRecord} record the record just certified
 * @param {number} maximumPriorGenerations retain the active record plus
 *   this many priors
 * @returns {Promise<readonly RetainedGenerationRecord[]>} the pruned
 *   history that was written, most-recent-first, and the identities of any
 *   generations pruned from the history (their directories are the
 *   caller's responsibility to remove, if desired)
 */
export async function retainAndPersist(root, record, maximumPriorGenerations) {
  const existing = await readHistory(root);
  const withoutDuplicate = existing.filter(
    (entry) => entry.generationId !== record.generationId,
  );
  const inserted = [record, ...withoutDuplicate];
  const pruned = inserted.slice(0, maximumPriorGenerations + 1);
  await writeFileDurably(
    path.join(root, HISTORY_FILE_RELATIVE),
    Buffer.from(JSON.stringify({ records: pruned }, null, 2), 'utf8'),
  );
  return pruned;
}

/**
 * @typedef {Readonly<{operationId: string, attemptId: string, idempotencyKey: string, artifactDigest: string, generationId: string}>} JournalEntry
 */

/**
 * Read the idempotency journal.
 *
 * @param {string} root the validated publication root
 * @returns {Promise<readonly JournalEntry[]>} the journal, or an empty
 *   array when none exists yet
 */
export async function readJournal(root) {
  const parsed = await readJsonOr(path.join(root, JOURNAL_FILE_RELATIVE), {
    entries: [],
  });
  return /** @type {{entries: JournalEntry[]}} */ (parsed).entries;
}

/**
 * Append one entry to the idempotency journal and persist it durably.
 *
 * @param {string} root the validated publication root
 * @param {JournalEntry} entry the entry to append
 * @returns {Promise<void>} resolves once the journal is durable
 */
export async function appendJournal(root, entry) {
  const existing = await readJournal(root);
  const next = [...existing, entry];
  await writeFileDurably(
    path.join(root, JOURNAL_FILE_RELATIVE),
    Buffer.from(JSON.stringify({ entries: next }, null, 2), 'utf8'),
  );
}

/**
 * List every generation directory name currently present under
 * `releases/`, excluding the private staging scratch directories.
 *
 * @param {string} root the validated publication root
 * @returns {Promise<readonly string[]>} the release generation directory
 *   names present on disk
 */
export async function listReleaseGenerations(root) {
  const releasesDir = path.join(root, 'releases');
  const entries = await fs
    .readdir(releasesDir, { withFileTypes: true })
    .catch(() => /** @type {import('node:fs').Dirent[]} */ ([]));
  return entries
    .filter(
      (entry) => entry.isDirectory() && !entry.name.startsWith('.gala-stage-'),
    )
    .map((entry) => entry.name);
}
