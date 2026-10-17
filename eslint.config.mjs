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
        'packages/core/*/lib/**',
        'packages/contracts/lib/**',
        'packages/db/lib/**',
        'apps/api/lib/**',
        '**/next-env.d.ts',
        '.pnpm-store/**',
        '.local/**',
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
        files: ['packages/core/**/*.ts'],
        rules: {
            // Upstream marks intentionally unused arguments and destructured fields with an underscore.
            '@typescript-eslint/no-unused-vars': [
                'error',
                {
                    argsIgnorePattern: '^_',
                    varsIgnorePattern: '^_',
                    caughtErrorsIgnorePattern: '^_',
                    destructuredArrayIgnorePattern: '^_',
                },
            ],
            // Cordis declaration merging uses empty interfaces as public extension points.
            '@typescript-eslint/no-empty-object-type': ['error', { allowInterfaces: 'always' }],
        },
    },
    {
        files: ['packages/core/agent-loop/src/agent.ts', 'packages/core/agent-loop/tests/loop.spec.ts'],
        rules: {
            // Preserve the upstream driver loop and its stream assertion fixture unchanged.
            'no-empty': 'off',
        },
    },
    {
        files: ['packages/core/tools/src/py-types.ts'],
        rules: {
            // The Python serializer deliberately matches unprintable control characters.
            'no-control-regex': 'off',
        },
    },
    {
        files: ['packages/core/tools/tests/py-types.spec.ts'],
        rules: {
            // Literal indentation in these expressions verifies emitted Python formatting.
            'no-regex-spaces': 'off',
        },
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
