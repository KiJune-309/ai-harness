import { spawn } from 'node:child_process'
import console from 'node:console'
import process from 'node:process'
import { fileURLToPath, URL } from 'node:url'
import { buildServer } from './build-server.mjs'
import { developmentEnvironment } from './local-database.mjs'
import { withKnowledgeStorage } from './local-object-storage.mjs'

const projectRoot = fileURLToPath(new URL('../', import.meta.url))

/**
 * Build shared packages and start both local apps with one private server token.
 * @returns Nothing while the owned child processes keep the launcher alive.
 * @throws Error when building or starting an application fails.
 */
function startDevelopment() {
    const env = withKnowledgeStorage(developmentEnvironment())
    buildServer()
    const children = [
        spawn('pnpm', ['--filter', '@ai-harness/api', 'dev'], { cwd: projectRoot, env, stdio: 'inherit' }),
        spawn('pnpm', ['--filter', '@ai-harness/web', 'dev', '--port', env.WEB_PORT], { cwd: projectRoot, env, stdio: 'inherit' }),
    ]
    let stopping = false
    /**
     * Forward termination only to child processes owned by this launcher.
     * @returns Nothing; child exit events let the parent finish.
     */
    function stop() {
        if (stopping) return
        stopping = true
        for (const child of children) child.kill('SIGTERM')
    }
    process.once('SIGINT', stop)
    process.once('SIGTERM', stop)
    for (const child of children) {
        child.once('error', () => {
            process.exitCode = 1
            stop()
        })
        child.once('exit', code => {
            if (!stopping) {
                process.exitCode = code ?? 1
                stop()
            }
        })
    }
}

try {
    startDevelopment()
} catch (error) {
    console.error(
        error instanceof Error ? error.message : 'Unable to start the apps. Check the persistent database and build configuration.'
    )
    process.exitCode = 1
}
