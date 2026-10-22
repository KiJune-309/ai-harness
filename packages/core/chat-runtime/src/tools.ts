import type { Context } from '@deepseek-ai/cordis'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'

const MAX_EXPRESSION_LENGTH = 512
const MAX_TOKENS = 256
const MAX_DEPTH = 32

/** Bounded arithmetic parser without JavaScript evaluation or host access. */
class ArithmeticParser {
    private position = 0
    private tokens = 0

    /**
     * Retain a small expression after rejecting unsupported characters.
     * @param expression - Arithmetic text supplied to the calculator.
     * @throws Error for excessive length or unsupported characters.
     */
    constructor(private readonly expression: string) {
        if (!expression.trim() || expression.length > MAX_EXPRESSION_LENGTH || !/^[\d\s.+\-*/()%]+$/.test(expression)) {
            throw new Error('Use an arithmetic expression of at most 512 characters with numbers, +, -, *, /, %, and parentheses.')
        }
    }

    /**
     * Consume and evaluate the entire bounded expression.
     * @returns A finite arithmetic result.
     * @throws Error for invalid syntax, division by zero, or excessive values.
     */
    evaluate(): number {
        const value = this.sum(0)
        this.whitespace()
        if (this.position !== this.expression.length) throw new Error('Invalid arithmetic expression.')
        return this.finite(value)
    }

    /**
     * Skip whitespace without counting it as syntax.
     * @returns Nothing; advances the parser cursor.
     */
    private whitespace(): void {
        while (/\s/.test(this.expression[this.position] ?? '') && this.position < this.expression.length) this.position += 1
    }

    /**
     * Read one optional arithmetic operator with a shared work budget.
     * @param characters - Operators accepted at the current grammar level.
     * @returns The consumed operator or an empty string.
     * @throws Error when the expression exceeds the token budget.
     */
    private operator(characters: string): string {
        this.whitespace()
        const character = this.expression[this.position]
        if (character === undefined || !characters.includes(character)) return ''
        this.position += 1
        this.tokens += 1
        if (this.tokens > MAX_TOKENS) throw new Error('Arithmetic expression is too complex.')
        return character
    }

    /**
     * Parse additions and subtractions.
     * @param depth - Current bounded nesting depth.
     * @returns The evaluated sum.
     * @throws Error for malformed or excessive expressions.
     */
    private sum(depth: number): number {
        let value = this.product(depth)
        for (let operator = this.operator('+-'); operator; operator = this.operator('+-')) {
            const right = this.product(depth)
            value = this.finite(operator === '+' ? value + right : value - right)
        }
        return value
    }

    /**
     * Parse multiplication, division, and remainder.
     * @param depth - Current bounded nesting depth.
     * @returns The evaluated product.
     * @throws Error for zero divisors or excessive expressions.
     */
    private product(depth: number): number {
        let value = this.atom(depth)
        for (let operator = this.operator('*/%'); operator; operator = this.operator('*/%')) {
            const right = this.atom(depth)
            if ((operator === '/' || operator === '%') && right === 0) throw new Error('Division by zero is not allowed.')
            value = this.finite(operator === '*' ? value * right : operator === '/' ? value / right : value % right)
        }
        return value
    }

    /**
     * Parse a numeric literal, unary sign, or parenthesized expression.
     * @param depth - Current bounded nesting depth.
     * @returns The evaluated operand.
     * @throws Error for malformed syntax or nesting beyond 32 levels.
     */
    private atom(depth: number): number {
        if (depth > MAX_DEPTH) throw new Error('Arithmetic expression is nested too deeply.')
        const sign = this.operator('+-')
        if (sign) return this.finite((sign === '-' ? -1 : 1) * this.atom(depth + 1))
        if (this.operator('(')) {
            const value = this.sum(depth + 1)
            if (!this.operator(')')) throw new Error('Missing closing parenthesis.')
            return value
        }
        this.whitespace()
        const literal = /^(?:\d+(?:\.\d*)?|\.\d+)/.exec(this.expression.slice(this.position))?.[0]
        if (literal === undefined) throw new Error('Expected a number.')
        this.position += literal.length
        this.tokens += 1
        if (this.tokens > MAX_TOKENS) throw new Error('Arithmetic expression is too complex.')
        return this.finite(Number(literal))
    }

    /**
     * Reject non-finite values and bound intermediate numerical magnitude.
     * @param value - Parsed or calculated value.
     * @returns The accepted value.
     * @throws Error for overflow or a value outside the supported range.
     */
    private finite(value: number): number {
        if (!Number.isFinite(value) || Math.abs(value) > 1e100) throw new Error('Arithmetic result is outside the supported range.')
        return Object.is(value, -0) ? 0 : value
    }
}

/**
 * Read validated tool arguments without accepting inherited host objects.
 * @param args - Detached JSON arguments supplied by the tool runtime.
 * @returns The object argument map.
 * @throws Error if the argument envelope is not an object.
 */
function argumentsObject(args: unknown): Record<string, unknown> {
    if (args === null || typeof args !== 'object' || Array.isArray(args)) throw new Error('Tool arguments must be an object.')
    return args as Record<string, unknown>
}

/**
 * Render a lossless tool result as model-readable JSON text.
 * @param _args - Validated tool arguments, unused by the renderer.
 * @param value - Validated canonical tool output.
 * @returns One detached text block.
 */
function renderResult(_args: unknown, value: unknown): ContentBlock[] {
    return [{ type: 'text', text: JSON.stringify(value) }]
}

/**
 * Build the safe calculator definition without retaining request state.
 * @returns A schema-validated arithmetic capability.
 */
function calculator(): ToolDefinition {
    return {
        name: 'calculator',
        description: 'Evaluate arithmetic with numbers, +, -, *, /, % (remainder), and parentheses. No code or external access.',
        parameters: {
            type: 'object',
            properties: { expression: { type: 'string', minLength: 1, maxLength: MAX_EXPRESSION_LENGTH } },
            required: ['expression'],
            additionalProperties: false,
        },
        output: {
            schema: {
                type: 'object',
                properties: { expression: { type: 'string' }, result: { type: 'number' } },
                required: ['expression', 'result'],
                additionalProperties: false,
            },
            render: renderResult,
        },
        /**
         * Evaluate bounded arithmetic after checking cancellation and argument type.
         * @param args - An expression object validated by the core tool runtime.
         * @param exec - Scoped execution signal and identity.
         * @returns The expression and its numerical result.
         * @throws Error for malformed syntax or unsupported arithmetic.
         */
        async execute(args, exec) {
            exec.signal.throwIfAborted()
            const { expression } = argumentsObject(args)
            if (typeof expression !== 'string') throw new Error('An arithmetic expression is required.')
            return { expression, result: new ArithmeticParser(expression).evaluate() }
        },
    }
}

/**
 * Build a clock tool that only reads the current time in a validated timezone.
 * @returns A schema-validated read-only clock capability.
 */
function currentTime(): ToolDefinition {
    return {
        name: 'current-time',
        description: 'Read the current ISO timestamp and local time. Optional timezone is an IANA name such as Asia/Shanghai or UTC.',
        parameters: {
            type: 'object',
            properties: { timezone: { type: 'string', minLength: 1, maxLength: 64 } },
            additionalProperties: false,
        },
        output: {
            schema: {
                type: 'object',
                properties: { iso: { type: 'string' }, timezone: { type: 'string' }, localTime: { type: 'string' } },
                required: ['iso', 'timezone', 'localTime'],
                additionalProperties: false,
            },
            render: renderResult,
        },
        /**
         * Read the clock in the requested IANA timezone without other side effects.
         * @param args - Optional IANA timezone object.
         * @param exec - Scoped execution signal and identity.
         * @returns Current UTC ISO time, canonical timezone, and local time.
         * @throws Error when a timezone is invalid or unsupported.
         */
        async execute(args, exec) {
            exec.signal.throwIfAborted()
            const timezone = argumentsObject(args).timezone ?? 'UTC'
            if (
                typeof timezone !== 'string' ||
                timezone.length > 64 ||
                !/^(?:UTC|[A-Za-z][A-Za-z_+-]*(?:\/[A-Za-z0-9_+-]+)+)$/.test(timezone)
            ) {
                throw new Error('Use a valid IANA timezone such as Asia/Shanghai or UTC.')
            }
            let formatter: Intl.DateTimeFormat
            try {
                formatter = new Intl.DateTimeFormat('en-CA', {
                    timeZone: timezone,
                    dateStyle: 'full',
                    timeStyle: 'long',
                    hourCycle: 'h23',
                })
            } catch {
                throw new Error('Use a valid IANA timezone such as Asia/Shanghai or UTC.')
            }
            const now = new Date()
            return { iso: now.toISOString(), timezone: formatter.resolvedOptions().timeZone, localTime: formatter.format(now) }
        },
    }
}

/**
 * Register only this agent's explicit safe capabilities in its unpublished scope.
 * @param ctx - Agent-owned scoped context released with the agent handle.
 * @param toolIds - API-authorized selected tool identities.
 * @param register - Optional classified registration adapter owned by the same Agent scope.
 * @returns Nothing; definitions remain visible only within this agent scope.
 * @throws Error if an unrecognized capability reaches the trusted boundary.
 */
export function registerAgentTools(ctx: Context, toolIds: readonly string[], register?: (definition: ToolDefinition) => void): void {
    for (const id of new Set(toolIds)) {
        if (id === 'calculator') {
            if (register) register(calculator())
            else ctx.tools.register(calculator())
        } else if (id === 'current-time') {
            if (register) register(currentTime())
            else ctx.tools.register(currentTime())
        } else throw new Error('Unsupported agent tool.')
    }
}
