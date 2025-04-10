// eslint.config.js
import eslint from '@eslint/js';
import prettierConfig from 'eslint-config-prettier';
import unicornPlugin from 'eslint-plugin-unicorn';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
	{
		ignores: ['dist/', 'node_modules/', '.wrangler/', 'worker-configuration.d.ts'],
	},
	eslint.configs.recommended,
	...tseslint.configs.recommended,
	unicornPlugin.configs['flat/recommended'],
	{
		files: ['src/**/*.ts'],
		languageOptions: {
			parserOptions: {
				project: true,
				tsconfigRootDir: import.meta.dirname,
			},
			globals: {
				...globals.browser,
				...globals.node,
				fetch: 'readonly',
				Request: 'readonly',
				Response: 'readonly',
				URL: 'readonly',
				caches: 'readonly',
				addEventListener: 'readonly',
				waitUntil: 'readonly',
			},
		},
	},
	prettierConfig,
);
