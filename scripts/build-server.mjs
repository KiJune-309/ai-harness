import { spawnSync } from 'node:child_process'
import process from 'node:process'
import { fileURLToPath, URL } from 'node:url'

const projectRoot = fileURLToPath(new URL('../', import.meta.url))
const compiler = fileURLToPath(new URL('../node_modules/typescript/bin/tsc', import.meta.url))

/**
 * Compile the public server packages in dependency order.
 * @returns Nothing after all server build artifacts are ready.
 * @throws Error when any compiler invocation fails.
 */
export function buildServer() {
    for (const args of [
        ['-p', 'packages/contracts/tsconfig.json'],
        ['-p', 'packages/db/tsconfig.json'],
        ['-b', 'packages/core/tsconfig.json'],
        ['-p', 'apps/api/tsconfig.json'],
    ]) {
        const result = spawnSync(process.execPath, [compiler, ...args], { cwd: projectRoot, stdio: 'inherit' })
        if (result.status !== 0) throw new Error('Server compilation failed.')
    }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    try {
        buildServer()
    } catch {
        process.exitCode = 1
    }
}
