module.exports = {
  root: true,
  env: { browser: true, es2020: true },
  extends: [
    "eslint:recommended",
    "plugin:@typescript-eslint/recommended",
    "plugin:react-hooks/recommended",
    "plugin:storybook/recommended",
    "plugin:testing-library/react",
    // Disable ESLint rules that conflict with Prettier (Prettier runs only via editor formatter)
    "prettier",
  ],
  ignorePatterns: ["dist", ".eslintrc.cjs"],
  parser: "@typescript-eslint/parser",
  plugins: [
    "react-refresh",
    "sort-keys-fix",
    "@stylistic/jsx",
    "@stylistic/ts",
    "import",
    "typescript-sort-keys",
  ],
  rules: {
    "arrow-parens": ["error", "as-needed"],
    "react-refresh/only-export-components": [
      "warn",
      { allowConstantExport: true },
    ],
    quotes: ["warn", "single"],
    semi: ["error", "always"],
    "no-multi-spaces": ["error"],
    "react-hooks/exhaustive-deps": "off",
    "sort-keys-fix/sort-keys-fix": [
      "error",
      "asc",
      {
        caseSensitive: true,
        natural: false,
      },
    ],
    // TypeScript type/interface sorting
    "typescript-sort-keys/interface": "error",
    "typescript-sort-keys/string-enum": "error",
    "sort-vars": [
      "warn",
      {
        ignoreCase: false,
      },
    ],
    // Import sorting
    "import/order": [
      "error",
      {
        groups: [
          "builtin",
          "external",
          "internal",
          "parent",
          "sibling",
          "index",
        ],
        "newlines-between": "always",
        alphabetize: {
          order: "asc",
          caseInsensitive: false,
        },
        pathGroups: [
          {
            pattern: "react",
            group: "external",
            position: "before",
          },
          {
            pattern: "react-dom",
            group: "external",
            position: "before",
          },
        ],
        pathGroupsExcludedImportTypes: ["react", "react-dom"],
      },
    ],
    "import/no-duplicates": "error",
    "import/newline-after-import": "error",
    // JSX prop sorting - alphabetically sort all props (reserved props like key come first)
    "@stylistic/jsx/jsx-sort-props": [
      "error",
      {
        callbacksLast: false,
        ignoreCase: false,
        noSortAlphabetically: false,
        reservedFirst: ["key", "ref"],
        shorthandFirst: false,
        shorthandLast: false,
      },
    ],
    // Prettier handles indentation; remove rule that fights with it.
    "@typescript-eslint/no-unused-vars": [
      "error",
      {
        args: "all",
        argsIgnorePattern: "^_",
        caughtErrors: "all",
        caughtErrorsIgnorePattern: "^_",
        destructuredArrayIgnorePattern: "^_",
        varsIgnorePattern: "^_",
        ignoreRestSiblings: true,
      },
    ],
    // Allow `any` type but show warning
    "@typescript-eslint/no-explicit-any": "warn",
  },
  overrides: [
    {
      files: ["**/__tests__/**/*.[jt]s?(x)", "**/?(*.)+(spec|test).[jt]s?(x)"],
      extends: ["plugin:testing-library/react"],
    },
    {
      // src/core is the part a phone app would reuse verbatim, so it may not
      // reach for anything only a Chrome extension has. The rule is here rather
      // than in a convention because this is exactly the boundary that erodes.
      files: ["src/core/**/*.ts"],
      env: { browser: false },
      rules: {
        "no-restricted-globals": [
          "error",
          { name: "chrome", message: "src/core must run outside the extension; take it as a dependency." },
          { name: "document", message: "src/core must stay DOM-free." },
          { name: "localStorage", message: "src/core must stay storage-agnostic; use a repository." },
          { name: "window", message: "src/core must stay DOM-free." },
        ],
        "no-restricted-imports": [
          "error",
          {
            patterns: [
              { group: ["react", "react-*"], message: "src/core must stay UI-free." },
              { group: ["@/content/*", "@/ui/*", "@/background/*", "@/platform/*", "@/sites/*"], message: "src/core may only depend on src/lib and itself." },
            ],
          },
        ],
      },
    },
  ],
};
