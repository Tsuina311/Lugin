/**
 * Config plugin entry so `app.config` can list `lugin-card-detector`.
 * Autolinking picks up the Expo module via package.json + expo-module.config.json;
 * no AndroidManifest / Info.plist edits are required for the geometry detector.
 *
 * @type {import('expo/config-plugins').ConfigPlugin}
 */
module.exports = (config) => config;
