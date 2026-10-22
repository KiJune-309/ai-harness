export type WorkflowContactKind = 'handoff' | 'question' | 'reply' | 'message'

export interface WorkflowContactCandidate {
    nodeId: string
    title: string
    ownerId: string
    ownerName: string
    direction: 'upstream' | 'downstream'
    questions?: { id: string; version: number; text?: string }[]
}

export interface WorkflowContactIntent {
    kind: WorkflowContactKind
    candidateNodeIds: string[]
    targetNodeId?: string
    candidateQuestionIds?: string[]
    questionId?: string
    reason: 'explicit' | 'clarification'
}

export interface PreviousWorkflowContactIntent {
    kind: WorkflowContactKind
    candidateNodeIds: string[]
    targetNodeId?: string
    candidateQuestionIds?: string[]
    questionId?: string
}

/**
 * Normalizes visible human text without evaluating its contents or trusting quoted instructions.
 * @param value - A current input or existing public identity label.
 * @returns Comparable text with invisible formatting characters removed.
 */
function normalized(value: string): string {
    return value
        .normalize('NFKC')
        .replace(/\p{Cf}/gu, '')
        .trim()
}

/**
 * Removes referenced code and quoted text before recognizing an instruction from the source owner.
 * @param content - Only this turn's genuine owner input, never a template or incoming message.
 * @returns Unquoted prose; a reference-only input cannot create a request.
 */
function instructionText(content: string): string {
    return normalized(content)
        .replace(/```[\s\S]*?(?:```|$)/g, '')
        .replace(/~~~[\s\S]*?(?:~~~|$)/g, '')
        .replace(/^\s*>.*$/gm, '')
        .replace(/`[^`\n]*(?:`|$)/g, '')
        .replace(/“[^”]*(?:”|$)|「[^」]*(?:」|$)|『[^』]*(?:』|$)|"[^"\n]*(?:"|$)/g, '')
        .replace(/'[^'\n]*(?:'|$)/g, '')
        .trim()
}

/**
 * Removes a bounded number of politeness prefixes without interpreting reference contents.
 * @param value - Current owner prose or instruction header.
 * @returns The remaining instruction or discussion phrase.
 */
function withoutPoliteness(value: string): string {
    let result = value
    for (let index = 0; index < 8; index += 1) {
        const next = result.replace(/^(?:请帮我|请帮忙|请你|请直接|现在请|麻烦你|麻烦|劳烦|帮我|请|现在|接下来|然后|直接|立即)\s*/, '')
        if (next === result) break
        result = next
    }
    return result
}

/**
 * Separates the action-bearing header from the message body and rejects hypothetical discussion.
 * @param text - Current unquoted owner prose.
 * @returns A direct instruction header or an empty string when the owner is discussing reference material.
 */
function actionHeader(text: string): string {
    let header = text.split(/[:：\n]/, 1)[0]!.trim()
    header = header.replace(/^(?:(?:好的?|知道了|明白了|收到|嗯)[,，。\s]+)+/, '')
    if (
        /(?:是否|要不要|应不应该|该不该|需不需要|能不能|可不可以|如果|假如|假设|例如|比如|意味着|什么意思)/.test(header) ||
        /(?:不要|不用|不必|暂不|先别|别发|取消|算了|停止)/.test(header) ||
        /^(?:请)?(?:先)?(?:分析|讨论|解释|理解|判断|研究|看看|阅读|总结|检查|复述|引用|考虑)/.test(header) ||
        /^(?:模板|工作说明|工作目标|同事|来信|对方|他说|她说|收到的).*(?:写|说|要求|提到|内容)/.test(header)
    )
        return ''
    header = withoutPoliteness(header)
    return /^(?:把|将|交给|交接|转交|转告|转达|转给|发给|发送|联系|问|询问|向|给|回传|回复|答复|回答|回给)/.test(header) ? header : ''
}

/**
 * Recognizes an exact choice instead of treating a discussion that mentions a work as a choice.
 * @param text - Genuine current owner clarification.
 * @param candidates - Only the original authorized request range.
 * @returns Whether the whole phrase identifies an existing work or assignee.
 */
function isTargetChoice(text: string, candidates: readonly WorkflowContactCandidate[]): boolean {
    const phrase = normalized(text)
        .replace(/[，。！？.!?]+$/u, '')
        .replace(/^(?:就选|就是|选择|选|是)\s*/, '')
        .trim()
    return candidates.some(candidate =>
        [candidate.nodeId, candidate.nodeId.slice(0, 8), candidate.title, candidate.ownerName].some(label => {
            const name = normalized(label)
            return (
                phrase === name ||
                ['这个节点', '那个节点', '这项工作', '那个工作', '这个同事', '节点'].some(suffix => phrase === `${name}${suffix}`)
            )
        })
    )
}

/**
 * Finds exact identity labels or an unambiguous named work within an already explicit request.
 * @param text - Owner's target-selection prose, never used by itself to authorize a new contact.
 * @param candidates - Currently authorized candidate works, optionally limited to a previous request.
 * @param fallback - Whether a still-ambiguous request may retain its original candidate range.
 * @returns The specifically identified works, or all candidates while the owner still needs to choose.
 */
function namedCandidates(text: string, candidates: readonly WorkflowContactCandidate[], fallback = true): WorkflowContactCandidate[] {
    const selection = normalized(text)
    const full = candidates.filter(candidate => selection.includes(candidate.nodeId))
    if (full.length) return full
    const exact = candidates.filter(candidate => selection.includes(candidate.nodeId.slice(0, 8)))
    if (exact.length) return exact
    const titled = candidates.filter(candidate => {
        const title = normalized(candidate.title)
        return title.length >= 2 && selection.includes(title)
    })
    const named = candidates.filter(candidate => {
        const name = normalized(candidate.ownerName)
        return name.length >= 2 && selection.includes(name)
    })
    const matches = [...new Map([...titled, ...named].map(candidate => [candidate.nodeId, candidate])).values()]
    return matches.length ? matches : fallback ? [...candidates] : []
}

/**
 * Selects a real pending question only when its stable identity or an explicit unique topic is clear.
 * @param text - Current owner request or factual clarification.
 * @param questions - Server-authorized current questions already limited to the original request range.
 * @param allowUnique - Whether a single question may be selected after an explicit request is already established.
 * @returns One exact question, or undefined while the owner must disambiguate.
 */
function selectedQuestion(
    text: string,
    questions: NonNullable<WorkflowContactCandidate['questions']>,
    allowUnique = true
): (typeof questions)[number] | undefined {
    if (allowUnique && questions.length === 1) return questions[0]
    const value = normalized(text)
    const identified = questions.filter(question => value.includes(question.id) || value.includes(question.id.slice(0, 8)))
    if (identified.length === 1) return identified[0]
    const topic = (value.match(/(?:关于|针对)\s*[“「『"']?(.{2,100}?)[”」』"']?(?:的?那个问题|的?这个问题|的问题)/) ??
        value.match(/(?:回复|答复)\s*[“「『"']?(.{2,100}?)[”」』"']?(?:的?那个问题|的?这个问题|的问题)/))?.[1]
    const query = normalized(topic ?? value).replace(/^(?:就是|是|选|选择)\s*/, '')
    if (query.length < 2 || query.length > 100) return undefined
    const matching = questions.filter(question => question.text && normalized(question.text).includes(query))
    return matching.length === 1 ? matching[0] : undefined
}

/**
 * Produces bounded metadata for a genuine request without itself granting or persisting a capability.
 * @param kind - Explicit action kind.
 * @param candidates - Current candidates limited to the requested direction and prior scope when applicable.
 * @param text - Only the owner's request or clarification, used to choose a target.
 * @param reason - Whether this is a fresh request or continuation of a verified unconsumed request.
 * @param previous - Optional verified prior range for exact question continuation.
 * @returns An exact request or an ambiguous request with no target capability.
 */
function resolveSelection(
    kind: WorkflowContactKind,
    candidates: WorkflowContactCandidate[],
    text: string,
    reason: WorkflowContactIntent['reason'],
    previous?: PreviousWorkflowContactIntent
): WorkflowContactIntent | undefined {
    if (!candidates.length) return undefined
    let selected = namedCandidates(text, candidates)
    if (kind === 'reply' && selected.length > 1) {
        const question = selectedQuestion(
            text,
            selected.flatMap(candidate => candidate.questions ?? [])
        )
        if (question) selected = selected.filter(candidate => candidate.questions?.some(item => item.id === question.id))
    }
    const result: WorkflowContactIntent = { kind, candidateNodeIds: selected.map(candidate => candidate.nodeId), reason }
    if (selected.length === 1) result.targetNodeId = selected[0]!.nodeId
    if (kind !== 'reply') return result
    const questions = selected
        .flatMap(candidate => candidate.questions ?? [])
        .filter(
            question =>
                (!previous?.candidateQuestionIds || previous.candidateQuestionIds.includes(question.id)) &&
                (!previous?.questionId || previous.questionId === question.id)
        )
    if (!questions.length) {
        if (previous?.questionId || previous?.candidateQuestionIds?.length) return undefined
        return { ...result, kind: 'message' }
    }
    result.candidateQuestionIds = questions.map(question => question.id)
    const chosen = selectedQuestion(text, questions)
    if (chosen) result.questionId = chosen.id
    return result
}

/**
 * Recognizes direct natural contact requests only from the current genuine owner input.
 * @param input - Current prose, authorized fixed neighbors, and an optional verified unconsumed prior request.
 * @returns Bounded request metadata; undefined grants no slot, while ambiguity never chooses a target or question.
 * @remarks The caller must persist the result with exact source/target grants and revalidate it before proposing or confirming.
 */
export function resolveWorkflowContactIntent(input: {
    content: string
    candidates: readonly WorkflowContactCandidate[]
    previous?: PreviousWorkflowContactIntent
}): WorkflowContactIntent | undefined {
    if (!input.content.trim() || input.content.length > 64_000) return undefined
    const prose = instructionText(input.content)
    if (!prose) return undefined
    const firstLine = prose.split(/[:：\n]/, 1)[0]!
    if (
        /(?:请|先|帮我|麻烦).{0,6}(?:分析|讨论|解释|判断|研究|看看)|(?:这件事|这项操作|这个操作).{0,12}(?:分析|讨论|解释|判断|研究|看看)/.test(
            firstLine
        )
    )
        return undefined
    if (/(?:是否|要不要|应不应该|该不该|需不需要|能不能|可不可以|如果|假如|假设|例如|比如|意味着|什么意思)/.test(firstLine))
        return undefined
    if (/^(?:先)?(?:分析|讨论|解释|理解|判断|研究|看看|阅读|总结|检查|复述|引用|考虑)/.test(withoutPoliteness(prose))) return undefined
    const header = actionHeader(prose)
    const unique = [...new Map(input.candidates.map(candidate => [candidate.nodeId, candidate])).values()]
    if (header) {
        const upstream = header.includes('上游')
        const downstream = header.includes('下游')
        if (upstream && downstream) return undefined
        const reply = /(?:回传|回复|答复|回答|回给)/.test(header)
        const question = /(?:补问|询问|问一下|问下|问问|追问)/.test(header) || /^(?:问|(?:向|给)?上游.*问)/.test(header)
        const handoff = /(?:交给|交接|转交)/.test(header)
        const message = /(?:转告|转达|转给|发给|发送|联系)/.test(header)
        if (!reply && !question && !handoff && !message) return undefined
        const kind: WorkflowContactKind = reply ? 'reply' : question ? 'question' : handoff && !upstream ? 'handoff' : 'message'
        const direction = upstream
            ? 'upstream'
            : downstream
              ? 'downstream'
              : kind === 'handoff'
                ? 'downstream'
                : kind === 'question'
                  ? 'upstream'
                  : undefined
        let candidates = unique.filter(candidate => !direction || candidate.direction === direction)
        const named = namedCandidates(header, candidates, false)
        if (!upstream && !downstream && !named.length) {
            if (kind !== 'reply' || /(?:给|联系)\s*[^,，。！？\s]+/.test(header)) return undefined
            candidates = candidates.filter(candidate => candidate.questions?.length)
        }
        return resolveSelection(kind, candidates, header, 'explicit')
    }
    const previous = input.previous
    if (!previous || /(?:不要|不用|先别|取消|算了|停止)/.test(prose)) return undefined
    if (/^(?:确认|知道了|好的?|开始|分析|请先|请分析|先分析|讨论|理解|继续)(?:$|[,，。！？\s])/.test(prose)) return undefined
    const allowed = unique.filter(candidate =>
        previous.targetNodeId ? candidate.nodeId === previous.targetNodeId : previous.candidateNodeIds.includes(candidate.nodeId)
    )
    const targetChosen = namedCandidates(prose, allowed, false)
    const choseTarget = targetChosen.length === 1 && isTargetChoice(prose, allowed)
    const suppliedBody = /^(?:正文|内容|补充|具体内容|就发|就说|改成|以下是|答复内容)(?:是|为|[:：\s])/.test(prose)
    const questionSelection =
        /^(?:关于|针对|就是|选择|选|是)/.test(prose) ||
        ((previous.candidateQuestionIds?.length ?? 0) > 1 && prose.length <= 80 && !/^(?:请|帮我|麻烦|补充|把|将|向|给|问)/.test(prose))
    const choseQuestion =
        previous.kind === 'reply' &&
        questionSelection &&
        Boolean(
            selectedQuestion(
                prose,
                allowed.flatMap(candidate => candidate.questions ?? []),
                false
            )
        )
    if (!choseTarget && !suppliedBody && !choseQuestion) return undefined
    return resolveSelection(previous.kind, allowed, prose, 'clarification', previous)
}
