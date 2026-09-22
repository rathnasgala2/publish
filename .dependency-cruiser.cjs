/**
 * Workspace architecture gate (WORKSPACE.md section 7: "adapter isolation in
 * `publish`"). `adapter-protocol` is the shared, dependency-free contract
 * layer; `publish-kernel` is provider-neutral and may depend on the protocol
 * but never on a concrete adapter; each `adapter-*` package may depend on the
 * protocol only, never on a sibling adapter, the kernel or the action; and
 * `publish-action` is the sole composition root allowed to wire the kernel,
 * the protocol and every adapter together.
 *
 * @type {import('dependency-cruiser').IConfiguration}
 */
module.exports = {
  forbidden: [
    {
      name: 'no-circular-dependencies',
      severity: 'error',
      from: {},
      to: { circular: true },
    },
    {
      name: 'no-orphans',
      severity: 'warn',
      from: {
        orphan: true,
        pathNot: ['(^|/)test/', '\\.test\\.js$', '\\.d\\.ts$'],
      },
      to: {},
    },
    {
      name: 'adapter-protocol-is-dependency-free-within-the-workspace',
      comment:
        'adapter-protocol is the lowest layer; it may not import publish-kernel, any adapter or publish-action.',
      severity: 'error',
      from: { path: '^packages/adapter-protocol/src/' },
      to: {
        path: '^packages/(publish-kernel|adapter-local-directory|adapter-github-pages|adapter-do-spaces|publish-action)/',
      },
    },
    {
      name: 'publish-kernel-is-provider-neutral',
      comment:
        'publish-kernel may depend on adapter-protocol only; it never imports a concrete adapter or publish-action.',
      severity: 'error',
      from: { path: '^packages/publish-kernel/src/' },
      to: {
        path: '^packages/(adapter-local-directory|adapter-github-pages|adapter-do-spaces|publish-action)/',
      },
    },
    {
      name: 'adapter-local-directory-is-isolated',
      comment:
        'adapter-local-directory depends on adapter-protocol only; it never imports a sibling adapter, publish-kernel or publish-action.',
      severity: 'error',
      from: { path: '^packages/adapter-local-directory/src/' },
      to: {
        path: '^packages/(adapter-github-pages|adapter-do-spaces|publish-kernel|publish-action)/',
      },
    },
    {
      name: 'adapter-github-pages-is-isolated',
      comment:
        'adapter-github-pages depends on adapter-protocol only; it never imports a sibling adapter, publish-kernel or publish-action.',
      severity: 'error',
      from: { path: '^packages/adapter-github-pages/src/' },
      to: {
        path: '^packages/(adapter-local-directory|adapter-do-spaces|publish-kernel|publish-action)/',
      },
    },
    {
      name: 'adapter-do-spaces-is-isolated',
      comment:
        'adapter-do-spaces depends on adapter-protocol only; it never imports a sibling adapter, publish-kernel or publish-action.',
      severity: 'error',
      from: { path: '^packages/adapter-do-spaces/src/' },
      to: {
        path: '^packages/(adapter-local-directory|adapter-github-pages|publish-kernel|publish-action)/',
      },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    enhancedResolveOptions: { exportsFields: ['exports'] },
    tsPreCompilationDeps: true,
  },
};
