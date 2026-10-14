import type { z } from 'zod'
import type { toolSchema } from './schemas.ts'

/** Model-visible description; executable state never belongs on this surface. */
export type ToolSchema = Readonly<z.infer<typeof toolSchema>>
/** Trusted host context supplied separately from model arguments. */
export type ToolExecutionContext = Readonly<{ userId: string; workspaceId: string; signal?: AbortSignal }>
/** Registry-compatible tool whose untrusted arguments are validated at execution. */
export type Tool<TResult = unknown> = ToolSchema & {
    readonly execute: (args: unknown, context: ToolExecutionContext) => Promise<TResult>
}
/** Author definition with schema-inferred input and output types. */
export type DefineToolOptions<P extends z.ZodType<Record<string, unknown>>, O extends z.ZodType> = {
    readonly name: string
    readonly description: string
    readonly parameters: P
    readonly output: O
    readonly execute: (args: z.output<P>, context: ToolExecutionContext) => z.input<NoInfer<O>> | Promise<z.input<NoInfer<O>>>
}
/** Path-qualified validation detail retained for host diagnostics. */
export type ToolValidationIssue = Readonly<{ code: string; path: readonly PropertyKey[]; message: string }>
