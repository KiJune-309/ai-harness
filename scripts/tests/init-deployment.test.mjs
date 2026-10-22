import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { URL } from 'node:url'
import { expect, it } from 'vitest'
import { initializeDeployment } from '../init-deployment.mjs'

/**
 * Verifies private configuration creation and that a repeated initialization retains edited credentials.
 * @returns Nothing after checking an isolated Windows-style configuration and removing its temporary files.
 * @throws Error for filesystem failures or violated persistence assertions.
 */
function verifyPrivateInitialization() {
    const directory = mkdtempSync(path.join(tmpdir(), 'harness-deploy-'))
    try {
        mkdirSync(path.join(directory, 'infra'))
        const template = readFileSync(new URL('../../infra/.env.example', import.meta.url), 'utf8').replace(/\r?\n/g, '\r\n')
        writeFileSync(path.join(directory, 'infra', '.env.example'), template)
        expect(initializeDeployment(directory)).toBe(true)
        const destination = path.join(directory, 'infra', '.env.production')
        const settings = readFileSync(destination, 'utf8')
        const secrets = settings.match(
            /^(?:POSTGRES_PASSWORD|HARNESS_API_TOKEN|ACCOUNT_ENCRYPTION_KEY|S3_SECRET_ACCESS_KEY)=([a-f0-9]{64})$/gm
        )
        expect(secrets).toHaveLength(4)
        const uniqueSecrets = new Set()
        for (const line of secrets) uniqueSecrets.add(line.split('=')[1])
        expect(uniqueSecrets.size).toBe(4)
        expect(settings).toContain('DEEPSEEK_API_KEY=\r\n')
        if (process.platform !== 'win32') expect(statSync(destination).mode & 0o777).toBe(0o600)
        const edited = settings.replace('DEEPSEEK_API_KEY=', 'DEEPSEEK_API_KEY=private-fixture')
        writeFileSync(destination, edited)
        expect(initializeDeployment(directory)).toBe(false)
        expect(readFileSync(destination, 'utf8')).toBe(edited)
    } finally {
        rmSync(directory, { recursive: true, force: true })
    }
}

it('creates independent stable credentials, preserves edits on rerun, and supports Windows line endings', verifyPrivateInitialization)
