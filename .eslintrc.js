module.exports = {
  "env": {
    "browser": false,
    "node": true
  },
  parser: '@typescript-eslint/parser',
  parserOptions: {
    project: "tsconfig.json",
    sourceType: "module",
  },
  plugins: [
    "@typescript-eslint",
    "eslint-plugin-import",
    "simple-import-sort",
  ],
  extends: [
    "plugin:@typescript-eslint/recommended",
    "plugin:@typescript-eslint/recommended-requiring-type-checking",
    "prettier",
  ],
  "rules":{
    "@typescript-eslint/no-unsafe-member-access": "off",
    "@typescript-eslint/no-explicit-any": "off",
    "@typescript-eslint/no-unsafe-call": "off",
    "@typescript-eslint/no-unused-vars":"off",
    "@typescript-eslint/require-await":"off",
    "@typescript-eslint/no-unsafe-return":"off",
    "@typescript-eslint/await-thenable": "off",
    "@typescript-eslint/no-unsafe-assignment": "off",
    "@typescript-eslint/no-unsafe-argument": "off",
    "@typescript-eslint/ban-types":"off",
    "@typescript-eslint/restrict-template-expressions":"off"
  }
}
