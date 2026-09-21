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

export default [
  {
    ignores: [
      "android/**",
      "ios/**",
      ".expo/**",
      "node_modules/**",
    ],
  },
  {
    files: ["src/**/*.{js,jsx}", "App.{js,jsx}", "index.{js,jsx}", "scripts/**/*.js"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: {
        ...globals.browser,
        ...globals.node,
        ...globals["react-native"],
        __DEV__: "readonly",
      },
    },
    plugins: { local: { rules: { "jsx-uses-vars": jsxUsesVars } } },
    rules: {
      "local/jsx-uses-vars": "error",
      "no-undef": "error",
      "no-unused-vars": ["error", { argsIgnorePattern: "^_", caughtErrors: "none" }],
    },
  },
];
