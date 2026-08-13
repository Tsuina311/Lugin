module.exports = {
  customSyntax: "postcss-styled-syntax",
  extends: ["stylelint-config-standard"],
  plugins: ["stylelint-order"],
  rules: {
    // Enforce alphabetical property ordering
    "order/properties-alphabetical-order": true,
    // Disable rules that don't work well with styled-components
    "declaration-empty-line-before": null,
    "function-no-unknown": null,
    "no-empty-source": null,
    "nesting-selector-no-missing-scoping-root": null,
    "selector-id-pattern": null,
    "selector-class-pattern": null,
    "keyframes-name-pattern": null,
    "custom-property-pattern": null,
    "no-invalid-double-slash-comments": null,
    "no-descending-specificity": null,
    "no-duplicate-selectors": null,
    "declaration-property-value-no-unknown": null,
    "declaration-property-value-keyword-no-deprecated": null,
    "property-no-unknown": null,
    "property-no-deprecated": null,
  },
};
