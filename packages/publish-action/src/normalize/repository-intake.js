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
 * DEC-097 shortfall): `repository.json`'s `contentRoots`/`assetRoots`/
 * `generatedSourceRoots` globs are schema-validated but not evaluated as
 * globs — every `content/*.md` file is read directly, sorted by file name;
 * `publication.profile`/`footerCard`, content `hero`/`socialImage`,
 * `appearance` brand/word marks and font assets are not supported (a
 * fixture that sets any of them is rejected with a typed finding rather than
 * silently dropped); `modules`/`placements` are always empty, matching S2's
 * closed scope. A future task that needs the fuller author-repository
 * surface should replace this module rather than extend it ad hoc.
 *
 * @module
 */

import { readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

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

const SCHEMA = Object.freeze({
  repository: 'urn:gala:schema:repository:2.0.0',
  lock: 'urn:gala:schema:lock:2.0.0',
  publication: 'urn:gala:schema:publication:2.0.0',
  author: 'urn:gala:schema:author:2.0.0',
  navigation: 'urn:gala:schema:navigation:2.0.0',
  appearance: 'urn:gala:schema:appearance:2.0.0',
  contentFrontmatter: 'urn:gala:schema:content-frontmatter:2.0.0',
  buildInput: 'urn:gala:schema:build-input:2.0.0',
});

/** A typed intake failure: the author repository does not satisfy this package's documented convention or a referenced schema. */
export class RepositoryIntakeError extends Error {
  /**
   * @param {string} message human-readable summary
   * @param {readonly import('../index.d.ts').PublishActionFinding[]} findings typed findings
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
 * @returns {import('../index.d.ts').PublishActionFinding} one typed
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
 * Split one `content/*.md` file into its bounded YAML frontmatter block's
 * raw text and the raw Markdown body, per DEC-006's "UTF-8 Markdown with a
 * bounded YAML frontmatter block" (the `---`/`---` fence is the near-
 * universal Markdown-frontmatter delimiter convention; DEC-006 fixes the
 * frontmatter's content model, not this specific fence spelling).
 *
 * @param {string} text the file's UTF-8 text
 * @param {string} relativePath repository-relative path, for error messages
 * @returns {{frontmatterText: string, body: string}} the split parts
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
  const body = lines
    .slice(closingIndex + 1)
    .join('\n')
    .replace(/^\n+/u, '');
  return { frontmatterText, body };
}

/**
 * Build one validated `urn:gala:schema:build-input:2.0.0` document from a
 * repository directory (S2-T20 deliverable (1)).
 *
 * @param {{repositoryDirectory: string}} options the absolute repository directory
 * @returns {Promise<Record<string, unknown>>} the validated build-input
 *   document. `buildInput.packages.theme` (sourced from `lock.json`, the
 *   sole authority for the theme selection — no separate "theme" input
 *   exists) is the theme identity provenance building and any other
 *   theme-aware caller should reuse.
 */
export async function buildBuildInputFromRepository({ repositoryDirectory }) {
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
  if (
    publicationDoc.document.contactRef ||
    publicationDoc.document.defaultImageRef
  ) {
    throw new RepositoryIntakeError(
      'publication.json contactRef/defaultImageRef are not supported (documented scope reduction)',
      [
        sourceFinding(
          'PUBLICATION_CONTACT_OR_DEFAULT_IMAGE_UNSUPPORTED',
          'publication.json',
        ),
      ],
    );
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

  // --- packages (lock.json is the sole authority for the theme selection) ----
  const packages = {
    schemas: projectPackageIdentity(lock.document.schemas),
    template: projectPackageIdentity(lock.document.template),
    theme: projectPackageIdentity(lock.document.theme),
    publisher: lock.document.publisher.map(projectPackageIdentity),
    dependencies: lock.document.dependencies.map(projectPackageIdentity),
  };

  // --- appearance --------------------------------------------------------------
  if (
    appearanceDoc.document.brandMark ||
    appearanceDoc.document.wordmark ||
    (appearanceDoc.document.fontAssetRefs &&
      appearanceDoc.document.fontAssetRefs.length > 0)
  ) {
    throw new RepositoryIntakeError(
      'appearance.json brandMark/wordmark/fontAssetRefs are not supported (documented scope reduction; S2-T05 media pipeline is out of scope for this normalization step)',
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
    fontAssets: [],
    tokens: {},
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

  /** @type {Record<string, unknown>[]} */
  const content = [];
  for (const fileName of contentFileNames) {
    const relativePath = `content/${fileName}`;
    const absolutePath = path.join(repositoryDirectory, relativePath);
    const { bytes, digest: sourceDigest } =
      await readFileWithDigest(absolutePath);
    const { frontmatterText, body: markdownBody } = splitFrontmatterFence(
      bytes.toString('utf8'),
      relativePath,
    );

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
    if (frontmatter.hero || frontmatter.socialImageRef) {
      throw new RepositoryIntakeError(
        'content hero/socialImageRef are not supported (documented scope reduction)',
        [sourceFinding('CONTENT_MEDIA_UNSUPPORTED', relativePath)],
      );
    }
    if (
      frontmatter.status !== 'published' &&
      frontmatter.status !== 'unlisted'
    ) {
      throw new RepositoryIntakeError(
        `${relativePath}: status must be "published" or "unlisted" for this normalization step (the normalized schema admits no other state)`,
        [
          sourceFinding('CONTENT_STATUS_UNSUPPORTED', relativePath, {
            status: frontmatter.status,
          }),
        ],
      );
    }
    const resolvedAuthorIds = /** @type {string[]} */ (frontmatter.authors);
    for (const authorId of resolvedAuthorIds) {
      if (!knownAuthorIds.has(authorId)) {
        throw new RepositoryIntakeError(
          `${relativePath} references author ${authorId}, which is not one of publication.json's authors`,
          [sourceFinding('CONTENT_AUTHOR_UNKNOWN', relativePath, { authorId })],
        );
      }
    }

    const normalized = normalizeAuthoredMarkdown(markdownBody);

    const frontmatterNormalized = {
      id: frontmatter.id,
      kind: frontmatter.kind,
      title: frontmatter.title,
      ...(frontmatter.description
        ? { description: frontmatter.description }
        : {}),
      language: frontmatter.language,
      authorIds: resolvedAuthorIds,
      tags: frontmatter.tags,
      ...(frontmatter.series ? { series: frontmatter.series } : {}),
      ...(frontmatter.seriesOrder
        ? { seriesOrder: frontmatter.seriesOrder }
        : {}),
      status: frontmatter.status,
      createdAt: frontmatter.createdAt,
      publishedAt: frontmatter.publishedAt ?? frontmatter.createdAt,
      ...(frontmatter.updatedAt ? { updatedAt: frontmatter.updatedAt } : {}),
      slug: frontmatter.slug,
      ...(frontmatter.route ? { route: frontmatter.route } : {}),
      redirects: frontmatter.redirects,
    };

    content.push({
      frontmatter: frontmatterNormalized,
      body: normalized.html,
      bodyMediaType: 'text/html',
      bodyDigest: normalized.bodyDigest,
      renderPolicy: { ...renderPolicy },
      sourcePath: relativePath,
      sourceRevision,
      sourceDigest,
      resolvedAuthorIds,
    });
  }

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
    publication,
    authors,
    content,
    navigation,
    appearance,
    modules: {},
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
