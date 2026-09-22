/**
 * Constrained YAML frontmatter parsing (DEC-006
 * "Portable repository, content, extension and local-tool contract", line
 * ~7503: "Content uses UTF-8 Markdown with a bounded YAML frontmatter
 * block. Frontmatter is restricted to the JSON data model: string keys,
 * arrays, objects, booleans, finite numbers and null. Custom tags, anchors,
 * aliases, merge keys, duplicate keys, implicit timestamps, non-string keys
 * and executable/object construction are rejected."; line ~7672 explicitly
 * rejects a JSON-fence alternative in favor of this constrained YAML
 * subset).
 *
 * This module uses the pinned `yaml` 2.9.0 parser (the same version already
 * pinned by `@rathnasgala2/schemas`/`schema`) with the YAML 1.2 **core**
 * schema (plain scalars resolve to string/number/boolean/null the way JSON
 * would, with no timestamp/binary/set/merge-key extensions — those are
 * `yaml-1.1`-schema-only), then fails closed on every DEC-006-forbidden
 * construct the schema choice alone does not already rule out:
 *
 * - any parse error or warning (including an unresolved/custom tag, which
 *   `yaml` only ever reports as a warning, never an error, under `core`);
 * - a duplicate key (`uniqueKeys: true` reports this as a parse error);
 * - an anchor definition or alias reference, anywhere in the document
 *   (`core`/`json`/`yaml-1.1` all still resolve these; only an explicit
 *   AST walk rejects them);
 * - a non-string mapping key, or a `<<` merge key (`core` does not resolve
 *   a merge key into its target, but a literal `<<` key must still be
 *   rejected rather than silently kept as an ordinary field);
 * - a non-finite number (YAML core admits `.inf`/`.nan` plain scalars,
 *   which the JSON data model does not).
 *
 * @module
 */

import { isAlias, isScalar, parseDocument, visit } from 'yaml';

/** A frontmatter block that violates DEC-006's constrained YAML subset. */
export class FrontmatterParseError extends Error {
  /**
   * @param {string} message human-readable summary
   * @param {string} reasonCode a stable machine-readable reason
   */
  constructor(message, reasonCode) {
    super(message);
    this.name = 'FrontmatterParseError';
    this.reasonCode = reasonCode;
  }
}

/**
 * Walk a parsed YAML document's AST and reject an anchor, an alias, a
 * non-string mapping key or a literal `<<` merge key anywhere in it.
 *
 * @param {import('yaml').Document} document the parsed document
 * @returns {void}
 */
function assertNoForbiddenConstructs(document) {
  /** @type {string | false} */
  let violation = false;
  visit(document, {
    /**
     * @param {unknown} _key unused
     * @param {unknown} node the visited node
     * @returns {symbol | undefined} `visit.BREAK` once a violation is found
     */
    Value(_key, node) {
      if (isAlias(node)) {
        violation = 'FRONTMATTER_ALIAS_FORBIDDEN';
        return visit.BREAK;
      }
      if (
        node &&
        typeof node === 'object' &&
        /** @type {{anchor?: unknown}} */ (node).anchor
      ) {
        violation = 'FRONTMATTER_ANCHOR_FORBIDDEN';
        return visit.BREAK;
      }
      return undefined;
    },
    /**
     * @param {unknown} _key unused
     * @param {import('yaml').Pair} pair the visited key/value pair
     * @returns {symbol | undefined} `visit.BREAK` once a violation is found
     */
    Pair(_key, pair) {
      if (!isScalar(pair.key) || typeof pair.key.value !== 'string') {
        violation = 'FRONTMATTER_NON_STRING_KEY_FORBIDDEN';
        return visit.BREAK;
      }
      if (pair.key.value === '<<') {
        violation = 'FRONTMATTER_MERGE_KEY_FORBIDDEN';
        return visit.BREAK;
      }
      return undefined;
    },
  });
  if (violation) {
    throw new FrontmatterParseError(
      `Frontmatter uses a construct DEC-006's constrained YAML subset forbids (${violation}).`,
      violation,
    );
  }
}

/**
 * Recursively assert every value in a parsed frontmatter object is within
 * the JSON data model DEC-006 admits: string keys (already asserted during
 * the AST walk), arrays, plain objects, booleans, finite numbers and null.
 * Rejects `Infinity`/`-Infinity`/`NaN` (admitted by YAML core's `.inf`/
 * `.nan` plain scalars, not by the JSON data model), `Map`/`Set`/`Date`
 * instances and any other object construction `yaml`'s `toJS` could still
 * produce.
 *
 * @param {unknown} value a value from the parsed frontmatter tree
 * @returns {void}
 */
function assertJsonDataModel(value) {
  if (value === null) {
    return;
  }
  if (typeof value === 'string' || typeof value === 'boolean') {
    return;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new FrontmatterParseError(
        'Frontmatter contains a non-finite number (only finite numbers are admitted).',
        'FRONTMATTER_NON_FINITE_NUMBER_FORBIDDEN',
      );
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      assertJsonDataModel(entry);
    }
    return;
  }
  if (
    typeof value === 'object' &&
    value !== null &&
    Object.getPrototypeOf(value) === Object.prototype
  ) {
    for (const entry of Object.values(value)) {
      assertJsonDataModel(entry);
    }
    return;
  }
  throw new FrontmatterParseError(
    `Frontmatter contains a value outside the JSON data model (${Object.prototype.toString.call(value)}).`,
    'FRONTMATTER_NON_JSON_VALUE_FORBIDDEN',
  );
}

/**
 * Parse one bounded YAML frontmatter block under DEC-006's constrained
 * subset, failing closed on every forbidden construct.
 *
 * @param {string} yamlText the frontmatter block's raw text (without the
 *   `---` fence lines)
 * @returns {Record<string, unknown>} the parsed frontmatter, as a plain
 *   JSON-data-model object
 */
export function parseConstrainedYamlFrontmatter(yamlText) {
  const document = parseDocument(yamlText, {
    schema: 'core',
    strict: true,
    uniqueKeys: true,
    version: '1.2',
  });
  if (document.errors.length > 0 || document.warnings.length > 0) {
    const [issue] = [...document.errors, ...document.warnings];
    throw new FrontmatterParseError(
      `Frontmatter failed to parse under DEC-006's constrained YAML subset: ${issue?.message ?? 'unknown issue'}`,
      'FRONTMATTER_PARSE_FAILED',
    );
  }
  assertNoForbiddenConstructs(document);
  const parsed = document.toJS({ mapAsMap: false });
  assertJsonDataModel(parsed);
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    Array.isArray(parsed) ||
    Object.getPrototypeOf(parsed) !== Object.prototype
  ) {
    throw new FrontmatterParseError(
      'Frontmatter must parse to a JSON object at its root.',
      'FRONTMATTER_ROOT_NOT_OBJECT',
    );
  }
  return /** @type {Record<string, unknown>} */ (parsed);
}
