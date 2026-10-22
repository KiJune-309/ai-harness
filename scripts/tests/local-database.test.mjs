import { afterEach, describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { developmentEnvironment, localDatabase, localDatabaseExists, localDatabaseConfiguration, localSecret } from '../local-database.mjs'

const directories = []
/**
 * Allocates an isolated private project root for launcher checks.
 * @returns Temporary root removed after each check.
 */
function root() {
    const directory = mkdtempSync(join(tmpdir(), 'harness-durable-'))
    directories.push(directory)
    return directory
}
afterEach(() => {
    for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})
describe('persistent development configuration', () => {
    it('reuses local credentials and private file modes across starts', () => {
        const directory = root()
        const first = localSecret('account-encryption-key', { root: directory })
        expect(localSecret('account-encryption-key', { root: directory })).toBe(first)
        expect(statSync(join(directory, '.local')).mode & 0o777).toBe(0o700)
        expect(statSync(join(directory, '.local/account-encryption-key')).mode & 0o777).toBe(0o600)
        const config = localDatabaseConfiguration(directory)
        expect(localDatabaseConfiguration(directory)).toEqual(config)
        expect(statSync(config.path).mode & 0o777).toBe(0o600)
    })
    it('never replaces a lost established encryption key', () => {
        const directory = root()
        developmentEnvironment({ root: directory, environment: {}, inspectDatabase: () => false, database: () => 'postgresql://fixture' })
        localDatabaseConfiguration(directory)
        unlinkSync(join(directory, '.local/account-encryption-key'))
        expect(() =>
            developmentEnvironment({ root: directory, environment: {}, inspectDatabase: () => false, database: () => 'unreachable' })
        ).toThrow('Restore the original')
    })
    it('uses external settings without touching Docker or overwriting local secrets', () => {
        const directory = root()
        const environment = {
            DATABASE_URL: 'postgresql://external/fixture',
            HARNESS_API_TOKEN: 'a'.repeat(64),
            ACCOUNT_ENCRYPTION_KEY: 'b'.repeat(64),
            CHAT_STORE: 'memory',
        }
        const result = developmentEnvironment({
            root: directory,
            environment,
            inspectDatabase: () => false,
            database: () => {
                throw new Error('Docker must not run')
            },
        })
        expect(result.DATABASE_URL).toBe(environment.DATABASE_URL)
        expect(result.ACCOUNT_ENCRYPTION_KEY).toBe(environment.ACCOUNT_ENCRYPTION_KEY)
        expect(result.CHAT_STORE).toBeUndefined()
        expect(() => developmentEnvironment({ root: directory, environment: { DATABASE_URL: environment.DATABASE_URL } })).toThrow(
            'Missing stable'
        )
    })
    it('loads private environment files but preserves explicit shell overrides', () => {
        const directory = root()
        writeFileSync(join(directory, '.env.local'), 'API_PORT=3201\nWEB_PORT=3200\n')
        const result = developmentEnvironment({
            root: directory,
            environment: { API_PORT: '3301' },
            inspectDatabase: () => false,
            database: () => 'postgresql://fixture',
        })
        expect(result.API_PORT).toBe('3301')
        expect(result.WEB_PORT).toBe('3200')
        expect(result.HARNESS_API_URL).toBe('http://127.0.0.1:3301')
    })
    it('refuses lost database settings and Docker failures before creating new credentials', () => {
        const directory = root()
        expect(() => developmentEnvironment({ root: directory, environment: {}, inspectDatabase: () => true })).toThrow(
            'Restore the original private configuration'
        )
        expect(existsSync(join(directory, '.local/account-encryption-key'))).toBe(false)
        expect(() => localDatabaseExists(() => ({ status: 1 }))).toThrow('Cannot verify')
        expect(() => localDatabase('up', { root: directory, run: () => ({ status: 0, stdout: 'ai-harness_postgres_data\n' }) })).toThrow(
            'Restore the original private configuration'
        )
        expect(existsSync(join(directory, '.local/postgres.env'))).toBe(false)
    })
    it('never removes volumes and refuses to fall back when Docker fails', () => {
        const directory = root()
        const commands = []
        localDatabase('up', {
            root: directory,
            run: (command, args) => {
                commands.push([command, ...args])
                return { status: 0 }
            },
        })
        const before = readFileSync(join(directory, '.local/postgres.env'), 'utf8')
        localDatabase('stop', {
            root: directory,
            run: (command, args) => {
                commands.push([command, ...args])
                return { status: 0 }
            },
        })
        expect(commands.flat()).not.toContain('down')
        expect(commands.flat()).not.toContain('--volumes')
        expect(readFileSync(join(directory, '.local/postgres.env'), 'utf8')).toBe(before)
        expect(() =>
            localDatabase('up', { root: directory, run: () => ({ status: 1, stderr: 'private-secret-must-not-appear' }) })
        ).toThrow('existing data was retained')
    })
})
