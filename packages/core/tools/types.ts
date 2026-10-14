import type { z } from 'zod'
import type { toolSchema } from './schemas.ts'

/**
 * Model-visible description; executable state never belongs on this surface.
 */
export type ToolSchema = Readonly<z.infer<typeof toolSchema>>
/**
 * Trusted host context supplied separately from model arguments.
 */
export type ToolExecutionContext = Readonly<{ userId: string; workspaceId: string; signal?: AbortSignal }>
/**
 * Registry-compatible tool whose untrusted arguments are validated at execution.
 */
export type Tool<TResult = unknown> = ToolSchema & {
    /**
     * Validates untrusted arguments, executes the tool in trusted host context, and validates its output.
     * @param args - Untrusted model arguments to validate against the tool's parameter schema.
     * @param context - Trusted user and workspace identity with an optional cancellation signal.
     * @returns A promise resolving to the validated tool result.
     * @throws ToolValidationError if argument or output validation fails.
     * @throws The cancellation reason or original implementation or inspection error if execution fails or is cancelled.
     * @remarks May perform implementation-specific side effects within the authorized workspace.
     */
    readonly execute: (args: unknown, context: ToolExecutionContext) => Promise<TResult>
}
/**
 * Author definition with schema-inferred input and output types.
 */
export type DefineToolOptions<P extends z.ZodType<Record<string, unknown>>, O extends z.ZodType> = {
    readonly name: string
    readonly description: string
    readonly parameters: P
    readonly output: O
    /**
     * Implements the tool using schema-parsed arguments and trusted host context.
     * @param args - Arguments parsed and normalized by the declared parameter schema.
     * @param context - Trusted user and workspace identity with an optional cancellation signal.
     * @returns Raw output accepted by the declared output schema, or a promise resolving to that output.
     * @throws Implementation-specific errors or the cancellation reason when the implementation fails or observes cancellation.
     * @remarks Performs any declared tool side effects, scopes data access to the workspace, and owns cleanup during cancellation.
     */
    readonly execute: (args: z.output<P>, context: ToolExecutionContext) => z.input<NoInfer<O>> | Promise<z.input<NoInfer<O>>>
}
/**
 * Path-qualified validation detail retained for host diagnostics.
 */
export type ToolValidationIssue = Readonly<{ code: string; path: readonly PropertyKey[]; message: string }>
