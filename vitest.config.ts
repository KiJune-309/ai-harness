import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { configDefaults, defineConfig } from 'vitest/config'

const coreRequire = createRequire(new URL('./packages/core/scope/package.json', import.meta.url))

const corePackageSubpaths = {
    agent: ['types'],
    'agent-default-model': [],
    'agent-loop': [],
    'agent-tool-presentation': [],
    scope: [],
    session: ['types', 'fork', 'surface'],
    'system-prompt': [],
    tools: ['types', 'presentation'],
}

/**
 * Resolves each local core package and its public subpaths to one source copy.
 * @param directory - Package directory under packages/core.
 * @param subpaths - Public source modules exported alongside the package entry.
 * @returns Aliases for source modules, locale resources, and package metadata.
 */
function coreSourceAliases(directory: string, subpaths: string[]) {
    const packageName = `@deepseek-ai/dsh-${directory}`
    const packageRoot = fileURLToPath(new URL(`./packages/core/${directory}/`, import.meta.url))
    return [
        { find: new RegExp(`^${packageName}$`), replacement: `${packageRoot}src/index.ts` },
        { find: `${packageName}/src`, replacement: `${packageRoot}src` },
        { find: `${packageName}/locale`, replacement: `${packageRoot}locale` },
        { find: `${packageName}/package.json`, replacement: `${packageRoot}package.json` },
        ...subpaths.map(subpath => ({
            find: `${packageName}/${subpath}`,
            replacement: `${packageRoot}src/${subpath}.ts`,
        })),
    ]
}

export default defineConfig({
    resolve: {
        alias: [
            { find: /^@\//, replacement: fileURLToPath(new URL('./apps/web/', import.meta.url)) },
            { find: /^@ai-harness\/contracts$/, replacement: fileURLToPath(new URL('./packages/contracts/src/index.ts', import.meta.url)) },
            { find: /^@ai-harness\/db$/, replacement: fileURLToPath(new URL('./packages/db/src/index.ts', import.meta.url)) },
            {
                find: /^@ai-harness\/chat-runtime$/,
                replacement: fileURLToPath(new URL('./packages/core/chat-runtime/src/index.ts', import.meta.url)),
            },
            {
                find: /^@ai-harness\/chat-runtime\/embeddings$/,
                replacement: fileURLToPath(new URL('./packages/core/chat-runtime/src/embeddings.ts', import.meta.url)),
            },
            {
                find: /^@ai-harness\/chat-runtime\/knowledge$/,
                replacement: fileURLToPath(new URL('./packages/core/chat-runtime/src/knowledge.ts', import.meta.url)),
            },
            {
                find: /^@ai-harness\/chat-runtime\/collaboration$/,
                replacement: fileURLToPath(new URL('./packages/core/chat-runtime/src/collaboration.ts', import.meta.url)),
            },
            // Source-mode core imports Cordis const enums that its published bundle erases.
            { find: /^@deepseek-ai\/cordis$/, replacement: coreRequire.resolve('@deepseek-ai/cordis/src/index.ts') },
            ...Object.entries(corePackageSubpaths).flatMap(([directory, subpaths]) => coreSourceAliases(directory, subpaths)),
        ],
    },
    test: {
        environment: 'node',
        globals: false,
        server: {
            // Process published plugins through Vite so their core imports use the local aliases too.
            deps: { inline: [/@deepseek-ai\//] },
        },
        include: ['{apps,packages,scripts}/**/tests/**/*.{test,spec}.{js,jsx,ts,tsx,mjs,cjs,mts,cts}'],
        exclude: [
            ...configDefaults.exclude,
            // Repository maintenance gates depend on scripts from the full upstream repository.
            'packages/core/agent/tests/verify-export-jsdoc.spec.ts',
            'packages/core/session/tests/gen-persistence-catalog.spec.ts',
            'packages/core/tools/tests/gen-tool-catalog.spec.ts',
            // These settings integration suites require upstream-only test fixtures.
            'packages/core/agent-loop/tests/settings.spec.ts',
            'packages/core/agent-default-model/tests/agent-default-model.spec.ts',
            // The published provider omits the private source adapter imported by this upstream integration suite.
            'packages/core/agent-loop/tests/system-prompt-admission.spec.ts',
        ],
        passWithNoTests: true,
        silent: false,
    },
})
