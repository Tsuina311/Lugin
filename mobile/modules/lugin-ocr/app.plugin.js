/**
 * Config plugin entry so `app.config` can list `lugin-ocr`.
 * Autolinking picks up the Expo module via package.json + expo-module.config.json;
 * ML Kit is a Gradle dependency of the Android library — no Manifest edits required.
 *
 * @type {import('expo/config-plugins').ConfigPlugin}
 */
module.exports = (config) => config;
