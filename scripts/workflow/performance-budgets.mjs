/**
 * Performance budgets for the frozen artifact (schemas 3.25.0).
 *
 * After the build is frozen this measures every `.html` page (bytes) and the
 * sum of the same-origin CSS and JS files each page links, counting each
 * file once per page. The result is informational: nothing here ever throws
 * to the caller or fails a publish. It feeds a GitHub job-summary table and
 * the `deployment-receipt` `performance` member shape.
 *
 * @module
 */

import { appendFile } from 'node:fs/promises';
import path from 'node:path';

/** The default budgets, matching the template's. */
export const DEFAULT_BUDGETS = Object.freeze({
  htmlBytes: 65536,
  cssBytes: 36864,
  jsBytes: 94208,
});

/** The most entries the receipt's `overBudget` list carries. */
export const MAXIMUM_OVER_BUDGET = 20;

/**
 * Count the `.html` files of an artifact (the page-loss guard's page count).
 *
 * @param {readonly {path: string}[]} files the frozen artifact files
 * @returns {number} the number of `.html` files
 */
export function countHtmlPages(files) {
  return files.filter((file) => file.path.toLowerCase().endsWith('.html'))
    .length;
}

/**
 * The effective budgets: the build input's
 * `publication.performance.budgets` members where present, the defaults
 * otherwise.
 *
 * @param {Record<string, any> | null | undefined} buildInput the normalized build input
 * @returns {{htmlBytes: number, cssBytes: number, jsBytes: number}} the budgets
 */
export function effectiveBudgets(buildInput) {
  const given = buildInput?.publication?.performance?.budgets ?? {};
  /** @type {Record<string, number>} */
  const budgets = { ...DEFAULT_BUDGETS };
  for (const name of Object.keys(DEFAULT_BUDGETS)) {
    if (Number.isInteger(given[name]) && given[name] >= 1024) {
      budgets[name] = given[name];
    }
  }
  return /** @type {{htmlBytes: number, cssBytes: number, jsBytes: number}} */ (
    budgets
  );
}

/**
 * Resolve a same-origin reference from a page to an artifact path, or null.
 *
 * @param {string} pagePath the page's artifact path
 * @param {string} reference the `href` or `src` value
 * @returns {string | null} the artifact path, or null for another origin
 */
function resolveReference(pagePath, reference) {
  const value = reference.trim();
  if (value === '' || /^[a-z][a-z0-9+.-]*:/iu.test(value)) {
    return null;
  }
  if (value.startsWith('//')) {
    return null;
  }
  const clean = value.split(/[?#]/u)[0] ?? '';
  if (clean === '') {
    return null;
  }
  const joined = clean.startsWith('/')
    ? path.posix.normalize(clean.slice(1))
    : path.posix.normalize(
        path.posix.join(path.posix.dirname(pagePath), clean),
      );
  return joined.startsWith('..') ? null : joined;
}

/**
 * The same-origin CSS and JS paths one page links.
 *
 * @param {string} pagePath the page's artifact path
 * @param {string} html the page text
 * @returns {{css: Set<string>, js: Set<string>}} the linked paths
 */
export function linkedAssets(pagePath, html) {
  const css = new Set();
  const js = new Set();
  for (const tag of html.match(/<link\b[^>]*>/giu) ?? []) {
    if (!/\brel\s*=\s*["']?[^"'>]*stylesheet/iu.test(tag)) {
      continue;
    }
    const href = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/iu.exec(tag);
    const target = resolveReference(
      pagePath,
      href === null ? '' : (href[1] ?? href[2] ?? href[3] ?? ''),
    );
    if (target !== null) {
      css.add(target);
    }
  }
  for (const tag of html.match(/<script\b[^>]*>/giu) ?? []) {
    const src = /\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/iu.exec(tag);
    if (src === null) {
      continue;
    }
    const target = resolveReference(pagePath, src[1] ?? src[2] ?? src[3] ?? '');
    if (target !== null) {
      js.add(target);
    }
  }
  return { css, js };
}

/**
 * Measure the artifact against the budgets.
 *
 * @param {readonly {path: string, bytes: Buffer}[]} files the frozen artifact files
 * @param {Record<string, any> | null | undefined} buildInput the normalized build input
 * @returns {{
 *   budgets: {htmlBytes: number, cssBytes: number, jsBytes: number},
 *   overBudgetCount: number,
 *   overBudget: {path: string, kind: 'html' | 'css' | 'js', bytes: number, budget: number}[],
 *   pageCount: number
 * }} the summary; `overBudget` is capped and largest first
 */
export function measurePerformance(files, buildInput) {
  const budgets = effectiveBudgets(buildInput);
  const size = new Map(files.map((file) => [file.path, file.bytes.byteLength]));
  /** @type {{path: string, kind: 'html' | 'css' | 'js', bytes: number, budget: number}[]} */
  const over = [];
  let pageCount = 0;
  for (const file of files) {
    if (!file.path.toLowerCase().endsWith('.html')) {
      continue;
    }
    pageCount += 1;
    if (file.bytes.byteLength > budgets.htmlBytes) {
      over.push({
        path: file.path,
        kind: 'html',
        bytes: file.bytes.byteLength,
        budget: budgets.htmlBytes,
      });
    }
    const { css, js } = linkedAssets(file.path, file.bytes.toString('utf8'));
    for (const [kind, set, budget] of /** @type {const} */ ([
      ['css', css, budgets.cssBytes],
      ['js', js, budgets.jsBytes],
    ])) {
      let total = 0;
      for (const target of set) {
        total += size.get(target) ?? 0;
      }
      if (total > budget) {
        over.push({ path: file.path, kind, bytes: total, budget });
      }
    }
  }
  over.sort((a, b) => b.bytes - a.bytes || a.path.localeCompare(b.path));
  return {
    budgets,
    overBudgetCount: over.length,
    overBudget: over.slice(0, MAXIMUM_OVER_BUDGET),
    pageCount,
  };
}

/**
 * The receipt's `performance` member: the measurement without the page count.
 *
 * @param {readonly {path: string, bytes: Buffer}[]} files the frozen artifact files
 * @param {Record<string, any> | null | undefined} buildInput the normalized build input
 * @returns {{budgets: Record<string, number>, overBudgetCount: number, overBudget: Record<string, unknown>[]}} the summary
 */
export function performanceSummary(files, buildInput) {
  const { budgets, overBudgetCount, overBudget } = measurePerformance(
    files,
    buildInput,
  );
  return { budgets, overBudgetCount, overBudget };
}

/**
 * Render the GitHub job-summary Markdown for one measurement.
 *
 * @param {ReturnType<typeof measurePerformance>} result the measurement
 * @returns {string} Markdown
 */
export function renderSummary(result) {
  const lines = [
    '### Page size check',
    '',
    `Budgets per page: HTML ${result.budgets.htmlBytes} bytes, CSS ${result.budgets.cssBytes} bytes, JavaScript ${result.budgets.jsBytes} bytes. This check never stops a publish.`,
    '',
  ];
  if (result.overBudgetCount === 0) {
    lines.push(`All ${result.pageCount} pages are within budget.`, '');
    return lines.join('\n');
  }
  lines.push(
    `${result.overBudgetCount} item(s) are larger than recommended${result.overBudgetCount > result.overBudget.length ? ` (showing the largest ${result.overBudget.length})` : ''}.`,
    '',
    '| Page | Kind | Bytes | Budget |',
    '| --- | --- | ---: | ---: |',
    ...result.overBudget.map(
      (entry) =>
        `| ${entry.path.replaceAll('|', '\\|')} | ${entry.kind} | ${entry.bytes} | ${entry.budget} |`,
    ),
    '',
  );
  return lines.join('\n');
}

/**
 * Measure, print and append the job summary. Never throws.
 *
 * @param {readonly {path: string, bytes: Buffer}[]} files the frozen artifact files
 * @param {Record<string, any> | null | undefined} buildInput the normalized build input
 * @returns {Promise<ReturnType<typeof measurePerformance> | null>} the measurement, or null when it could not run
 */
export async function reportPerformance(files, buildInput) {
  try {
    const result = measurePerformance(files, buildInput);
    const markdown = renderSummary(result);
    process.stdout.write(`${markdown}\n`);
    const summary = process.env.GITHUB_STEP_SUMMARY;
    if (summary !== undefined && summary !== '') {
      await appendFile(summary, `${markdown}\n`, 'utf8');
    }
    return result;
  } catch (error) {
    process.stdout.write(
      `page size check skipped: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    return null;
  }
}
