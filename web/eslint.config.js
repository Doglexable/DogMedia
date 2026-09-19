import globals from "globals";

const jsxUsesVars = {
  meta: { type: "problem", schema: [] },
  create(context) {
    return {
      JSXOpeningElement(node) {
        let name = node.name;
        while (name?.type === "JSXMemberExpression") name = name.object;
        if (name?.type === "JSXIdentifier") {
          context.sourceCode.markVariableAsUsed(name.name, node);
        }
      },
    };
  },
};

export default [{
  files: ["src/**/*.{js,jsx}", "vite.config.js"],
  languageOptions: {
    ecmaVersion: "latest",
    sourceType: "module",
    parserOptions: { ecmaFeatures: { jsx: true } },
    globals: { ...globals.browser, ...globals.node },
  },
  plugins: { local: { rules: { "jsx-uses-vars": jsxUsesVars } } },
  rules: {
    "local/jsx-uses-vars": "error",
    "no-undef": "error",
    "no-unused-vars": ["error", { argsIgnorePattern: "^_", caughtErrors: "none" }],
  },
}];
