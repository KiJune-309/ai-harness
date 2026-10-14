import { describe, expect, test } from 'vitest'
import { cloneJson, freezeJson, getJsonIssues, isFrozenJson } from './json.ts'

// Preserve multiline documentation on nested test callbacks.
// prettier-ignore
describe(
    'JSON tool boundaries',
    /**
     * Groups JSON boundary assertions.
     * @returns Nothing.
     */
    () => {
        test.each([undefined, NaN, Infinity, 1n, Symbol('value'), new Date(), new Array(1)])(
            'rejects non-JSON values: %s',
            /**
             * Checks lossy values.
             * @param value - Candidate value.
             * @returns Nothing.
             */
            value => {
                expect(getJsonIssues(value).length).toBeGreaterThan(0)
            }
        )

        test(
            'reports nested paths without calling accessors',
            /**
             * Checks safe inspection.
             * @returns Nothing.
             */
            () => {
                // Counts getter reads to detect unintended side effects.
                let calls = 0
                const value = { nested: undefined }
                const accessor = Object.defineProperty({}, 'secret', {
                    enumerable: true,
                    /**
                     * Records unexpected property access.
                     * @returns A JSON scalar.
                     */
                    get() {
                        calls++
                        return 'secret'
                    },
                })
                expect(getJsonIssues(value)[0]?.path).toEqual(['nested'])
                expect(getJsonIssues(accessor).length).toBeGreaterThan(0)
                expect(calls).toBe(0)
                expect(getJsonIssues({ [Symbol('key')]: 1 }).length).toBeGreaterThan(0)
                const array = [1]
                Object.defineProperty(array, 'extra', { value: 1, enumerable: true })
                expect(getJsonIssues(array).length).toBeGreaterThan(0)
            }
        )

        test(
            'rejects cycles but accepts shared references and null prototypes',
            /**
             * Checks graph traversal.
             * @returns Nothing.
             */
            () => {
                const cycle: Record<string, unknown> = {}
                cycle.self = cycle
                expect(getJsonIssues(cycle).length).toBeGreaterThan(0)
                const shared = { value: 1 }
                expect(getJsonIssues({ a: shared, b: shared })).toEqual([])
                expect(getJsonIssues(Object.assign(Object.create(null), { value: true }))).toEqual([])
                expect(getJsonIssues([null, true, 1, 'text', { value: [2] }])).toEqual([])
            }
        )

        test(
            'rejects custom array prototypes without calling inherited accessors',
            /**
             * Checks array fidelity with safe prototype inspection.
             * @returns Nothing.
             */
            () => {
                class ChangedArray extends Array<number> {
                    /**
                     * Changes JSON serialization of a nonstandard array.
                     * @returns An incompatible JSON object.
                     */
                    toJSON() {
                        return { changed: true }
                    }
                }
                // Counts getter reads to detect unintended side effects.
                let calls = 0
                const customPrototype = Object.create(Array.prototype, {
                    toJSON: {
                        /**
                         * Records unexpected accessor evaluation.
                         * @returns A serialization function.
                         */
                        get() {
                            calls++
                            return JSON.stringify
                        },
                    },
                })
                const values = [new ChangedArray(1, 2), Object.setPrototypeOf([1, 2], customPrototype)]
                for (const value of values) {
                    expect(getJsonIssues({ values: value })).toMatchObject([{ code: 'invalid_json', path: ['values'] }])
                }
                expect(calls).toBe(0)
            }
        )

        test(
            'copies and freezes every JSON container',
            /**
             * Checks snapshot protection.
             * @returns Nothing.
             */
            () => {
                const original = { nested: { values: [1, 2] } }
                const copy = cloneJson(original)
                copy.nested.values.push(3)
                expect(original.nested.values).toEqual([1, 2])
                expect(copy.nested).not.toBe(original.nested)
                expect(isFrozenJson(original)).toBe(false)
                expect(freezeJson(original)).toBe(original)
                expect(isFrozenJson(original)).toBe(true)
                expect(Object.isFrozen(original.nested.values)).toBe(true)
            }
        )
    }
)
