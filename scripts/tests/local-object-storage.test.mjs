import { afterEach, describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { localObjectConfiguration, localObjectStorage, withKnowledgeStorage } from '../local-object-storage.mjs'
const directories = []
/**
 * Allocates an isolated directory without touching real local credentials.
 * @returns A temporary root removed after the test.
 */
function root() {
    const directory = mkdtempSync(join(tmpdir(), 'knowledge-objects-'))
    directories.push(directory)
    return directory
}
afterEach(() => {
    for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})
describe('durable private object launch configuration', () => {
    it('keeps the exact credentials and private file permissions across launches', () => {
        const directory = root()
        const first = localObjectConfiguration(directory, () => ({ status: 0, stdout: '' }))
        expect(
            localObjectConfiguration(directory, () => {
                throw new Error('Existing credentials must not be regenerated')
            })
        ).toEqual(first)
        expect(statSync(first.path).mode & 0o777).toBe(0o600)
        expect(statSync(join(directory, '.local')).mode & 0o777).toBe(0o700)
    })
    it('refuses to manufacture new credentials for an existing volume or unreachable Docker', () => {
        const directory = root()
        expect(() => localObjectConfiguration(directory, () => ({ status: 0, stdout: 'ai-harness_knowledge_objects' }))).toThrow(
            'Restore the original'
        )
        expect(existsSync(join(directory, '.local/object-storage.env'))).toBe(false)
        expect(() => localObjectConfiguration(directory, () => ({ status: 1 }))).toThrow('Cannot verify')
        const first = localObjectConfiguration(directory, () => ({ status: 0, stdout: '' }))
        unlinkSync(first.path)
        expect(() => localObjectConfiguration(directory, () => ({ status: 0, stdout: 'ai-harness_knowledge_objects' }))).toThrow(
            'Restore the original'
        )
    })
    it('preserves external object configuration and rejects partial credentials', () => {
        const external = {
            S3_ENDPOINT: 'https://private-store.example.test',
            S3_BUCKET: 'owned-bucket',
            S3_ACCESS_KEY_ID: 'test-access',
            S3_SECRET_ACCESS_KEY: 'test-secret',
        }
        expect(
            withKnowledgeStorage(external, {
                start: () => {
                    throw new Error('Must not start local service')
                },
            })
        ).toEqual(external)
        expect(() =>
            withKnowledgeStorage(
                { S3_ENDPOINT: external.S3_ENDPOINT },
                {
                    start: () => {
                        throw new Error('Must not start local service')
                    },
                }
            )
        ).toThrow('Complete')
        expect(withKnowledgeStorage({}, { start: () => external })).toEqual(external)
    })
    it('stops without deleting a volume and never prints object secrets on startup failure', () => {
        const directory = root()
        const commands = []
        localObjectStorage('up', {
            root: directory,
            run: (command, args) => {
                commands.push([command, ...args])
                return { status: 0, stdout: '' }
            },
        })
        const before = readFileSync(join(directory, '.local/object-storage.env'), 'utf8')
        localObjectStorage('stop', {
            root: directory,
            run: (command, args) => {
                commands.push([command, ...args])
                return { status: 0 }
            },
        })
        expect(commands.flat()).not.toContain('down')
        expect(commands.flat()).not.toContain('--volumes')
        expect(readFileSync(join(directory, '.local/object-storage.env'), 'utf8')).toBe(before)
        expect(() => localObjectStorage('up', { root: directory, run: () => ({ status: 1, stderr: 'private-credential' }) })).toThrow(
            'volume was retained'
        )
    })
})
