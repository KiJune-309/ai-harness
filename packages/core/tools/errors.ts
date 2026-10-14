import type { ToolValidationIssue } from './types.ts'

/** Invalid host-provided tool definition. */
export class InvalidToolDefinitionError extends Error {
    readonly code = 'INVALID_TOOL_DEFINITION'
    readonly toolName?: string
    /** Creates a definition error. @param message - Safe diagnostic. @param toolName - Optional name. @param options - Original cause. */
    constructor(message: string, toolName?: string, options?: ErrorOptions) {
        super(message, options)
        this.name = 'InvalidToolDefinitionError'
        this.toolName = toolName
    }
}
/** Duplicate registration name. */
export class DuplicateToolError extends Error {
    readonly code = 'DUPLICATE_TOOL'
    readonly toolName: string
    /** Creates a conflict error. @param toolName - Conflicting name. */
    constructor(toolName: string) {
        super(`Duplicate tool: ${toolName}`)
        this.name = 'DuplicateToolError'
        this.toolName = toolName
    }
}
/** Wrapper-owned input or output validation failure. */
export class ToolValidationError extends Error {
    readonly code: 'INVALID_TOOL_ARGUMENTS' | 'INVALID_TOOL_OUTPUT'
    readonly toolName: string
    readonly stage: 'arguments' | 'output'
    readonly issues: readonly ToolValidationIssue[]
    /** Creates a validation error. @param toolName - Tool identity. @param stage - Validation phase. @param issues - Path details. @param options - Original cause. */
    constructor(toolName: string, stage: 'arguments' | 'output', issues: readonly ToolValidationIssue[], options?: ErrorOptions) {
        super(`Invalid tool ${stage}`, options)
        this.name = 'ToolValidationError'
        this.toolName = toolName
        this.stage = stage
        this.issues = issues
        this.code = stage === 'arguments' ? 'INVALID_TOOL_ARGUMENTS' : 'INVALID_TOOL_OUTPUT'
    }
}
