import globals from "globals";

export default [{
  files: ["src/**/*.js"],
  languageOptions: {
    ecmaVersion: "latest",
    sourceType: "module",
    globals: globals.node,
  },
  rules: {
    "no-undef": "error",
    "no-unused-vars": ["error", { argsIgnorePattern: "^_", caughtErrors: "none" }],
  },
}];
