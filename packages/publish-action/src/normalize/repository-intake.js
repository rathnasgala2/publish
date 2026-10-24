/**
 * Author-repository intake and normalization: build one validated
 * `urn:gala:schema:build-input:2.0.0` document from a repository directory
 * (S2-T20 deliverable (1)).
 *
 * The author-repository layout **is** authoritatively specified: DEC-006
 * "Portable repository, content, extension and local-tool contract" fixes
 * exactly two paths with format-level special meaning — the discovery
 * bootstrap `gala/repository.json` and the committed resolver output
 * `gala.lock.json` — and documents a *recommended* (not required) tree for
 * everything else, which this module follows:
 *
 * ```text
 * <repositoryDirectory>/
 *   gala/
 *     repository.json        # repository:2.0.0 (the fixed discovery path)
 *     publication.json        # publication:2.0.0
 *     navigation.json          # navigation:2.0.0
 *     appearance.json            # appearance:2.0.0
 *     authors/*.json               # one author:2.0.0 document per file
 *   gala.lock.json                   # lock:2.0.0 (the fixed lockfile path)
 *   content/*.md                       # bounded YAML frontmatter + Markdown
 * ```
 *
 * `repository.json`'s own `publication`/`navigation`/`appearance` fields
 * still carry the actual repository-relative paths (DEC-006: "Everything
 * else ... is referenced from the bootstrap manifest using
 * repository-relative paths"); this module reads whatever those fields
 * name, and the fixture/test repositories under `test/fixtures/` point them
 * at the recommended `gala/`-nested locations above.
 *
 * Each `content/*.md` file is UTF-8 Markdown with a bounded YAML
 * frontmatter block (DEC-006: "Content uses UTF-8 Markdown with a bounded
 * YAML frontmatter block"; a JSON-fence alternative was explicitly
 * considered and rejected — "Rejected initially. Supporting JSON/YAML/TOML
 * variants for the same record multiplies parsers ... JSON configuration
 * plus constrained YAML frontmatter supplies one deterministic contract").
 * The frontmatter block is delimited by `---` fence lines (the near-
 * universal Markdown-frontmatter convention DEC-006 does not itself
 * relitigate) and parsed by `frontmatter.js`'s constrained YAML parser —
 * pinned `yaml` 2.9.0, YAML 1.2 core schema, with anchors, aliases, merge
 * keys, duplicate keys, non-string keys and non-finite numbers all rejected
 * before the parsed frontmatter is schema-validated against
 * `content-frontmatter:2.0.0`:
 *
 * ```text
 * ---
 * schemaId: urn:gala:schema:content-frontmatter:2.0.0
 * ...
 * ---
 * # Heading
 *
 * Authored Markdown body.
 * ```
 *
 * Every authored document is schema-validated with
 * `@rathnasgala2/schemas`' `validateGalaDocument` before use (fail closed,
 * before any normalization proceeds). Every authored Markdown body is
 * normalized exactly once through `template`'s `normalizeAuthoredMarkdown`
 * (DEC-097 section 5's division of labour: `renderableBody.body` must
 * already be render-policy-conformant HTML by the time it reaches
 * `renderPublication`).
 *
 * **Documented scope reductions** (this package's own, not a DEC-006/
 * DEC-097 shortfall): `repository.json`'s `contentRoots`/
 * `generatedSourceRoots` globs are schema-validated but not evaluated as
 * globs — every `content/*.md` file is read directly, sorted by file name;
 * `publication.profile`/`footerCard`, `publication.contactRef` and
 * `appearance` font assets are not supported (a
 * fixture that sets any of them is rejected with a typed finding rather than
 * silently dropped); `placements` is always empty and `modules` carries only
 * `interactions` (read from `<repository.json "modules">/interactions.json`
 * when that file exists) and `analytics` (read from
 * `<repository.json "modules">/analytics.json` when that file exists),
 * matching S2's closed scope. A future task that needs the fuller author-repository
 * surface should replace this module rather than extend it ad hoc.
 *
 * **Content media** (`content-media.js`): every repository file that a
 * document body image (`![alt](path)`) or a front matter `hero.path` names
 * is checked (a path from the repository root, under an `assetRoots` entry,
 * a regular file, a PNG/JPEG/WebP/AVIF/GIF image, within the media limits)
 * and digested; the bytes stay on disk for the template's media pipeline. A
 * body image becomes an entry `{path, sourceDigest, mediaType, byteLength}`
 * of its document's `content[].media[]`, which is what the renderer resolves
 * the body's `<img src>` against; a hero becomes
 * `frontmatter.hero = {file: {path, sourceDigest}, alt, role}`. An unusable
 * reference fails the build with `MEDIA_REFERENCE_UNRESOLVED`, an over-limit
 * one with `MEDIA_LIMIT_EXCEEDED`. Only documents that are part of the build
 * are looked at.
 *
 * **Single-file images** (schemas 3.12.0): `publication.defaultImageRef`
 * becomes `publication.defaultImage`, `appearance.brandMark`/`wordmark` become
 * `appearance.brandMark`/`wordmark`, and content `socialImageRef` becomes
 * `frontmatter.socialImage`, each `{path, sourceDigest}`. They are checked by
 * the same code as a hero (a path from the repository root, under an asset
 * root, a regular file, a raster image within the limits; SVG is refused) but
 * fail with a code of their own: `PUBLICATION_DEFAULT_IMAGE_*`,
 * `APPEARANCE_BRAND_MARK_*`, `APPEARANCE_WORDMARK_*` or
 * `CONTENT_SOCIAL_IMAGE_*`, ending `_MISSING`, `_UNSUPPORTED_TYPE` or
 * `_UNRESOLVED`. `publication.crawlers` and content `seo` are copied through
 * (the build-input schema validates their members).
 *
 * **Appearance attribution**: `appearance.json`'s optional `attribution`
 * (`{showMadeWith}`) is copied into the build-input appearance; absent stays
 * absent.
 *
 * **Appearance tokens**: `appearance.json`'s `tokens` (`semanticTokens`, schemas
 * 3.10.0: optional `accent`, `canvas`, `text`, each `{light, dark}`) is copied
 * into the build-input appearance after schema validation; `{}` stays `{}`
 * (the theme's default palette). The template derives and checks the palette.
 *
 * **Staggered release** (schemas 3.19.0): a content file may carry the
 * optional `publishAfter` member (`YYYY-MM-DD`, a `status: draft` marker the
 * API writes). Intake validates its shape only; `normalizeContentFrontmatter`
 * copies an explicit list of members, so the value never reaches the
 * build-input or the template, on a draft (never built in publish mode) or on a
 * published file.
 *
 * **Policy pages** (schemas 3.16.0): `publication.json`'s optional `policies`
 * (`{terms, privacy}`, each `{title, body}` where `body` is the repository path
 * of a Markdown file) becomes `build-input.policies`, each page
 * `{title, body: <renderableBody>}`. Each file is read whole (it is not a
 * content record: no front matter, never in `content[]`, never an edition
 * source) and normalized by the same `normalizeAuthoredMarkdown`, render
 * policy identity, `text/html` media type and digests as a content body; the
 * body's `sourcePath` is the path as authored. Every unusable page is reported
 * together, each finding's `evidence` carrying `policy` and `path`:
 * `POLICY_BODY_MISSING` (the path does not exist, or is not a regular file; a
 * symbolic link is never accepted as the file itself),
 * `POLICY_BODY_UNSUPPORTED_TYPE` (the name does not end in `.md`, or the real
 * location of the file, after following symbolic links, is outside the
 * repository root), `POLICY_BODY_TOO_LARGE` (more than 131072 bytes, the API's
 * reader cap, which the contract carries as the same limit; `evidence` adds
 * `bytes` and `maxBytes`), `POLICY_BODY_EMPTY` (empty or whitespace only: the
 * GET contract requires a body of at least one character) and
 * `POLICY_BODY_IMAGE_UNSUPPORTED` (the rendered body contains an `<img>`
 * element, `evidence.images` counting them; a policy body has no media
 * inventory). The schema requires `body` to end in `.md` and refuses any other
 * name first, as a schema failure naming `publication.json`, so the intake's
 * own `.md` check is defence in depth. Without `policies` there is no
 * `policies` member.
 *
 * **Prism editions** (`content-editions.js`): a `kind: edition` document is
 * kept only when the article it is `of` is part of the build and its
 * `edition.sourceDigest` still equals the digest of that article's body;
 * otherwise it is left out with an `EDITION_SOURCE_MISSING` or
 * `EDITION_STALE` warning (see `options.warnings`). A kept edition carries
 * its `edition` front matter into the build input.
 *
 * @module
 */

import { lstat, readdir, realpath, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

import { ACTIVE_DIGEST_PROFILES } from '@rathnasgala2/schemas/digest-profiles';

import { assertValidDocument } from '../schema.js';
import { listRepositoryFiles, readFileWithDigest } from '../fs-util.js';
import {
  currentRenderPolicyIdentity,
  importTemplatePublicEntry,
} from '../template-bridge.js';
import { destinationCapabilitiesFromLock } from './destination-capabilities.js';
import { resolveBuildEpoch, resolveSourceRevision } from './source-revision.js';
import { parseConstrainedYamlFrontmatter } from './frontmatter.js';
import { REPOSITORY_ROOT_DOMAIN } from '../constants.js';
import { requireThemeArtifact, themePackageNameOf } from '../theme-catalog.js';
import { findImageSources, resolveMediaReferences } from './content-media.js';
import { evaluateEditions } from './content-editions.js';

const SCHEMA = Object.freeze({
  repository: 'urn:gala:schema:repository:2.0.0',
  lock: 'urn:gala:schema:lock:2.0.0',
  publication: 'urn:gala:schema:publication:2.0.0',
  author: 'urn:gala:schema:author:2.0.0',
  navigation: 'urn:gala:schema:navigation:2.0.0',
  appearance: 'urn:gala:schema:appearance:2.0.0',
  contentFrontmatter: 'urn:gala:schema:content-frontmatter:2.0.0',
  buildInput: 'urn:gala:schema:build-input:2.0.0',
  interactionsConfig: 'urn:gala:schema:interactions-config:2.0.0',
  analyticsConfig: 'urn:gala:schema:analytics-config:2.0.0',
});

const DEFAULT_INTERACTIONS_API_ORIGIN = 'https://api.galascribe.com';
const DEFAULT_INTERACTIONS_APP_ORIGIN = 'https://app.galascribe.com';

const LOCK_DIGEST_PROFILE = requireDigestProfile('lock');

/**
 * @param {string} name exported Schema digest-profile name
 * @returns {{digest: (value: unknown) => string}} the required profile
 */
function requireDigestProfile(name) {
  const profile = ACTIVE_DIGEST_PROFILES[name];
  if (profile === undefined) {
    throw new Error(
      `REPOSITORY_INTAKE_DIGEST_PROFILE_MISSING: @rathnasgala2/schemas/digest-profiles exports no ${name} profile`,
    );
  }
  return profile;
}

/** A typed intake failure: the author repository does not satisfy this package's documented convention or a referenced schema. */
export class RepositoryIntakeError extends Error {
  /**
   * @param {string} message human-readable summary
   * @param {readonly import('../types.js').PublishActionFinding[]} findings typed findings
   */
  constructor(message, findings = []) {
    super(message);
    this.name = 'RepositoryIntakeError';
    this.findings = Object.freeze([...findings]);
  }
}

/**
 * @param {string} code stable finding code
 * @param {string} detail human-readable detail
 * @param {Record<string, unknown>} [evidence] optional evidence
 * @returns {import('../types.js').PublishActionFinding} one typed
 *   finding, matching this package's shared finding shape (see `result.js`)
 */
function sourceFinding(code, detail, evidence) {
  return {
    code,
    severity: 'SOURCE_ERROR',
    detail,
    recovery: 'Fix the referenced author-repository file and retry.',
    overridable: false,
    ...(evidence ? { evidence } : {}),
  };
}

/**
 * Project a `lock.json` package/publisher entry (which may carry extra
 * `lockedPackage`/`lockedTemplate` fields such as `contractVersion`,
 * `compatibleWith` or `templateModules`) down to the exact four-field
 * `packageIdentity` shape `build-input.packages` requires.
 *
 * @param {{package: string, version: string, integrity: string, registry: string}} entry
 *   a lock.json package entry
 * @returns {{package: string, version: string, integrity: string, registry: string}}
 *   the projected package identity
 */
function projectPackageIdentity(entry) {
  return {
    package: entry.package,
    version: entry.version,
    integrity: entry.integrity,
    registry: entry.registry,
  };
}

/**
 * Read and schema-validate one JSON document from the repository.
 *
 * @param {string} repositoryDirectory absolute repository root
 * @param {string} relativePath repository-relative path
 * @param {string} schemaId the schema to validate against
 * @returns {Promise<{document: any, bytes: Buffer, digest: string}>} the
 *   parsed, validated document plus its raw bytes and digest
 */
async function readValidatedJson(repositoryDirectory, relativePath, schemaId) {
  const absolutePath = path.join(repositoryDirectory, relativePath);
  const { bytes, digest } = await readFileWithDigest(absolutePath);
  let parsed;
  try {
    parsed = JSON.parse(bytes.toString('utf8'));
  } catch (error) {
    throw new RepositoryIntakeError(`${relativePath} is not valid JSON`, [
      sourceFinding(
        'REPOSITORY_FILE_NOT_JSON',
        `${relativePath}: ${/** @type {Error} */ (error).message}`,
      ),
    ]);
  }
  assertValidDocument(schemaId, parsed, relativePath);
  return { document: parsed, bytes, digest };
}

/**
 * Resolve one interactions origin from an environment value.
 *
 * Accepts an `https:` origin, or an `http:` origin only for `localhost` or
 * `127.0.0.1` (the local stack). The value must be a bare origin: no
 * credentials, path, query or fragment.
 *
 * @param {string} name the environment variable name (for messages)
 * @param {string | undefined} value the raw environment value
 * @param {string} fallback the production default
 * @returns {string} the normalized origin
 */
export function resolveInteractionsOrigin(name, value, fallback) {
  if (value === undefined || value === '') {
    return fallback;
  }
  let url;
  try {
    url = new URL(value);
  } catch {
    url = null;
  }
  const isLocalHttp =
    url !== null &&
    url.protocol === 'http:' &&
    (url.hostname === 'localhost' || url.hostname === '127.0.0.1');
  const bare =
    url !== null &&
    url.username === '' &&
    url.password === '' &&
    url.pathname === '/' &&
    url.search === '' &&
    url.hash === '' &&
    !value.endsWith('?') &&
    !value.endsWith('#');
  if (url === null || !bare || (url.protocol !== 'https:' && !isLocalHttp)) {
    throw new RepositoryIntakeError(
      `${name} must be an https origin (or an http localhost/127.0.0.1 origin) with no path, query or fragment`,
      [sourceFinding('INTERACTIONS_ORIGIN_INVALID', name)],
    );
  }
  return url.origin;
}

/**
 * Read `<modules directory>/interactions.json` when it exists.
 *
 * @param {string} repositoryDirectory absolute repository root
 * @param {string} modulesDirectory `repository.json`'s `modules` path
 * @param {NodeJS.ProcessEnv} env the process environment
 * @returns {Promise<{config: unknown, apiOrigin: string, appOrigin: string} | null>}
 *   the module selection, or `null` when the file is absent
 */
async function readInteractionsModule(
  repositoryDirectory,
  modulesDirectory,
  env,
) {
  const relativePath = path.posix.join(
    modulesDirectory.replace(/\\/gu, '/'),
    'interactions.json',
  );
  try {
    await stat(path.join(repositoryDirectory, relativePath));
  } catch (error) {
    if (/** @type {NodeJS.ErrnoException} */ (error).code === 'ENOENT') {
      return null;
    }
    throw error;
  }
  const doc = await readValidatedJson(
    repositoryDirectory,
    relativePath,
    SCHEMA.interactionsConfig,
  );
  // JSON Schema cannot express "unique by property"; spec section 3 requires
  // unique reaction keys and unique orders.
  for (const field of ['key', 'order']) {
    const seen = new Set();
    for (const definition of doc.document.reactions.definitions) {
      if (seen.has(definition[field])) {
        throw new RepositoryIntakeError(
          `${relativePath}: reactions.definitions[].${field} must be unique (duplicate ${JSON.stringify(definition[field])})`,
          [
            sourceFinding(
              'INTERACTIONS_REACTION_DUPLICATE',
              `${relativePath}: duplicate ${field}`,
              { path: relativePath, field },
            ),
          ],
        );
      }
      seen.add(definition[field]);
    }
  }
  return {
    config: doc.document,
    apiOrigin: resolveInteractionsOrigin(
      'GALA_API_ORIGIN',
      env.GALA_API_ORIGIN,
      DEFAULT_INTERACTIONS_API_ORIGIN,
    ),
    appOrigin: resolveInteractionsOrigin(
      'GALA_APP_ORIGIN',
      env.GALA_APP_ORIGIN,
      DEFAULT_INTERACTIONS_APP_ORIGIN,
    ),
  };
}

/**
 * Read `<modules directory>/analytics.json` when it exists. The schema is
 * closed, so schema validation is the only check.
 *
 * @param {string} repositoryDirectory absolute repository root
 * @param {string} modulesDirectory `repository.json`'s `modules` path
 * @returns {Promise<{config: unknown} | null>} the module selection, or `null`
 *   when the file is absent
 */
async function readAnalyticsModule(repositoryDirectory, modulesDirectory) {
  const relativePath = path.posix.join(
    modulesDirectory.replace(/\\/gu, '/'),
    'analytics.json',
  );
  try {
    await stat(path.join(repositoryDirectory, relativePath));
  } catch (error) {
    if (/** @type {NodeJS.ErrnoException} */ (error).code === 'ENOENT') {
      return null;
    }
    throw error;
  }
  const doc = await readValidatedJson(
    repositoryDirectory,
    relativePath,
    SCHEMA.analyticsConfig,
  );
  return { config: doc.document };
}

/**
 * Split one `content/*.md` file into its bounded YAML frontmatter block's
 * raw text and the raw Markdown body, per DEC-006's "UTF-8 Markdown with a
 * bounded YAML frontmatter block" (the `---`/`---` fence is the near-
 * universal Markdown-frontmatter delimiter convention; DEC-006 fixes the
 * frontmatter's content model, not this specific fence spelling).
 *
 * @param {string} text the file's UTF-8 text
 * @param {string} relativePath repository-relative path, for error messages
 * @returns {{frontmatterText: string, body: string, rawBody: string}} the
 *   split parts. `body` is what is rendered (leading empty lines removed);
 *   `rawBody` is everything after the closing fence line, unmodified, which
 *   is what an edition's `sourceDigest` is taken over (see
 *   `content-editions.js`).
 */
function splitFrontmatterFence(text, relativePath) {
  const lines = text.split('\n');
  if (lines[0] !== '---') {
    throw new RepositoryIntakeError(
      `${relativePath} must start with a "---" YAML frontmatter fence`,
      [sourceFinding('CONTENT_FRONTMATTER_FENCE_MISSING', relativePath)],
    );
  }
  const closingIndex = lines.indexOf('---', 1);
  if (closingIndex === -1) {
    throw new RepositoryIntakeError(
      `${relativePath}'s "---" YAML frontmatter fence is never closed with "---"`,
      [sourceFinding('CONTENT_FRONTMATTER_FENCE_UNCLOSED', relativePath)],
    );
  }
  const frontmatterText = lines.slice(1, closingIndex).join('\n');
  const rawBody = lines.slice(closingIndex + 1).join('\n');
  return { frontmatterText, body: rawBody.replace(/^\n+/u, ''), rawBody };
}

/**
 * The most bytes a policy page's Markdown file may have: the API's reader cap,
 * which the contract carries as the same limit.
 */
const MAX_POLICY_BODY_BYTES = 131072;

/**
 * @param {string} child an absolute path
 * @param {string} parent an absolute path
 * @returns {boolean} whether `child` is `parent` or inside it
 */
function isWithinDirectory(child, parent) {
  return child === parent || child.startsWith(`${parent}${path.sep}`);
}

/**
 * Check and read one policy page's Markdown file.
 *
 * @param {string} repositoryDirectory absolute repository root
 * @param {string} realRepository the repository root after resolving symbolic links
 * @param {string} bodyPath `publication.json` `policies.<page>.body`
 * @returns {Promise<{reason: 'MISSING' | 'UNSUPPORTED_TYPE' | 'TOO_LARGE' | 'EMPTY', explanation: string, evidence?: Record<string, unknown>} | {bytes: Buffer, digest: string, text: string}>}
 *   the file's bytes, digest and decoded text, or why it cannot be used
 */
async function readPolicyBodyFile(
  repositoryDirectory,
  realRepository,
  bodyPath,
) {
  if (!bodyPath.endsWith('.md')) {
    return {
      reason: 'UNSUPPORTED_TYPE',
      explanation: 'is not a Markdown file (its name must end in ".md")',
    };
  }
  const absolute = path.join(repositoryDirectory, ...bodyPath.split('/'));
  /** @type {string} */
  let real;
  try {
    real = await realpath(absolute);
  } catch (error) {
    const code = /** @type {NodeJS.ErrnoException} */ (error).code;
    if (
      code === 'ENOENT' ||
      code === 'ENOTDIR' ||
      code === 'ELOOP' ||
      code === 'ENAMETOOLONG'
    ) {
      return {
        reason: 'MISSING',
        explanation: 'does not exist in the repository',
      };
    }
    throw error;
  }
  // The schema's path type has no `..` segment, so the only way out of the
  // repository is a symbolic link; its real location decides.
  if (!isWithinDirectory(real, realRepository)) {
    return {
      reason: 'UNSUPPORTED_TYPE',
      explanation: 'is outside the repository',
    };
  }
  // `lstat`, not `stat`: a symbolic link is never followed.
  const stats = await lstat(absolute);
  if (!stats.isFile()) {
    return { reason: 'MISSING', explanation: 'is not a regular file' };
  }
  // Checked before the read, so an oversized file is never held in memory.
  if (stats.size > MAX_POLICY_BODY_BYTES) {
    return {
      reason: 'TOO_LARGE',
      explanation: `is ${stats.size} bytes, more than the ${MAX_POLICY_BODY_BYTES}-byte limit`,
      evidence: { bytes: stats.size, maxBytes: MAX_POLICY_BODY_BYTES },
    };
  }
  const read = await readFileWithDigest(absolute);
  const text = read.bytes.toString('utf8');
  // The GET contract requires a body of at least one character.
  if (text.trim() === '') {
    return {
      reason: 'EMPTY',
      explanation: 'is empty or contains only whitespace',
    };
  }
  return { ...read, text };
}

/**
 * Read and render `publication.json`'s `policies` into `build-input.policies`.
 * Every unusable page is reported together.
 *
 * @param {object} options the inputs
 * @param {string} options.repositoryDirectory absolute repository root
 * @param {string} options.publicationPath repository-relative path of `publication.json`, for messages
 * @param {Record<string, {title: string, body: string}> | undefined} options.policies the authored `policies`, or `undefined` when absent
 * @param {(source: string) => {html: string, bodyDigest: string}} options.normalizeAuthoredMarkdown the template's Markdown normalizer
 * @param {{name: string, version: string, digest: string}} options.renderPolicy the current render policy identity
 * @returns {Promise<Record<string, {title: string, body: Record<string, unknown>}> | null>}
 *   the normalized pages, or `null` when the publication has no `policies`
 */
async function readPolicyPages({
  repositoryDirectory,
  publicationPath,
  policies,
  normalizeAuthoredMarkdown,
  renderPolicy,
}) {
  if (policies === undefined) {
    return null;
  }
  const realRepository = await realpath(repositoryDirectory);
  /** @type {Record<string, {title: string, body: Record<string, unknown>}>} */
  const pages = {};
  /** @type {import('../types.js').PublishActionFinding[]} */
  const findings = [];
  for (const key of /** @type {const} */ (['terms', 'privacy'])) {
    const page = /** @type {{title: string, body: string}} */ (policies[key]);
    const read = await readPolicyBodyFile(
      repositoryDirectory,
      realRepository,
      page.body,
    );
    if ('reason' in read) {
      const recoveries = {
        MISSING: `Add the Markdown file at that path, or point policies.${key}.body at an existing .md file.`,
        UNSUPPORTED_TYPE: `Point policies.${key}.body at a Markdown (.md) file inside the repository.`,
        TOO_LARGE: `Shorten the policy page to at most ${MAX_POLICY_BODY_BYTES} bytes.`,
        EMPTY: `Write the policy text in the Markdown file, or point policies.${key}.body at a file that has some.`,
      };
      findings.push({
        ...sourceFinding(
          `POLICY_BODY_${read.reason}`,
          `${publicationPath}: policies.${key}.body "${page.body}" ${read.explanation}.`,
          { policy: key, path: page.body, ...read.evidence },
        ),
        location: publicationPath,
        recovery: recoveries[read.reason],
      });
      continue;
    }
    const normalized = normalizeAuthoredMarkdown(read.text);
    // A policy body has no media inventory and the template fails closed on an
    // image in one, so refuse it here with a finding the author can act on.
    const images = findImageSources(normalized.html);
    if (images.length > 0) {
      findings.push({
        ...sourceFinding(
          'POLICY_BODY_IMAGE_UNSUPPORTED',
          `${page.body}: a policy page cannot contain images (found ${images.length}).`,
          { policy: key, path: page.body, images: images.length },
        ),
        location: page.body,
        recovery: 'Remove the image from the policy page and retry.',
      });
      continue;
    }
    pages[key] = {
      title: page.title,
      body: {
        sourcePath: page.body,
        sourceDigest: read.digest,
        bodyMediaType: 'text/html',
        body: normalized.html,
        bodyDigest: normalized.bodyDigest,
        renderPolicy: { ...renderPolicy },
      },
    };
  }
  if (findings.length > 0) {
    throw new RepositoryIntakeError(
      `${findings.length} problem(s) with the policy pages named in ${publicationPath}`,
      findings,
    );
  }
  return pages;
}

/**
 * The part of one document's front matter that becomes
 * `build-input.content[].frontmatter`.
 *
 * @param {Record<string, any>} frontmatter the validated front matter
 * @param {ReadonlyMap<string, import('./content-media.js').MediaFile>} mediaFiles
 *   every checked image file, by repository-relative path
 * @returns {Record<string, unknown>} the normalized front matter
 */
function normalizeContentFrontmatter(frontmatter, mediaFiles) {
  return {
    id: frontmatter.id,
    kind: frontmatter.kind,
    title: frontmatter.title,
    ...(frontmatter.description
      ? { description: frontmatter.description }
      : {}),
    language: frontmatter.language,
    authorIds: frontmatter.authors,
    tags: frontmatter.tags,
    ...(frontmatter.series ? { series: frontmatter.series } : {}),
    ...(frontmatter.seriesOrder
      ? { seriesOrder: frontmatter.seriesOrder }
      : {}),
    status: frontmatter.status === 'draft' ? 'unlisted' : frontmatter.status,
    createdAt: frontmatter.createdAt,
    publishedAt: frontmatter.publishedAt ?? frontmatter.createdAt,
    ...(frontmatter.updatedAt ? { updatedAt: frontmatter.updatedAt } : {}),
    slug: frontmatter.slug,
    ...(frontmatter.route ? { route: frontmatter.route } : {}),
    ...(frontmatter.hero
      ? {
          hero: {
            file: {
              path: frontmatter.hero.path,
              sourceDigest: mediaFiles.get(frontmatter.hero.path)?.sourceDigest,
            },
            alt: frontmatter.hero.alt,
            role: frontmatter.hero.role,
          },
        }
      : {}),
    redirects: frontmatter.redirects,
    ...(frontmatter.socialImageRef
      ? { socialImage: resolvedFileOf(mediaFiles, frontmatter.socialImageRef) }
      : {}),
    ...(frontmatter.edition ? { edition: frontmatter.edition } : {}),
    ...(frontmatter.seo ? { seo: { ...frontmatter.seo } } : {}),
  };
}

/**
 * The build-input `resolvedFile` of a checked image.
 *
 * @param {ReadonlyMap<string, {sourceDigest: string}>} mediaFiles every checked image, by path
 * @param {string} imagePath the repository-relative path as authored
 * @returns {{path: string, sourceDigest: string | undefined}} the resolved file
 */
function resolvedFileOf(mediaFiles, imagePath) {
  return {
    path: imagePath,
    sourceDigest: mediaFiles.get(imagePath)?.sourceDigest,
  };
}

/**
 * Build one validated `urn:gala:schema:build-input:2.0.0` document from a
 * repository directory (S2-T20 deliverable (1)).
 *
 * @param {{repositoryDirectory: string, includeDraftsAsUnlisted?: boolean, env?: NodeJS.ProcessEnv, warnings?: import('../types.js').PublishActionFinding[]}} options the absolute repository directory, candidate-render policy, the environment that supplies `GALA_API_ORIGIN`/`GALA_APP_ORIGIN`, and an optional array that receives the non-blocking findings (a dropped Prism edition is the only source today); without it they are discarded
 * @returns {Promise<Record<string, unknown>>} the validated build-input
 *   document. `buildInput.packages.theme` (sourced from `lock.json`; the
 *   intake refuses with `THEME_SELECTION_MISMATCH` when `appearance.json`
 *   names a different theme package) is the theme identity provenance building and any other
 *   theme-aware caller should reuse.
 */
export async function buildBuildInputFromRepository({
  repositoryDirectory,
  includeDraftsAsUnlisted = false,
  env = process.env,
  warnings = [],
}) {
  if (!path.isAbsolute(repositoryDirectory)) {
    throw new RepositoryIntakeError(
      'repositoryDirectory must be an absolute path',
      [sourceFinding('REPOSITORY_DIRECTORY_NOT_ABSOLUTE', repositoryDirectory)],
    );
  }

  // DEC-006: "The fixed discovery path is `gala/repository.json`. The
  // committed resolver output is `gala.lock.json`." These are the only two
  // names with format-level special meaning; every other path is read from
  // whatever `repository.json`/`publication.json` themselves declare.
  const repository = await readValidatedJson(
    repositoryDirectory,
    'gala/repository.json',
    SCHEMA.repository,
  );
  const lock = await readValidatedJson(
    repositoryDirectory,
    'gala.lock.json',
    SCHEMA.lock,
  );
  const expectedLockDigest = LOCK_DIGEST_PROFILE.digest(lock.document);
  if (lock.document.lockDigest !== expectedLockDigest) {
    throw new RepositoryIntakeError(
      'gala.lock.json lockDigest does not authenticate the complete lock',
      [
        sourceFinding(
          'LOCK_DIGEST_MISMATCH',
          'gala.lock.json: lockDigest is not the GALA-LOCK-V2 digest of the complete lock',
          {
            claimedLockDigest: lock.document.lockDigest,
            expectedLockDigest,
          },
        ),
      ],
    );
  }
  try {
    requireThemeArtifact(
      /** @type {Record<string, unknown>} */ (lock.document.theme),
      'LOCK_THEME_IDENTITY_INVALID',
    );
  } catch (mismatch) {
    const detail = /** @type {Error} */ (mismatch).message;
    throw new RepositoryIntakeError(detail, [
      sourceFinding('LOCK_THEME_IDENTITY_INVALID', detail, {
        themePackage: lock.document.theme?.package,
      }),
    ]);
  }
  const publicationDoc = await readValidatedJson(
    repositoryDirectory,
    repository.document.publication,
    SCHEMA.publication,
  );
  const navigationDoc = repository.document.navigation
    ? await readValidatedJson(
        repositoryDirectory,
        repository.document.navigation,
        SCHEMA.navigation,
      )
    : null;
  const appearanceDoc = repository.document.appearance
    ? await readValidatedJson(
        repositoryDirectory,
        repository.document.appearance,
        SCHEMA.appearance,
      )
    : null;
  if (!navigationDoc || !appearanceDoc) {
    throw new RepositoryIntakeError(
      'repository.json must declare both "navigation" and "appearance" (this package does not support the built-in-default source)',
      [
        sourceFinding(
          'REPOSITORY_NAVIGATION_OR_APPEARANCE_MISSING',
          repositoryDirectory,
        ),
      ],
    );
  }

  if (publicationDoc.document.profile || publicationDoc.document.footerCard) {
    throw new RepositoryIntakeError(
      'publication.json profile/footerCard are not supported by this normalization step (documented scope reduction)',
      [
        sourceFinding(
          'PUBLICATION_PROFILE_OR_FOOTER_CARD_UNSUPPORTED',
          'publication.json',
        ),
      ],
    );
  }

  // --- authors -------------------------------------------------------------
  /** @type {Record<string, unknown>[]} */
  const authors = [];
  for (const authorRef of publicationDoc.document.authors) {
    const authorDoc = await readValidatedJson(
      repositoryDirectory,
      authorRef,
      SCHEMA.author,
    );
    if (authorDoc.document.avatarRef) {
      throw new RepositoryIntakeError(
        'author avatarRef is not supported (documented scope reduction)',
        [sourceFinding('AUTHOR_AVATAR_UNSUPPORTED', authorRef)],
      );
    }
    authors.push({
      id: authorDoc.document.id,
      displayName: authorDoc.document.displayName,
      biography: authorDoc.document.biography,
      ...(authorDoc.document.pronouns
        ? { pronouns: authorDoc.document.pronouns }
        : {}),
      links: authorDoc.document.links,
      localized: authorDoc.document.localized,
      sourcePath: authorRef,
      sourceDigest: authorDoc.digest,
    });
  }
  const knownAuthorIds = new Set(
    authors.map((author) => /** @type {string} */ (author.id)),
  );

  // --- publication -----------------------------------------------------------
  const publicationAuthorIds = [
    ...new Set(authors.map((author) => /** @type {string} */ (author.id))),
  ];
  if (publicationDoc.document.contactRef) {
    throw new RepositoryIntakeError(
      'publication.json contactRef is not supported (documented scope reduction); remove it, the default image and crawlers are supported',
      [sourceFinding('PUBLICATION_CONTACT_UNSUPPORTED', 'publication.json')],
    );
  }
  // Single-file image references (default image, brand mark, wordmark) are
  // checked together with the content images further down; the resolved
  // `{path, sourceDigest}` is added to the publication and appearance then.
  /** @type {import('./content-media.js').MediaReference[]} */
  const mediaReferences = [];
  if (publicationDoc.document.defaultImageRef) {
    mediaReferences.push({
      document: repository.document.publication,
      origin: 'defaultImage',
      source: publicationDoc.document.defaultImageRef,
      alt: '',
    });
  }
  const publication = {
    id: publicationDoc.document.id,
    slug: publicationDoc.document.slug,
    title: publicationDoc.document.title,
    description: publicationDoc.document.description,
    canonicalBase: publicationDoc.document.canonicalBase,
    defaultLanguage: publicationDoc.document.defaultLanguage,
    authorIds: publicationAuthorIds,
    socialLinks: publicationDoc.document.socialLinks,
    ...(publicationDoc.document.crawlers
      ? { crawlers: { ...publicationDoc.document.crawlers } }
      : {}),
    sourcePath: 'publication.json',
    sourceDigest: publicationDoc.digest,
  };
  if (publication.id !== repository.document.publicationId) {
    throw new RepositoryIntakeError(
      'repository.json publicationId does not match publication.json id',
      [sourceFinding('REPOSITORY_PUBLICATION_ID_MISMATCH', 'repository.json')],
    );
  }

  // --- navigation ------------------------------------------------------------
  const navigation = {
    items: navigationDoc.document.items,
    footerItems: navigationDoc.document.footerItems,
    source: {
      kind: 'authored',
      sourcePath: repository.document.navigation,
      sourceDigest: navigationDoc.digest,
    },
  };

  // --- packages (lock.json is the authority for the theme identity; appearance.json must agree) ----
  const packages = {
    schemas: projectPackageIdentity(lock.document.schemas),
    template: projectPackageIdentity(lock.document.template),
    theme: projectPackageIdentity(lock.document.theme),
    publisher: lock.document.publisher.map(projectPackageIdentity),
    dependencies: lock.document.dependencies.map(projectPackageIdentity),
  };

  // --- theme selection consistency ----------------------------------------------
  const appearanceThemePackage = themePackageNameOf(
    String(appearanceDoc.document.theme),
  );
  if (appearanceThemePackage !== packages.theme.package) {
    throw new RepositoryIntakeError(
      `appearance.json selects ${appearanceThemePackage} but gala.lock.json pins ${packages.theme.package}`,
      [
        {
          ...sourceFinding(
            'THEME_SELECTION_MISMATCH',
            `gala/appearance.json chooses ${appearanceThemePackage} but gala.lock.json pins ${packages.theme.package}. The two files must name the same theme.`,
            {
              appearanceTheme: appearanceThemePackage,
              lockTheme: packages.theme.package,
            },
          ),
          recovery:
            'Choose the theme again in Galascribe \u2192 Settings \u2192 Appearance, which updates both files.',
        },
      ],
    );
  }

  // --- appearance --------------------------------------------------------------
  for (const origin of /** @type {const} */ (['brandMark', 'wordmark'])) {
    if (appearanceDoc.document[origin]) {
      mediaReferences.push({
        document: repository.document.appearance,
        origin,
        source: appearanceDoc.document[origin],
        alt: '',
      });
    }
  }
  if (
    appearanceDoc.document.fontAssetRefs &&
    appearanceDoc.document.fontAssetRefs.length > 0
  ) {
    throw new RepositoryIntakeError(
      'appearance.json fontAssetRefs are not supported (documented scope reduction; brandMark and wordmark are supported)',
      [
        sourceFinding(
          'APPEARANCE_MEDIA_UNSUPPORTED',
          repository.document.appearance,
        ),
      ],
    );
  }
  const appearance = {
    theme: `${packages.theme.package}@${packages.theme.version}`,
    colorMode: appearanceDoc.document.colorMode,
    headerComposition: appearanceDoc.document.headerComposition,
    footerComposition: appearanceDoc.document.footerComposition,
    typeScale: appearanceDoc.document.typeScale,
    ...(appearanceDoc.document.attribution === undefined
      ? {}
      : { attribution: { ...appearanceDoc.document.attribution } }),
    fontAssets: [],
    tokens: structuredClone(appearanceDoc.document.tokens ?? {}),
    source: {
      kind: 'authored',
      sourcePath: repository.document.appearance,
      sourceDigest: appearanceDoc.digest,
    },
  };

  // --- content -----------------------------------------------------------------
  const contentDirectory = path.join(repositoryDirectory, 'content');
  /** @type {string[]} */
  let contentFileNames;
  try {
    contentFileNames = (await readdir(contentDirectory))
      .filter((name) => name.endsWith('.md'))
      .sort();
  } catch {
    contentFileNames = [];
  }
  if (contentFileNames.length === 0) {
    throw new RepositoryIntakeError(
      'repository must have at least one content/*.md file',
      [sourceFinding('REPOSITORY_CONTENT_EMPTY', 'content/')],
    );
  }

  const { normalizeAuthoredMarkdown } =
    /** @type {{normalizeAuthoredMarkdown: (source: string) => {html: string, bodyDigest: string}}} */ (
      await importTemplatePublicEntry()
    );
  const renderPolicy = await currentRenderPolicyIdentity();
  const sourceRevision = await resolveSourceRevision(repositoryDirectory);
  const buildEpoch = await resolveBuildEpoch(repositoryDirectory);

  // Pass 1: read, split, parse and validate every document. An edition sorts
  // before its article by file name (`post.edition.quick-read.md` <
  // `post.md`), so no document can be judged until every document is read.
  /** @type {{relativePath: string, sourceDigest: string, frontmatter: Record<string, any>, markdownBody: string, rawBody: string}[]} */
  const documents = [];
  for (const fileName of contentFileNames) {
    const relativePath = `content/${fileName}`;
    const absolutePath = path.join(repositoryDirectory, relativePath);
    const { bytes, digest: sourceDigest } =
      await readFileWithDigest(absolutePath);
    const {
      frontmatterText,
      body: markdownBody,
      rawBody,
    } = splitFrontmatterFence(bytes.toString('utf8'), relativePath);

    let frontmatter;
    try {
      frontmatter = parseConstrainedYamlFrontmatter(frontmatterText);
    } catch (error) {
      throw new RepositoryIntakeError(
        `${relativePath}'s frontmatter fence failed to parse under DEC-006's constrained YAML subset`,
        [
          sourceFinding(
            'CONTENT_FRONTMATTER_PARSE_FAILED',
            `${relativePath}: ${/** @type {Error} */ (error).message}`,
            {
              reasonCode:
                /** @type {import('./frontmatter.js').FrontmatterParseError} */ (
                  error
                ).reasonCode,
            },
          ),
        ],
      );
    }
    assertValidDocument(SCHEMA.contentFrontmatter, frontmatter, relativePath);
    documents.push({
      relativePath,
      sourceDigest,
      frontmatter,
      markdownBody,
      rawBody,
    });
  }

  // The author-repository contract also admits `draft` and `archived`, but
  // build-input intentionally contains only material that may enter a
  // generated publication. Keep those source files covered by the verified
  // repository digest while omitting them from the render input.
  const inBuild = documents.filter(
    ({ frontmatter }) =>
      frontmatter.status !== 'archived' &&
      (frontmatter.status !== 'draft' || includeDraftsAsUnlisted),
  );
  // Editions whose article is missing from the build, or has changed since the
  // edition was made, are left out with a warning (never a failure).
  const editions = evaluateEditions(inBuild);
  warnings.push(...editions.warnings);
  const built = inBuild.filter(
    ({ relativePath }) => !editions.dropped.has(relativePath),
  );

  // Pass 2: authors, Markdown, and the list of images the documents refer to.
  const prepared = built.map(({ relativePath, frontmatter, markdownBody }) => {
    for (const authorId of /** @type {string[]} */ (frontmatter.authors)) {
      if (!knownAuthorIds.has(authorId)) {
        throw new RepositoryIntakeError(
          `${relativePath} references author ${authorId}, which is not one of publication.json's authors`,
          [sourceFinding('CONTENT_AUTHOR_UNKNOWN', relativePath, { authorId })],
        );
      }
    }
    const normalized = normalizeAuthoredMarkdown(markdownBody);
    for (const image of findImageSources(normalized.html)) {
      mediaReferences.push({
        document: relativePath,
        origin: 'body',
        source: image.src,
        alt: image.alt,
      });
    }
    if (frontmatter.hero) {
      mediaReferences.push({
        document: relativePath,
        origin: 'hero',
        source: frontmatter.hero.path,
        alt: frontmatter.hero.alt,
      });
    }
    if (frontmatter.socialImageRef) {
      mediaReferences.push({
        document: relativePath,
        origin: 'socialImage',
        source: frontmatter.socialImageRef,
        alt: '',
      });
    }
    return normalized;
  });

  // Every referenced image is checked and digested; the bytes stay on disk
  // for the template's media pipeline. A body image becomes an entry of its
  // document's `media[]`, a hero becomes `frontmatter.hero.file`.
  const media = await resolveMediaReferences({
    repositoryDirectory,
    assetRoots: repository.document.assetRoots,
    references: mediaReferences,
  });
  if (media.findings.length > 0) {
    throw new RepositoryIntakeError(
      `${media.findings.length} problem(s) with images referenced from content`,
      media.findings,
    );
  }

  /** @type {Record<string, unknown>[]} */
  const content = built.map((document, index) => {
    const normalized = /** @type {{html: string, bodyDigest: string}} */ (
      prepared[index]
    );
    const mediaEntries = media.documents.get(document.relativePath);
    return {
      frontmatter: normalizeContentFrontmatter(
        document.frontmatter,
        media.files,
      ),
      body: normalized.html,
      bodyMediaType: 'text/html',
      bodyDigest: normalized.bodyDigest,
      renderPolicy: { ...renderPolicy },
      sourcePath: document.relativePath,
      sourceRevision,
      sourceDigest: document.sourceDigest,
      resolvedAuthorIds: document.frontmatter.authors,
      ...(mediaEntries === undefined ? {} : { media: mediaEntries }),
    };
  });

  // --- modules ---------------------------------------------------------------
  const interactions = await readInteractionsModule(
    repositoryDirectory,
    repository.document.modules,
    env,
  );
  const analytics = await readAnalyticsModule(
    repositoryDirectory,
    repository.document.modules,
  );

  // --- policy pages ------------------------------------------------------------
  const policies = await readPolicyPages({
    repositoryDirectory,
    publicationPath: repository.document.publication,
    policies: publicationDoc.document.policies,
    normalizeAuthoredMarkdown,
    renderPolicy,
  });

  // --- repository / rootDigest -----------------------------------------------
  const repositoryFiles = await listRepositoryFiles(repositoryDirectory);
  const rootEntries = [];
  for (const relativePath of repositoryFiles) {
    const { digest } = await readFileWithDigest(
      path.join(repositoryDirectory, relativePath),
    );
    rootEntries.push({ path: relativePath, sha256: digest });
  }
  const rootHash = createHash('sha256');
  rootHash.update(REPOSITORY_ROOT_DOMAIN, 'utf8');
  rootHash.update(JSON.stringify(rootEntries), 'utf8');
  const rootDigest = `sha256:${rootHash.digest('hex')}`;

  const repositoryIdentity = resolveRepositoryIdentity(repositoryDirectory);

  const buildInputWithoutDigest = {
    schemaId: SCHEMA.buildInput,
    schemaVersion: '2.0.0',
    contractVersion: '2.0.0',
    repository: {
      repositoryId: repositoryIdentity.repositoryId,
      repositoryOwnerId: repositoryIdentity.repositoryOwnerId,
      sourceRevision,
      rootDigest,
    },
    sourceRevision,
    packages,
    publication: {
      ...publication,
      ...(publicationDoc.document.defaultImageRef
        ? {
            defaultImage: resolvedFileOf(
              media.files,
              publicationDoc.document.defaultImageRef,
            ),
          }
        : {}),
    },
    authors,
    content,
    navigation,
    appearance: {
      ...appearance,
      ...(appearanceDoc.document.brandMark
        ? {
            brandMark: resolvedFileOf(
              media.files,
              appearanceDoc.document.brandMark,
            ),
          }
        : {}),
      ...(appearanceDoc.document.wordmark
        ? {
            wordmark: resolvedFileOf(
              media.files,
              appearanceDoc.document.wordmark,
            ),
          }
        : {}),
    },
    modules: {
      ...(interactions ? { interactions } : {}),
      ...(analytics ? { analytics } : {}),
    },
    ...(policies ? { policies } : {}),
    buildEpoch,
    baseUrl: publication.canonicalBase,
    basePath: '/',
    // DEC-097 section 5: the adapter identity is the lock's selected adapter
    // and the base URL is the publication's canonical base.
    destinationCapabilities: destinationCapabilitiesFromLock({
      lock: lock.document,
      baseUrl: publication.canonicalBase,
    }),
    placements: [],
  };

  const inputDigestHash = createHash('sha256');
  inputDigestHash.update('GALA-PUBLISH-ACTION-BUILD-INPUT-V2\0', 'utf8');
  inputDigestHash.update(JSON.stringify(buildInputWithoutDigest), 'utf8');
  const buildInput = {
    ...buildInputWithoutDigest,
    inputDigest: `sha256:${inputDigestHash.digest('hex')}`,
  };

  assertValidDocument(
    SCHEMA.buildInput,
    buildInput,
    '<normalized build-input>',
  );
  return buildInput;
}

/**
 * Derive `repositoryId`/`repositoryOwnerId` from the GitHub Actions
 * environment when present, or a documented deterministic local stand-in
 * otherwise (never fabricated as a real GitHub identity — S2-T20
 * deliverable).
 *
 * @param {string} repositoryDirectory the absolute repository directory,
 *   used to derive a stable local stand-in
 * @param {NodeJS.ProcessEnv} env the process environment
 * @returns {{repositoryId: string, repositoryOwnerId: string}} the resolved identity
 */
export function resolveRepositoryIdentity(
  repositoryDirectory,
  env = process.env,
) {
  if (
    env.GITHUB_ACTIONS === 'true' &&
    env.GITHUB_REPOSITORY_ID &&
    env.GITHUB_REPOSITORY_OWNER_ID
  ) {
    return {
      repositoryId: env.GITHUB_REPOSITORY_ID,
      repositoryOwnerId: env.GITHUB_REPOSITORY_OWNER_ID,
    };
  }
  const hash = createHash('sha256')
    .update('GALA-PUBLISH-ACTION-LOCAL-REPOSITORY-IDENTITY-V2\0', 'utf8')
    .update(repositoryDirectory, 'utf8')
    .digest();
  // Positive decimal strings (githubPositiveDecimal), derived from the
  // digest rather than fabricated to look like a real GitHub numeric id: 15
  // decimal digits from two independent hash slices, each padded with a
  // leading `1` so the required non-zero leading digit always holds.
  const idDigits =
    BigInt(`0x${hash.subarray(0, 8).toString('hex')}`) % 10n ** 15n;
  const ownerDigits =
    BigInt(`0x${hash.subarray(8, 16).toString('hex')}`) % 10n ** 15n;
  return {
    repositoryId: idDigits.toString(10).padStart(15, '1'),
    repositoryOwnerId: ownerDigits.toString(10).padStart(15, '1'),
  };
}
