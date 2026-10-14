import type { ToolValidationIssue } from './types.ts'

/**
 * Invalid host-provided tool definition.
 */
export class InvalidToolDefinitionError extends Error {
    readonly code = 'INVALID_TOOL_DEFINITION'
    readonly toolName?: string
    /**
     * Initializes an invalid-definition error with its tool identity and optional cause.
     * @param message - Safe diagnostic explaining the invalid definition.
     * @param toolName - Optional tool name associated with the definition.
     * @param options - Error options retaining the original failure as the cause.
     * @returns An initialized invalid-definition error instance.
     */
    constructor(message: string, toolName?: string, options?: ErrorOptions) {
        super(message, options)
        this.name = 'InvalidToolDefinitionError'
        this.toolName = toolName
    }
}
/**
 * Duplicate registration name.
 */
export class DuplicateToolError extends Error {
    readonly code = 'DUPLICATE_TOOL'
    readonly toolName: string
    /**
     * Initializes an error for a tool name that conflicts with another registration.
     * @param toolName - Conflicting tool name.
     * @returns An initialized duplicate-registration error instance.
     */
    constructor(toolName: string) {
        super(`Duplicate tool: ${toolName}`)
        this.name = 'DuplicateToolError'
        this.toolName = toolName
    }
}
/**
 * Wrapper-owned input or output validation failure.
 */
export class ToolValidationError extends Error {
    readonly code: 'INVALID_TOOL_ARGUMENTS' | 'INVALID_TOOL_OUTPUT'
    readonly toolName: string
    readonly stage: 'arguments' | 'output'
    readonly issues: readonly ToolValidationIssue[]
    /**
     * Initializes a boundary-validation error with its phase, issues, and optional cause.
     * @param toolName - Name of the tool whose value failed validation.
     * @param stage - Failed validation boundary, either arguments or output.
     * @param issues - Path-qualified details describing the validation failures.
     * @param options - Error options retaining the original failure as the cause.
     * @returns An initialized validation error with a phase-specific error code.
     */
    constructor(toolName: string, stage: 'arguments' | 'output', issues: readonly ToolValidationIssue[], options?: ErrorOptions) {
        super(`Invalid tool ${stage}`, options)
        this.name = 'ToolValidationError'
        this.toolName = toolName
        this.stage = stage
        this.issues = issues
        this.code = stage === 'arguments' ? 'INVALID_TOOL_ARGUMENTS' : 'INVALID_TOOL_OUTPUT'
    }
}
