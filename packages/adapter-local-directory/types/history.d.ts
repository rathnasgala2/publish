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
export function readHistory(root: string): Promise<readonly RetainedGenerationRecord[]>;
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
export function retainAndPersist(root: string, record: RetainedGenerationRecord, maximumPriorGenerations: number): Promise<readonly RetainedGenerationRecord[]>;
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
export function readJournal(root: string): Promise<readonly JournalEntry[]>;
/**
 * Append one entry to the idempotency journal and persist it durably.
 *
 * @param {string} root the validated publication root
 * @param {JournalEntry} entry the entry to append
 * @returns {Promise<void>} resolves once the journal is durable
 */
export function appendJournal(root: string, entry: JournalEntry): Promise<void>;
/**
 * List every generation directory name currently present under
 * `releases/`, excluding the private staging scratch directories.
 *
 * @param {string} root the validated publication root
 * @returns {Promise<readonly string[]>} the release generation directory
 *   names present on disk
 */
export function listReleaseGenerations(root: string): Promise<readonly string[]>;
export type RetainedGenerationRecord = Readonly<{
    generationId: string;
    artifactDigest: string;
    certifiedAt: string;
}>;
export type JournalEntry = Readonly<{
    operationId: string;
    attemptId: string;
    idempotencyKey: string;
    artifactDigest: string;
    generationId: string;
}>;
