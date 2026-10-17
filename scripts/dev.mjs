import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import console from 'node:console'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import process from 'node:process'
import { parseEnv } from 'node:util'
import { fileURLToPath, URL } from 'node:url'
import { buildServer } from './build-server.mjs'

const projectRoot = fileURLToPath(new URL('../', import.meta.url))

/**
 * Reuse a private development token so signed browser identities survive restarts.
 * @returns A server credential read from an ignored, owner-readable local file.
 * @throws Error if the token cannot be safely read or is malformed.
 */
function localServerToken() {
    const directory = fileURLToPath(new URL('../.local/', import.meta.url))
    const path = fileURLToPath(new URL('../.local/chat-api-token', import.meta.url))
    mkdirSync(directory, { recursive: true, mode: 0o700 })
    if (!existsSync(path)) writeFileSync(path, randomBytes(32).toString('hex'), { mode: 0o600, flag: 'wx' })
    const token = readFileSync(path, 'utf8').trim()
    if (token.length < 32) throw new Error('Invalid local API token. Configure HARNESS_API_TOKEN explicitly.')
    return token
}

/**
 * Load root development environment files while preserving shell overrides.
 * @returns A detached environment shared by the API and Web child processes.
 */
function developmentEnvironment() {
    const files = {}
    for (const name of ['.env', '.env.local']) {
        const path = fileURLToPath(new URL(`../${name}`, import.meta.url))
        if (existsSync(path)) Object.assign(files, parseEnv(readFileSync(path, 'utf8')))
    }
    const env = { ...files, ...process.env }
    env.HARNESS_API_TOKEN = env.HARNESS_API_TOKEN?.trim() || localServerToken()
    env.API_PORT ||= '3001'
    env.WEB_PORT ||= '3000'
    env.HARNESS_API_URL ||= `http://127.0.0.1:${env.API_PORT}`
    if (!env.DATABASE_URL) env.CHAT_STORE ||= 'memory'
    return env
}

/**
 * Build shared packages and start both local apps with one private server token.
 * @returns Nothing while the owned child processes keep the launcher alive.
 * @throws Error when building or starting an application fails.
 */
function startDevelopment() {
    buildServer()
    const env = developmentEnvironment()
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
} catch {
    console.error('Unable to start the apps. Resolve the build errors above and retry pnpm dev.')
    process.exitCode = 1
}
