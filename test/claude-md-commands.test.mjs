/**
 * PUB-L7 regression: `CLAUDE.md`'s "Commands" section used to list ten
 * commands and claim `npm run verify` "runs everything above, in order" --
 * `package.json`'s `verify` script actually ran four more. A contributor
 * who ran the documented list locally and saw green could still fail CI.
 *
 * This parses `package.json`'s `verify` script for every `npm run <name>`
 * it chains and asserts each one's exact command line
 * (`npm run <name>` or `npm run <name>:...`) appears somewhere in
 * `CLAUDE.md`'s "Commands" fenced code block, so the two cannot silently
 * drift apart again.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

/**
 * @returns {string[]} every `npm run <script>` name chained in the verify
 *   script, in order
 */
function verifyScriptNames() {
  const manifest = JSON.parse(readFileSync('package.json', 'utf8'));
  const verify = String(manifest.scripts.verify);
  const matches = [...verify.matchAll(/npm run ([a-z0-9:_-]+)/gu)];
  return matches.map((match) => String(match[1]));
}

/**
 * @returns {string} the fenced code block under CLAUDE.md's "## Commands"
 *   heading
 */
function commandsCodeBlock() {
  const claudeMd = readFileSync('CLAUDE.md', 'utf8');
  const section = claudeMd.split('## Commands')[1];
  assert.ok(section, 'CLAUDE.md must have a "## Commands" section');
  const fenced = /```sh\n([\s\S]*?)```/u.exec(section);
  assert.ok(fenced, 'the Commands section must contain a ```sh fenced block');
  const block = fenced[1];
  assert.ok(block, 'the fenced block capture must be non-empty');
  return block;
}

test('every command npm run verify chains is listed in CLAUDE.md', () => {
  const names = verifyScriptNames();
  assert.ok(names.length > 5, 'expected verify to chain several commands');
  const block = commandsCodeBlock();
  for (const name of names) {
    assert.match(
      block,
      new RegExp(`npm run ${name}(?:\\s|$)`, 'mu'),
      `CLAUDE.md's Commands block is missing "npm run ${name}"`,
    );
  }
});

test("CLAUDE.md's command list is not a stale subset (PUB-L7 regression)", () => {
  // The specific gates the 2026-09-25 review found missing.
  const block = commandsCodeBlock();
  for (const name of [
    'coverage:check',
    'sbom:check',
    'workflows:check',
    'workflows:drift',
    'schema-pin:check',
    'placeholder:check',
  ]) {
    assert.match(block, new RegExp(`npm run ${name}(?:\\s|$)`, 'mu'));
  }
});
