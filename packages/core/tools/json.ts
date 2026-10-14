import type { ToolValidationIssue } from './types.ts'

/** Checks JSON values. @param value - Candidate data. @returns Path-qualified violations. */
export function getJsonIssues(value: unknown): readonly ToolValidationIssue[] {
    const issues: ToolValidationIssue[] = []
    const ancestors = new Set<object>()
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
        if (!array && Object.getPrototypeOf(current) !== Object.prototype && Object.getPrototypeOf(current) !== null) {
            issues.push({ code: 'invalid_json', path, message: 'Expected a plain JSON object' })
            continue
        }
        ancestors.add(current)
        pending.push({ leave: current })
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
/** Copies JSON. @param value - Validated JSON. @returns A deep copy. */
export function cloneJson<T>(value: T): T {
    return structuredClone(value)
}
/** Freezes JSON containers. @param value - Validated JSON. @returns The same immutable reference. */
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
/** Checks container immutability. @param value - Validated JSON. @returns Whether all containers are frozen. */
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
