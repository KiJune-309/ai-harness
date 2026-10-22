import { randomBytes } from 'node:crypto'
import console from 'node:console'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath, URL } from 'node:url'

/**
 * Creates private deployment settings with independent stable credentials exactly once.
 * @param root - Repository directory containing infra/.env.example.
 * @returns True when the private file was created, or false when it already exists.
 * @throws Error if the template cannot be read or the private file cannot be written.
 */
export function initializeDeployment(root = fileURLToPath(new URL('../', import.meta.url))) {
    const destination = path.join(root, 'infra', '.env.production')
    let settings = readFileSync(path.join(root, 'infra', '.env.example'), 'utf8')
    for (const key of ['POSTGRES_PASSWORD', 'HARNESS_API_TOKEN', 'ACCOUNT_ENCRYPTION_KEY', 'S3_SECRET_ACCESS_KEY']) {
        const placeholder = new RegExp(`^${key}=\\r?$`, 'm')
        if (!placeholder.test(settings)) throw new Error('Deployment template is missing a private credential placeholder.')
        settings = settings.replace(placeholder, `${key}=${randomBytes(32).toString('hex')}`)
    }
    try {
        writeFileSync(destination, settings, { flag: 'wx', mode: 0o600 })
        return true
    } catch (error) {
        if (error.code === 'EEXIST') return false
        throw error
    }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    try {
        const created = initializeDeployment()
        console.log(created ? 'Created infra/.env.production with stable private credentials.' : 'Kept existing infra/.env.production.')
        console.log('Set DEEPSEEK_API_KEY in that file before starting services. Default address: https://localhost')
    } catch {
        console.error('Could not initialize deployment settings. Check the template and directory permissions.')
        process.exitCode = 1
    }
}
