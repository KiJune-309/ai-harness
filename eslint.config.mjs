import js from '@eslint/js'
import nextPlugin from '@next/eslint-plugin-next'
import { defineConfig, globalIgnores } from 'eslint/config'
import prettier from 'eslint-config-prettier/flat'
import reactHooks from 'eslint-plugin-react-hooks'
import tseslint from 'typescript-eslint'

export default defineConfig(
    globalIgnores([
        '**/node_modules/**',
        '**/.next/**',
        '**/dist/**',
        '**/build/**',
        '**/coverage/**',
        '**/out/**',
        '**/next-env.d.ts',
        '.pnpm-store/**',
    ]),
    {
        files: ['**/*.{js,cjs,mjs,jsx,ts,cts,mts,tsx}'],
        extends: [js.configs.recommended],
    },
    {
        files: ['**/*.{ts,cts,mts,tsx}'],
        extends: [tseslint.configs.recommended],
    },
    {
        files: ['apps/web/**/*.{js,jsx,ts,tsx}'],
        extends: [reactHooks.configs.flat.recommended],
        languageOptions: {
            parserOptions: {
                ecmaFeatures: { jsx: true },
            },
        },
        plugins: {
            '@next/next': nextPlugin,
        },
        rules: {
            ...nextPlugin.configs['core-web-vitals'].rules,
        },
        settings: {
            next: {
                rootDir: 'apps/web/',
            },
        },
    },
    prettier
)
