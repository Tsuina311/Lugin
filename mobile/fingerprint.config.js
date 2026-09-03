/** @type {import('expo/fingerprint').Config} */
const config = {
  // CNG: native dirs appear only after EAS prebuild; their presence must not
  // shift the hash vs local fingerprint (contents already ignored when empty).
  ignorePaths: ['android/**/*', 'ios/**/*'],
  sourceSkips: [
    // app.config.ts injects git commit-count version + build stamp into
    // `version` / `extra.lugin`. Local has full git; EAS upload omits `.git`
    // (.easignore), so those fields differ and would break fingerprint OTA.
    'ExpoConfigVersions',
    'ExpoConfigExtraSection',
    // prebuild rewrites package.json scripts; skip so local ≡ EAS.
    'PackageJsonScriptsAll',
  ],
};

module.exports = config;
