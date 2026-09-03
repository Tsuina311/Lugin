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
// Hierarchical lookup stays on: `nmHoistingLimits: workspaces` leaves real
// nested node_modules (expo/node_modules/…) that Metro must still walk up to.

module.exports = config;
