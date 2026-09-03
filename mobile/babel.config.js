// Expo defaults plus the worklets plugin.
//
// `react-native-worklets/plugin` is mandatory, not optional: VisionCamera's
// `useFrameOutput` callback runs as a worklet on a native thread, and without
// this plugin the `'worklet'` directive is a no-op string and the callback
// fails at runtime. babel-preset-expo does not add it for us.
//
// Keep it last — it must see the already-transformed function bodies.
module.exports = (api) => {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: ['react-native-worklets/plugin'],
  };
};
