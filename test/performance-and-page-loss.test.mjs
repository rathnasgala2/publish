/**
 * Page count, performance budgets and the page-loss refusal (schemas 3.25.0).
 */

import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { test } from 'node:test';

import {
  GalaApiError,
  postReceiptExchange,
} from '../scripts/workflow/gala-api.mjs';
import { pageLossMessage } from '../scripts/workflow/exchange.mjs';
import {
  DEFAULT_BUDGETS,
  countHtmlPages,
  linkedAssets,
  measurePerformance,
  renderSummary,
} from '../scripts/workflow/performance-budgets.mjs';

/**
 * @param {string} path the artifact path
 * @param {string} text the file text
 * @returns {{path: string, bytes: Buffer}} the file
 */
const file = (path, text) => ({ path, bytes: Buffer.from(text) });

test('countHtmlPages counts only .html files', () => {
  assert.equal(
    countHtmlPages([
      file('index.html', ''),
      file('a/b/index.html', ''),
      file('feed.xml', ''),
      file('a/index.md', ''),
    ]),
    2,
  );
});

test('linkedAssets resolves same-origin css and js and skips other origins', () => {
  const { css, js } = linkedAssets(
    'posts/x/index.html',
    '<link rel="stylesheet" href="/assets/a.css?v=1"><link rel="stylesheet" href="https://cdn.example/x.css">' +
      '<script src="../../assets/a.js"></script><script src="//cdn.example/y.js"></script><script>inline()</script>',
  );
  assert.deepEqual([...css], ['assets/a.css']);
  assert.deepEqual([...js], ['assets/a.js']);
});

test('measurePerformance uses defaults, counts a shared file once per page, caps and sorts', () => {
  const files = [
    file(
      'index.html',
      `<link rel="stylesheet" href="/a.css"><link rel="stylesheet" href="/a.css">${'x'.repeat(70000)}`,
    ),
    file('small.html', '<link rel="stylesheet" href="/a.css">'),
    file('a.css', 'c'.repeat(40000)),
  ];
  const result = measurePerformance(files, null);
  assert.deepEqual(result.budgets, DEFAULT_BUDGETS);
  assert.equal(result.pageCount, 2);
  assert.equal(result.overBudgetCount, 3);
  assert.deepEqual(
    result.overBudget.map((e) => [e.path, e.kind]),
    [
      ['index.html', 'html'],
      ['index.html', 'css'],
      ['small.html', 'css'],
    ],
  );
  assert.equal(result.overBudget[1]?.bytes, 40000);
});

test('measurePerformance honors build-input budgets and caps the list at 20', () => {
  const files = Array.from({ length: 25 }, (_, i) =>
    file(`p${i}/index.html`, 'x'.repeat(2000 + i)),
  );
  const result = measurePerformance(files, {
    publication: { performance: { budgets: { htmlBytes: 1024 } } },
  });
  assert.equal(result.budgets.htmlBytes, 1024);
  assert.equal(result.overBudgetCount, 25);
  assert.equal(result.overBudget.length, 20);
  assert.ok(
    (result.overBudget[0]?.bytes ?? 0) >= (result.overBudget[19]?.bytes ?? 1),
  );
  assert.match(renderSummary(result), /showing the largest 20/u);
});

test('renderSummary says all pages are within budget', () => {
  assert.match(
    renderSummary(measurePerformance([file('index.html', 'ok')], null)),
    /All 1 pages are within budget/u,
  );
});

test('a PAGE_LOSS_GUARD refusal carries its counts and the sentence names them', async () => {
  const server = createServer((_request, response) => {
    response.writeHead(409, { 'content-type': 'application/problem+json' });
    response.end(
      JSON.stringify({
        code: 'PAGE_LOSS_GUARD',
        details: {
          previousPageCount: 40,
          candidatePageCount: 10,
          lostPageCount: 30,
          permittedLoss: 8,
        },
      }),
    );
  });
  await new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () => resolve(undefined)),
  );
  try {
    const { port } = /** @type {import('node:net').AddressInfo} */ (
      server.address()
    );
    await assert.rejects(
      postReceiptExchange({
        origin: `http://127.0.0.1:${port}`,
        assertion: 'a.b.c',
        request: {},
      }),
      (error) => {
        assert.ok(error instanceof GalaApiError);
        assert.equal(error.problemCode, 'PAGE_LOSS_GUARD');
        assert.equal(error.pageLoss?.lostPageCount, 30);
        assert.equal(
          pageLossMessage(error.pageLoss),
          'Publish stopped: it would remove 30 of 40 pages from the live site. Nothing was deployed.',
        );
        return true;
      },
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
