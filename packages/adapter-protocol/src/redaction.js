/**
 * The one redaction sentinel every package in this workspace uses for a
 * scrubbed secret value (PUB-L1). `publish-kernel` and `adapter-github-pages`
 * each defined their own placeholder independently
 * (`'[REDACTED]'`/`'[redacted]'`); an operator grepping logs for one missed
 * the other, and a test asserting redaction in one vocabulary passed against
 * the other's un-redacted output. Both now import this constant instead.
 *
 * @module
 */

/** The placeholder a redacted secret is replaced with, everywhere. */
export const REDACTION_PLACEHOLDER = '[REDACTED]';
