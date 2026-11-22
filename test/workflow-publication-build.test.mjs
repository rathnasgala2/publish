/**
 * The production workflow boundary that a generated publication crosses.
 *
 * A publication repository is declarative and deliberately has no
 * package.json or author-owned build script. The reusable workflow must
 * therefore carry that source into the sandbox, mount the already-installed
 * Galascribe toolchain read-only, and invoke the managed renderer directly.
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { crc32, deflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import YAML from 'yaml';

import { carrierDigest } from '../scripts/workflow/carrier.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// CI checks the user template out at its pinned commit beside the sources;
// a workstation falls back to the adjacent repository, then to the fixture.
const SIBLING_USER_TEMPLATE = path.join(ROOT, '.siblings/user-template');
const ADJACENT_USER_TEMPLATE = path.resolve(ROOT, '../user-template');
const PUBLICATION_SOURCE_ROOT = existsSync(SIBLING_USER_TEMPLATE)
  ? SIBLING_USER_TEMPLATE
  : !process.env.WORKSPACE_ROOT && existsSync(ADJACENT_USER_TEMPLATE)
    ? ADJACENT_USER_TEMPLATE
    : path.join(
        ROOT,
        'packages/publish-action/test/fixtures/minimal-repository',
      );

const SANDBOX_IMAGE = String(
  readFileSync(path.join(ROOT, 'scripts/sandbox-build.sh'), 'utf8').match(
    /^IMAGE="([^"]+)"/mu,
  )?.[1],
);
/**
 * Removes a directory the sandbox populated as another uid. The runner
 * cannot delete those entries itself, so the same pinned image does it
 * (offline) before the ordinary removal.
 *
 * @param {string} directory directory to remove
 */
function removeSandboxOutput(directory) {
  if (existsSync(directory)) {
    spawnSync(
      'docker',
      [
        'run',
        '--rm',
        '--network',
        'none',
        '--user',
        '0:0',
        '-v',
        `${directory}:/cleanup`,
        SANDBOX_IMAGE,
        'sh',
        '-c',
        'rm -rf /cleanup/* /cleanup/.[!.]*',
      ],
      { timeout: 60_000 },
    );
  }
  rmSync(directory, { recursive: true, force: true });
}

const DOCKER_PROBE = spawnSync(
  'docker',
  ['version', '--format', '{{.Server.Os}}'],
  { encoding: 'utf8', timeout: 20_000 },
);
const SKIP =
  DOCKER_PROBE.error === undefined && DOCKER_PROBE.status === 0
    ? false
    : 'a container runtime is required to execute the production sandbox';

/**
 * @param {string} command executable name or path
 * @param {string[]} args command arguments
 * @param {import('node:child_process').SpawnSyncOptions} [options] spawn options
 * @returns {import('node:child_process').SpawnSyncReturns<string>} completed process
 */
function run(command, args, options = {}) {
  const result =
    /** @type {import('node:child_process').SpawnSyncReturns<string>} */ (
      spawnSync(command, args, {
        cwd: ROOT,
        timeout: 120_000,
        ...options,
        encoding: 'utf8',
      })
    );
  assert.equal(
    result.status,
    0,
    [result.stdout, result.stderr, result.error?.message]
      .filter(Boolean)
      .join('\n'),
  );
  return result;
}

/** @param {string} repository generated publication repository */
function publishContent(repository) {
  // The user template's two starter pages ship published since user-template 09d33b8 (the
  // owner's "about and welcome page published"); a template that still ships them as drafts
  // is published here so the build has public content either way.
  for (const relativePath of [
    'gala/theme-pages/about.md',
    'content/welcome-to-your-publication.md',
  ]) {
    const contentPath = path.join(repository, relativePath);
    if (!existsSync(contentPath)) {
      continue;
    }
    const before = readFileSync(contentPath, 'utf8');
    if (before.includes('status: published\n')) {
      continue;
    }
    const after = before.replace(
      'status: draft\n',
      "status: published\npublishedAt: '2026-09-30T17:31:26.000Z'\n",
    );
    assert.notEqual(
      after,
      before,
      `${relativePath} must be a draft or already published`,
    );
    writeFileSync(contentPath, after);
  }
}

function managedBuildCommand() {
  const workflow = YAML.parse(
    readFileSync(path.join(ROOT, '.github/workflows/publish-v2.yml'), 'utf8'),
  );
  const step = workflow.jobs.build.steps.find(
    (/** @type {any} */ candidate) =>
      candidate.name === 'Run the Galascribe build in the isolated sandbox',
  );
  assert.ok(step, 'the production sandbox-build step must exist');
  const match = String(step.run).match(/--command "([^"]+)"/u);
  assert.ok(
    match?.[1],
    'the production step must pass an explicit managed command',
  );
  return match[1].replace('${REF_KIND}', 'candidate');
}

/**
 * Build a copy of the publication source through the real carrier and the
 * production sandbox command, then hand the result to `check`.
 *
 * @param {(repository: string) => void} customize changes the copy before it is built
 * @param {(result: {output: string, repository: string}) => void} check asserts on the build
 */
function buildPublication(customize, check) {
  // The toolchain mount is the repository, so the output root cannot live
  // inside it; the runner temporary directory is the writable alternative.
  const temporaryRoot = mkdtempSync(
    path.join(
      process.env.RUNNER_TEMP || tmpdir(),
      'gala-publication-workflow-',
    ),
  );
  try {
    const generatedRepository = path.join(temporaryRoot, 'generated');
    const inbox = path.join(temporaryRoot, 'inbox');
    const decoded = path.join(temporaryRoot, 'decoded');
    const output = path.join(temporaryRoot, 'output');
    const carrier = path.join(inbox, 'verified-inputs-v2.bin');

    cpSync(PUBLICATION_SOURCE_ROOT, generatedRepository, {
      recursive: true,
      filter(source) {
        const relative = path.relative(PUBLICATION_SOURCE_ROOT, source);
        return relative !== '.git' && !relative.startsWith(`.git${path.sep}`);
      },
    });
    publishContent(generatedRepository);
    customize(generatedRepository);
    assert.equal(
      existsSync(path.join(generatedRepository, 'package.json')),
      false,
      'managed publication repositories must remain package-free',
    );

    mkdirSync(inbox);
    const carrierEnvironment = { ...process.env };
    delete carrierEnvironment.GITHUB_ACTIONS;
    delete carrierEnvironment.GITHUB_SHA;
    run(
      process.execPath,
      [
        'scripts/workflow/build-verified-inputs.mjs',
        '--source',
        generatedRepository,
        '--out',
        carrier,
      ],
      { env: carrierEnvironment },
    );
    const digest = carrierDigest(readFileSync(carrier));
    run(process.execPath, [
      'scripts/workflow/decode-carrier.mjs',
      '--inbox',
      inbox,
      '--expected-digest',
      digest,
      '--out',
      decoded,
    ]);

    run(
      'scripts/sandbox-build.sh',
      [
        '--source',
        path.join(decoded, 'source'),
        '--output',
        output,
        '--toolchain',
        ROOT,
        '--command',
        managedBuildCommand(),
        '--timeout-seconds',
        '90',
        '--memory',
        '2g',
        '--cpus',
        '2',
      ],
      {
        env: {
          ...process.env,
          GITHUB_ACTIONS: 'true',
          GITHUB_SHA: '1c14dcdff9501ef74b8b7a5897fba69c586fa76a',
          GITHUB_REPOSITORY: 'fixture-owner/generated-publication',
          GITHUB_REPOSITORY_ID: '1152869454',
          GITHUB_REPOSITORY_OWNER_ID: '192749255',
          GITHUB_WORKFLOW_REF:
            'fixture-owner/generated-publication/.github/workflows/gala-publish-v2.yml@refs/heads/gala/candidate/019d0000-0000-7000-8000-000000000001',
          GITHUB_WORKFLOW: 'Gala preview and publish',
          GITHUB_RUN_ID: '36751986275',
          GITHUB_RUN_ATTEMPT: '1',
          GALA_BUILD_EPOCH: '2026-09-30T17:31:26.000Z',
        },
      },
    );

    check({ output, repository: generatedRepository });
  } finally {
    removeSandboxOutput(path.join(temporaryRoot, 'output'));
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

test(
  'a package-free publication source builds through the real carrier and production sandbox command',
  { skip: SKIP },
  () => {
    buildPublication(
      () => {},
      ({ output, repository }) => {
        const manifest = JSON.parse(
          readFileSync(
            path.join(output, 'work/artifact-manifest.json'),
            'utf8',
          ),
        );
        assert.equal(
          manifest.schemaId,
          'urn:gala:schema:artifact-manifest:2.0.0',
        );
        assert.ok(manifest.routes.length > 0);
        assert.ok(existsSync(path.join(output, 'artifact/index.html')));
        const expectedArticle = existsSync(
          path.join(repository, 'gala/theme-pages/about.md'),
        )
          ? 'about/index.html'
          : 'hello-world/index.html';
        assert.ok(existsSync(path.join(output, 'artifact', expectedArticle)));
      },
    );
  },
);
/**
 * A decodable square PNG (8-bit grey, all black) of the given side.
 *
 * @param {number} side width and height in pixels
 * @returns {Buffer} the file
 */
function squarePng(side) {
  /**
   * @param {string} type chunk type
   * @param {Buffer} data chunk data
   * @returns {Buffer} the chunk
   */
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const framed = Buffer.alloc(body.length + 8);
    framed.writeUInt32BE(data.length, 0);
    body.copy(framed, 4);
    framed.writeUInt32BE(crc32(body), body.length + 4);
    return framed;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(side, 0);
  header.writeUInt32BE(side, 4);
  header[8] = 8;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.alloc((side + 1) * side))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

test(
  'a publication with Listen audio and a podcast cover builds /feed/podcast.xml with the audio enclosure through the production sandbox command',
  { skip: SKIP },
  () => {
    const audio = Buffer.concat([
      Buffer.from('ID3', 'latin1'),
      Buffer.alloc(2048, 7),
    ]);
    buildPublication(
      (repository) => {
        const repositoryFile = path.join(repository, 'gala/repository.json');
        const repositoryDoc = JSON.parse(readFileSync(repositoryFile, 'utf8'));
        repositoryDoc.assetRoots = [
          ...(repositoryDoc.assetRoots ?? []),
          { path: 'assets' },
        ];
        writeFileSync(repositoryFile, JSON.stringify(repositoryDoc));
        const publicationFile = path.join(repository, 'gala/publication.json');
        const publication = JSON.parse(readFileSync(publicationFile, 'utf8'));
        publication.listen = {
          enabled: true,
          podcast: {
            enabled: true,
            category: 'Technology',
            explicit: false,
            cover: 'assets/podcast-cover.png',
          },
        };
        writeFileSync(publicationFile, JSON.stringify(publication));
        mkdirSync(path.join(repository, 'assets/listen'), { recursive: true });
        writeFileSync(
          path.join(repository, 'assets/podcast-cover.png'),
          squarePng(1400),
        );
        writeFileSync(
          path.join(repository, 'assets/listen/episode.mp3'),
          audio,
        );
        const articlePath = path.join(repository, 'content/hello-world.md');
        const article = readFileSync(articlePath, 'utf8');
        const closing = article.indexOf('\n---\n', 3);
        assert.ok(closing > 0, 'the article must have front matter');
        writeFileSync(
          articlePath,
          `${article.slice(0, closing)}\nlisten:\n  audio: assets/listen/episode.mp3\n  durationSeconds: 60\n  format: conversation${article.slice(closing)}`,
        );
      },
      ({ output }) => {
        const feed = path.join(output, 'artifact/feed/podcast.xml');
        assert.ok(existsSync(feed), 'feed/podcast.xml must be built');
        const xml = readFileSync(feed, 'utf8');
        assert.match(xml, /<enclosure [^>]*type="audio\/mpeg"/u);
        assert.match(xml, /length="2051"/u);
        assert.match(xml, /assets\/listen\/hello-world\.[0-9a-f]{8}\.mp3/u);
      },
    );
  },
);

test(
  'a podcast cover that is not square does not fail the build: the site publishes without feed/podcast.xml',
  { skip: SKIP },
  () => {
    buildPublication(
      (repository) => {
        const repositoryFile = path.join(repository, 'gala/repository.json');
        const repositoryDoc = JSON.parse(readFileSync(repositoryFile, 'utf8'));
        repositoryDoc.assetRoots = [
          ...(repositoryDoc.assetRoots ?? []),
          { path: 'assets' },
        ];
        writeFileSync(repositoryFile, JSON.stringify(repositoryDoc));
        const publicationFile = path.join(repository, 'gala/publication.json');
        const publication = JSON.parse(readFileSync(publicationFile, 'utf8'));
        publication.listen = {
          enabled: true,
          podcast: {
            enabled: true,
            category: 'Technology',
            explicit: false,
            cover: 'assets/podcast-cover.png',
          },
        };
        writeFileSync(publicationFile, JSON.stringify(publication));
        mkdirSync(path.join(repository, 'assets'), { recursive: true });
        writeFileSync(
          path.join(repository, 'assets/podcast-cover.png'),
          squarePng(300),
        );
      },
      ({ output }) => {
        assert.ok(existsSync(path.join(output, 'artifact/index.html')));
        assert.equal(
          existsSync(path.join(output, 'artifact/feed/podcast.xml')),
          false,
        );
      },
    );
  },
);
