import { spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath, URL } from 'node:url'
import { parseEnv } from 'node:util'
import process from 'node:process'
import console from 'node:console'

const projectRoot = fileURLToPath(new URL('../', import.meta.url))
const volumeName = 'ai-harness_knowledge_objects'
const fields = ['S3_ENDPOINT', 'S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY']

/**
 * Initializes or reads stable private credentials for this project's object volume.
 * @param root - Local project directory.
 * @param run - Injectable process runner for isolated launcher tests.
 * @returns Private S3 environment with owner-only configuration permissions.
 * @throws Error when existing volume identity is lost or Docker cannot be checked.
 */
export function localObjectConfiguration(root = projectRoot, run = spawnSync) {
    const directory = resolve(root, '.local')
    const path = resolve(directory, 'object-storage.env')
    mkdirSync(directory, { recursive: true, mode: 0o700 })
    chmodSync(directory, 0o700)
    if (!existsSync(path)) {
        const result = run('docker', ['volume', 'ls', '--filter', `name=^${volumeName}$`, '--format', '{{.Name}}'], {
            stdio: 'pipe',
            timeout: 10000,
        })
        if (result.error || result.status !== 0)
            throw new Error('Cannot verify the private object volume. Check Docker; existing data was retained.')
        if (String(result.stdout ?? '').trim())
            throw new Error('Missing .local/object-storage.env for an existing volume. Restore the original configuration.')
        const content = `S3_ENDPOINT=http://127.0.0.1:9002\nS3_REGION=us-east-1\nS3_BUCKET=ai-harness-knowledge\nS3_ACCESS_KEY_ID=harness${randomBytes(12).toString('hex')}\nS3_SECRET_ACCESS_KEY=${randomBytes(32).toString('hex')}\nS3_FORCE_PATH_STYLE=true\nS3_CREATE_BUCKET=true\n`
        writeFileSync(path, content, { mode: 0o600, flag: 'wx' })
    }
    chmodSync(path, 0o600)
    const values = parseEnv(readFileSync(path, 'utf8'))
    if (
        values.S3_ENDPOINT !== 'http://127.0.0.1:9002' ||
        values.S3_BUCKET !== 'ai-harness-knowledge' ||
        !/^harness[a-f0-9]{24}$/.test(values.S3_ACCESS_KEY_ID ?? '') ||
        !/^[a-f0-9]{64}$/.test(values.S3_SECRET_ACCESS_KEY ?? '')
    )
        throw new Error('Invalid stable object configuration. Restore the original private file.')
    return { path, values }
}

/**
 * Starts or stops the dedicated MinIO service without deleting its data volume.
 * @param action - Safe start or stop operation.
 * @param options - Private root and optional process runner.
 * @returns Private server-side S3 settings without logging any credential.
 * @throws Error on unavailable Docker or an unhealthy object service.
 */
export function localObjectStorage(action = 'up', { root = projectRoot, run = spawnSync } = {}) {
    if (!['up', 'stop'].includes(action)) throw new Error('Unsupported object storage operation.')
    const { path, values } = localObjectConfiguration(root, run)
    const args = [
        'compose',
        '--project-name',
        'ai-harness-objects',
        '--env-file',
        path,
        '-f',
        resolve(projectRoot, 'infra/object-storage.compose.yaml'),
    ]
    args.push(...(action === 'up' ? ['up', '-d', '--wait', '--wait-timeout', '60'] : ['stop']))
    const result = run('docker', args, { cwd: projectRoot, env: { ...process.env, ...values }, stdio: 'pipe', timeout: 90000 })
    if (result.error || result.status !== 0)
        throw new Error('Unable to start or stop the private object service. Check Docker; the data volume was retained.')
    return values
}

/**
 * Prefers an explicitly configured external object service over the local durable default.
 * @param environment - Detached development settings already loaded from local files.
 * @param options - Optional local service launcher for isolated tests.
 * @returns Server environment containing a complete stable S3 configuration.
 * @throws Error for partial external settings instead of silently replacing them.
 */
export function withKnowledgeStorage(environment, { start = localObjectStorage } = {}) {
    const env = { ...environment }
    const configured = fields.filter(field => env[field]?.trim())
    if (configured.length && configured.length !== fields.length)
        throw new Error('Complete S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY before starting.')
    if (!configured.length) Object.assign(env, start('up'))
    return env
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    try {
        localObjectStorage(process.argv[2] ?? 'up')
        console.log('Private persistent object service is ready; its volume is retained when stopped.')
    } catch (error) {
        console.error(error instanceof Error ? error.message : 'Object storage operation failed.')
        process.exitCode = 1
    }
}
