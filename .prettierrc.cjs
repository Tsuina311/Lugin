/** @type {import("prettier").Config} */
module.exports = {
  plugins: [], // add stylistic plugins here if you want
  endOfLine: "auto",
  arrowParens: "avoid",
  // CSS property sorting will be handled by ESLint rules
  overrides: [
    {
      files: "*.{js,ts,tsx}",
      options: {
        arrowParens: "avoid",
        bracketSameLine: false,
        parser: "typescript",
        printWidth: 100,
        semi: true,
        singleQuote: true,
        tabWidth: 2,
        useTabs: false,
      },
    },
  ],
};
