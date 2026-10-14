import type { ToolValidationIssue } from './types.ts'

/**
 * Inspects a value for lossless JSON representation without invoking its accessor properties.
 * @param value - Candidate data.
 * @returns Path-qualified violations.
 * @throws The original error if inspecting object keys, descriptors, or prototypes fails.
 */
export function getJsonIssues(value: unknown): readonly ToolValidationIssue[] {
    const issues: ToolValidationIssue[] = []
    // Track only the current traversal ancestry so repeated non-circular references remain valid.
    const ancestors = new Set<object>()
    // Leave markers remove an object from the ancestry after its descendants have been inspected.
    const pending: ({ value: unknown; path: PropertyKey[] } | { leave: object })[] = [{ value, path: [] }]
    while (pending.length) {
        const entry = pending.pop()!
        if ('leave' in entry) {
            ancestors.delete(entry.leave)
            continue
        }
        const { value: current, path } = entry
        if (current === null || typeof current === 'string' || typeof current === 'boolean') continue
        if (typeof current === 'number' && Number.isFinite(current)) continue
        if (typeof current !== 'object') {
            issues.push({ code: 'invalid_json', path, message: 'Expected a lossless JSON value' })
            continue
        }
        if (ancestors.has(current)) {
            issues.push({ code: 'invalid_json', path, message: 'Circular JSON reference' })
            continue
        }
        const array = Array.isArray(current)
        const prototype: unknown = Object.getPrototypeOf(current)
        if (array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) {
            issues.push({ code: 'invalid_json', path, message: 'Expected a plain JSON object or array' })
            continue
        }
        ancestors.add(current)
        pending.push({ leave: current })
        // Count representable array entries to detect holes after all own properties are checked.
        let indexes = 0
        for (const key of Reflect.ownKeys(current)) {
            if (array && key === 'length') continue
            const descriptor = Object.getOwnPropertyDescriptor(current, key)!
            const index = typeof key === 'string' && /^(0|[1-9]\d*)$/.test(key) ? Number(key) : undefined
            if (
                typeof key === 'symbol' ||
                !descriptor.enumerable ||
                !('value' in descriptor) ||
                (array && (index === undefined || index >= current.length))
            ) {
                issues.push({ code: 'invalid_json', path: [...path, key], message: 'Property cannot be represented losslessly as JSON' })
                continue
            }
            if (array) indexes++
            const child: unknown = descriptor.value
            pending.push({ value: child, path: [...path, array ? index! : key] })
        }
        if (array && indexes !== current.length) issues.push({ code: 'invalid_json', path, message: 'Sparse arrays are not lossless JSON' })
    }
    return issues
}
/**
 * Creates a detached deep copy of validated JSON data.
 * @param value - Validated JSON value to copy.
 * @returns A deep copy with no shared object or array references.
 * @throws DataCloneError if the value contains data unsupported by native structured cloning.
 */
export function cloneJson<T>(value: T): T {
    return structuredClone(value)
}
/**
 * Freezes every object and array in validated JSON data in place.
 * @param value - Validated JSON value whose containers will be frozen.
 * @returns The same value reference, with all reachable containers frozen.
 * @throws The original error if reading or freezing a container fails.
 */
export function freezeJson<T>(value: T): Readonly<T> {
    const pending: unknown[] = [value]
    const visited = new Set<object>()
    while (pending.length) {
        const current = pending.pop()
        if (current === null || typeof current !== 'object' || visited.has(current)) continue
        visited.add(current)
        pending.push(...Object.values(current))
        Object.freeze(current)
    }
    return value
}
/**
 * Checks that every object and array in validated JSON data is frozen.
 * @param value - Validated JSON value to inspect.
 * @returns Whether all reachable containers are frozen.
 * @throws The original error if inspecting or reading a container fails.
 */
export function isFrozenJson(value: unknown): boolean {
    const pending: unknown[] = [value]
    const visited = new Set<object>()
    while (pending.length) {
        const current = pending.pop()
        if (current === null || typeof current !== 'object' || visited.has(current)) continue
        if (!Object.isFrozen(current)) return false
        visited.add(current)
        pending.push(...Object.values(current))
    }
    return true
}
