/** @type {import('prettier').Config & import('prettier-plugin-tailwindcss').PluginOptions} */
const config = {
  plugins: ['prettier-plugin-tailwindcss'],
  printWidth: 80,
  useTabs: false,
  tabWidth: 2,
  trailingComma: 'es5',
  semi: true,
  singleQuote: true,
  bracketSpacing: true,
  arrowParens: 'always',
  jsxSingleQuote: false,
  bracketSameLine: false,
  endOfLine: 'lf',
};

export default config;
