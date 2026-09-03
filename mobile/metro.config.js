// Metro config for the Lugin mobile workspace.
// Later milestones can watch ../src for portable core imports.
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const repoRoot = path.resolve(projectRoot, '..');

const config = getDefaultConfig(projectRoot);

config.watchFolders = [repoRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(repoRoot, 'node_modules'),
];

// `@/…` is how the shared core refers to itself (src/lib/scan/resolve.ts and
// src/core/sync/* both use it), so Metro has to agree with tsconfig or the
// portable modules typecheck but fail to resolve at runtime. Done with an
// explicit resolver rather than extraNodeModules, which would read `@/lib/x`
// as a scoped package.
const sharedRoot = path.resolve(repoRoot, 'src');
const upstreamResolveRequest = config.resolver.resolveRequest;

config.resolver.resolveRequest = (context, moduleName, platform) => {
  const resolve = upstreamResolveRequest ?? context.resolveRequest;
  if (moduleName.startsWith('@/')) {
    return resolve(context, path.join(sharedRoot, moduleName.slice(2)), platform);
  }
  return resolve(context, moduleName, platform);
};
// Hierarchical lookup stays on: `nmHoistingLimits: workspaces` leaves real
// nested node_modules (expo/node_modules/…) that Metro must still walk up to.

module.exports = config;
