import { spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import process from 'node:process'
import console from 'node:console'
import { fileURLToPath, URL } from 'node:url'
import { parseEnv } from 'node:util'

export const projectRoot = fileURLToPath(new URL('../', import.meta.url))

/**
 * Reads or creates a stable owner-only server secret without replacing existing values.
 * @param name - Private local filename.
 * @param options - Project root and whether an existing deployment requires this secret.
 * @returns The validated server-side hexadecimal secret.
 * @throws Error when an established deployment has lost its key or a file is malformed.
 */
export function localSecret(name, { root = projectRoot, required = false } = {}) {
    const directory = resolve(root, '.local')
    const path = resolve(directory, name)
    mkdirSync(directory, { recursive: true, mode: 0o700 })
    chmodSync(directory, 0o700)
    if (!existsSync(path)) {
        if (required) throw new Error(`Missing stable ${name}. Restore the original private file before restarting.`)
        writeFileSync(path, randomBytes(32).toString('hex'), { mode: 0o600, flag: 'wx' })
    }
    chmodSync(path, 0o600)
    const secret = readFileSync(path, 'utf8').trim()
    if (!/^[0-9a-f]{64}$/i.test(secret)) throw new Error(`Invalid private ${name} configuration.`)
    return secret
}

/**
 * Loads a dedicated persistent database identity, creating it only for a new local deployment.
 * @param root - Project root containing ignored private configuration.
 * @returns Private environment and its path; callers must never log the values.
 * @throws Error for malformed or missing established database configuration.
 */
export function localDatabaseConfiguration(root = projectRoot) {
    const directory = resolve(root, '.local')
    const path = resolve(directory, 'postgres.env')
    mkdirSync(directory, { recursive: true, mode: 0o700 })
    chmodSync(directory, 0o700)
    if (!existsSync(path)) {
        writeFileSync(
            path,
            `POSTGRES_USER=ai_harness\nPOSTGRES_DB=ai_harness\nPOSTGRES_PASSWORD=${randomBytes(32).toString('hex')}\nPOSTGRES_PORT=5433\n`,
            { mode: 0o600, flag: 'wx' }
        )
    }
    chmodSync(path, 0o600)
    const values = parseEnv(readFileSync(path, 'utf8'))
    if (
        values.POSTGRES_USER !== 'ai_harness' ||
        values.POSTGRES_DB !== 'ai_harness' ||
        !/^[a-f0-9]{64}$/.test(values.POSTGRES_PASSWORD ?? '') ||
        !/^\d+$/.test(values.POSTGRES_PORT ?? '') ||
        Number(values.POSTGRES_PORT) < 1 ||
        Number(values.POSTGRES_PORT) > 65535
    ) {
        throw new Error('Invalid private local database configuration. Restore .local/postgres.env; do not reset the data volume.')
    }
    return { path, values }
}

/**
 * Checks the exact dedicated volume without confusing Docker failures with a fresh database.
 * @param run - Process runner used for the local Docker inspection.
 * @returns Whether the dedicated durable volume already exists.
 * @throws Error when Docker cannot verify the volume identity.
 */
export function localDatabaseExists(run = spawnSync) {
    const result = run('docker', ['volume', 'ls', '--filter', 'name=^ai-harness_postgres_data$', '--format', '{{.Name}}'], {
        stdio: 'pipe',
        timeout: 10000,
    })
    if (result.error || result.status !== 0)
        throw new Error('Cannot verify the persistent database volume. Check Docker before starting; existing data was retained.')
    const names = String(result.stdout ?? '')
        .trim()
        .split(/\s+/)
        .filter(Boolean)
    if (names.some(name => name !== 'ai-harness_postgres_data')) throw new Error('Unexpected local database volume identity.')
    return names.includes('ai-harness_postgres_data')
}

/**
 * Refuses to replace lost connection settings for an already existing data volume.
 * @param root - Local project configuration root.
 * @param inspect - Dedicated volume inspection callback.
 * @returns Nothing if existing configuration is present or the deployment is definitely new.
 * @throws Error when the volume exists without its original private settings.
 */
function requireDatabaseIdentity(root, inspect) {
    if (!existsSync(resolve(root, '.local/postgres.env')) && inspect())
        throw new Error(
            'Missing .local/postgres.env for the existing database volume. Restore the original private configuration; existing data was retained.'
        )
}

/**
 * Runs a bounded Compose operation against this project's dedicated database, retaining its volume.
 * @param action - Start or stop the local database container.
 * @param options - Private configuration root and injectable process runner for isolated tests.
 * @returns The private connection URL for the existing database identity.
 * @throws Error when Docker is unavailable or the database cannot become healthy.
 */
export function localDatabase(action = 'up', { root = projectRoot, run = spawnSync } = {}) {
    if (!['up', 'stop'].includes(action)) throw new Error('Unsupported local database operation.')
    requireDatabaseIdentity(root, () => localDatabaseExists(run))
    const { path, values } = localDatabaseConfiguration(root)
    const args = ['compose', '--project-name', 'ai-harness', '--env-file', path, '-f', resolve(projectRoot, 'infra/postgres.compose.yaml')]
    args.push(...(action === 'up' ? ['up', '-d', '--wait', '--wait-timeout', '60'] : ['stop']))
    const result = run('docker', args, { cwd: projectRoot, stdio: 'pipe', timeout: 90000, env: { ...process.env, ...values } })
    if (result.error || result.status !== 0)
        throw new Error(
            'Unable to start or stop the persistent local database. Check Docker and the local database port; existing data was retained.'
        )
    return `postgresql://${values.POSTGRES_USER}:${values.POSTGRES_PASSWORD}@127.0.0.1:${values.POSTGRES_PORT}/${values.POSTGRES_DB}`
}

/**
 * Resolves development settings with stable credentials and an external database taking precedence.
 * @param options - Project root, shell overrides, and optional local database starter.
 * @returns Detached server environment; secrets remain server-side.
 * @throws Error when private credentials or the persistent database are unavailable.
 */
export function developmentEnvironment({
    root = projectRoot,
    environment = process.env,
    database = localDatabase,
    inspectDatabase = localDatabaseExists,
} = {}) {
    const files = {}
    for (const name of ['.env', '.env.local']) {
        const path = resolve(root, name)
        if (existsSync(path)) Object.assign(files, parseEnv(readFileSync(path, 'utf8')))
    }
    const env = { ...files, ...environment }
    if (!env.DATABASE_URL?.trim()) requireDatabaseIdentity(root, inspectDatabase)
    const established = Boolean(env.DATABASE_URL?.trim()) || existsSync(resolve(root, '.local/postgres.env'))
    env.HARNESS_API_TOKEN = env.HARNESS_API_TOKEN?.trim() || localSecret('chat-api-token', { root, required: established })
    env.ACCOUNT_ENCRYPTION_KEY =
        env.ACCOUNT_ENCRYPTION_KEY?.trim() || localSecret('account-encryption-key', { root, required: established })
    if (!/^[a-f0-9]{64}$/i.test(env.ACCOUNT_ENCRYPTION_KEY)) throw new Error('Invalid stable ACCOUNT_ENCRYPTION_KEY.')
    if (!env.DATABASE_URL?.trim()) env.DATABASE_URL = database('up', { root })
    env.API_PORT ||= '3001'
    env.WEB_PORT ||= '3000'
    env.HARNESS_API_URL ||= `http://127.0.0.1:${env.API_PORT}`
    delete env.CHAT_STORE
    return env
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    try {
        requireDatabaseIdentity(projectRoot, localDatabaseExists)
        const established = existsSync(resolve(projectRoot, '.local/postgres.env'))
        localSecret('chat-api-token', { required: established })
        localSecret('account-encryption-key', { required: established })
        localDatabase(process.argv[2] ?? 'up')
        console.log('Persistent local database is ready. Its data volume is retained when stopped.')
    } catch (error) {
        console.error(error instanceof Error ? error.message : 'Local database operation failed.')
        process.exitCode = 1
    }
}
