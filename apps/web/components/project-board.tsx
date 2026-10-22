'use client'

import Link from 'next/link'
import { useState } from 'react'
import { buildProjectBoard, EMPTY_BOARD_FILTERS, type BoardCard, type BoardColumnId, type BoardFilters } from '../lib/project-board'
import { ProjectProgressFeedback, type ProjectProgressReadState, type WorkTemplateOrigin } from './project-progress'
import { Badge } from './ui/badge'
import { Button } from './ui/button'
import { Card, CardContent, CardHeader, CardTitle } from './ui/card'
import { Checkbox } from './ui/checkbox'
import { FeedbackMessage } from './ui/feedback-message'
import { Label } from './ui/label'
import { NativeSelect, NativeSelectOption } from './ui/native-select'
import { SearchInput } from './ui/search-input'

const wrap = 'min-w-0 [overflow-wrap:anywhere]'

/**
 * Renders one safe work card with bounded waits and only the actual viewer's navigation grants.
 * @param props - Fully derived safe card, authenticated viewer, and optional frozen template identities.
 * @returns A read-only card without private goals, question bodies, or any mutation action.
 */
function ProjectBoardCard({ card, userId, origin }: { card: BoardCard; userId: string | undefined; origin?: WorkTemplateOrigin }) {
    const [expanded, setExpanded] = useState(false)
    const node = card.node
    const visibleWaits = expanded ? card.waits : card.waits.slice(0, 3)
    const incoming = card.waits.filter(wait => wait.direction === 'incoming').length
    const outgoing = card.waits.filter(wait => wait.direction === 'outgoing').length
    const self = card.waits.filter(wait => wait.direction === 'self').length
    const mine = node.ownerId === userId
    return (
        <li className={wrap}>
            <Card size="sm" className={`${wrap} gap-3 shadow-none`}>
                <CardHeader className={wrap}>
                    <CardTitle className={`${wrap} text-sm font-semibold`}>{node.title}</CardTitle>
                    <div className="flex min-w-0 flex-wrap items-start gap-2">
                        <Badge variant="secondary" className="h-auto min-h-5 max-w-full whitespace-normal text-left">
                            <span className={wrap}>{card.statusLabel}</span>
                        </Badge>
                        {card.pendingForViewer && <Badge variant="outline">待我处理</Badge>}
                    </div>
                    <p className={`${wrap} text-xs text-muted-foreground`}>工作 {node.id.slice(0, 8)}</p>
                </CardHeader>
                <CardContent className={`${wrap} grid gap-3`}>
                    <p className={wrap}>
                        负责人：{node.ownerName}
                        {mine ? '（我）' : ''} · {node.ownerId.slice(0, 8)}
                    </p>
                    <p className={`${wrap} text-xs text-muted-foreground`}>
                        更新于 <time dateTime={node.updatedAt}>{new Date(node.updatedAt).toLocaleString('zh-CN')}</time>
                    </p>
                    <p className={`${wrap} text-sm text-muted-foreground`}>
                        {card.upstream
                            ? `上游：${card.upstream.title}（${card.upstream.ownerName} · ${card.upstream.id.slice(0, 8)}）`
                            : card.upstreamUnavailable
                              ? '原上游当前不可用'
                              : '根工作，无上游'}
                    </p>
                    {origin && (
                        <p className={`${wrap} text-xs text-muted-foreground`}>
                            协作模板 {origin.templateId.slice(0, 8)} · v{origin.version} · 原节点 {origin.nodeId.slice(0, 8)}
                        </p>
                    )}
                    {card.hint && (
                        <FeedbackMessage variant={node.status === 'failed' ? 'error' : card.column === 'check' ? 'warning' : 'info'}>
                            {card.hint}
                        </FeedbackMessage>
                    )}
                    {card.waits.length > 0 && (
                        <section className={`${wrap} grid gap-2`} aria-label="关联协作请求">
                            <p className={`${wrap} text-xs text-muted-foreground`}>
                                {card.waits.length} 项关联请求 · 入站 {incoming} · 出站 {outgoing} · 本人判断 {self}
                            </p>
                            <ul className="grid min-w-0 gap-2">
                                {visibleWaits.map(wait => (
                                    <li key={wait.id} className={`${wrap} grid gap-1 border-l-2 pl-2`}>
                                        <p className={`${wrap} text-sm`}>{wait.text}</p>
                                        <p className={`${wrap} text-xs text-muted-foreground`}>
                                            {wait.direction === 'incoming'
                                                ? '入站请求'
                                                : wait.direction === 'outgoing'
                                                  ? '对外等待'
                                                  : '本人判断'}
                                            {wait.pendingForViewer ? ' · 待我处理' : ''} ·{' '}
                                            {new Date(wait.createdAt).toLocaleString('zh-CN')} · {wait.id.slice(0, 8)}
                                        </p>
                                    </li>
                                ))}
                            </ul>
                            {card.waits.length > 3 && (
                                <Button
                                    type="button"
                                    variant="outline"
                                    className="h-auto min-h-8 max-w-full whitespace-normal"
                                    onClick={() => setExpanded(value => !value)}
                                >
                                    {expanded ? '收起其余请求' : `展开其余 ${card.waits.length - 3} 项`}
                                </Button>
                            )}
                        </section>
                    )}
                    {mine && card.ownHref && (
                        <Link className="text-sm underline" href={card.ownHref}>
                            {card.canContinue ? '继续我的聊天' : '查看我的聊天'}
                        </Link>
                    )}
                    {mine && card.repairHref && (
                        <Link className="text-sm underline" href={card.repairHref}>
                            查看失败与修复
                        </Link>
                    )}
                </CardContent>
            </Card>
        </li>
    )
}

/**
 * Displays bounded read-only board columns from the same complete snapshot as project overview.
 * @param props - Shared parent read state, viewer, safe template labels, and existing parent actions.
 * @returns Six state groups with full-set intersection filters, honest counts, and incremental rendering.
 */
export function ProjectBoardView({
    progress,
    userId,
    origins = {},
    onStart,
    onRefresh,
}: {
    progress: ProjectProgressReadState
    userId: string | undefined
    origins?: Record<string, WorkTemplateOrigin>
    onStart(): void
    onRefresh(): void
}) {
    const [filters, setFilters] = useState<BoardFilters>({ ...EMPTY_BOARD_FILTERS })
    const [limits, setLimits] = useState<Partial<Record<BoardColumnId, number>>>({})
    const data = progress.data
    const board = data ? buildProjectBoard(data, userId, filters) : null
    const filtering = Boolean(filters.query.trim() || filters.ownerId || filters.pendingOnly)
    const owner = board?.owners.find(person => person.id === filters.ownerId)
    /**
     * Applies a local intersection filter before display limits and resets all column batches.
     * @param next - Complete next local filter state without persistence or business writes.
     * @returns Nothing; retains only the new filters and initial twenty-card limits.
     */
    function changeFilters(next: BoardFilters) {
        setFilters(next)
        setLimits({})
    }
    return (
        <section className="grid min-w-0 gap-5" aria-labelledby="project-board-title">
            <div className="grid min-w-0 gap-2">
                <h2 id="project-board-title" className="text-[length:var(--type-subheading)] font-semibold">
                    项目看板
                </h2>
                {board && (
                    <>
                        <p className="text-sm text-muted-foreground">当前获授权项目进度 · 全部 {board.total} 项工作</p>
                        <p className="text-sm text-muted-foreground">当前匹配 {board.matched} 项</p>
                    </>
                )}
            </div>
            <ProjectProgressFeedback progress={progress} board />
            {board && (
                <>
                    <div className="grid min-w-0 gap-4 border-b py-5">
                        <div className="grid min-w-0 gap-4 sm:grid-cols-2 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
                            <div className="grid min-w-0 gap-2">
                                <Label htmlFor="board-search">搜索工作</Label>
                                <SearchInput
                                    id="board-search"
                                    placeholder="工作名称、负责人或短编号"
                                    value={filters.query}
                                    onValueChange={query => changeFilters({ ...filters, query })}
                                />
                            </div>
                            <div className="grid min-w-0 gap-2">
                                <Label htmlFor="board-owner">负责人</Label>
                                <NativeSelect
                                    id="board-owner"
                                    className="w-full min-w-0"
                                    value={filters.ownerId}
                                    onChange={event => changeFilters({ ...filters, ownerId: event.target.value })}
                                >
                                    <NativeSelectOption value="">全部负责人</NativeSelectOption>
                                    {board.owners.map(person => (
                                        <NativeSelectOption key={person.id} value={person.id}>
                                            {person.name}
                                            {person.id === userId ? '（我）' : ''} · {person.id.slice(0, 8)}
                                            {person.historical ? ' · 历史身份' : ''}
                                        </NativeSelectOption>
                                    ))}
                                </NativeSelect>
                                {owner && (
                                    <p className={`${wrap} text-xs text-muted-foreground`}>
                                        已选：{owner.name} · {owner.id.slice(0, 8)}
                                        {owner.historical ? ' · 历史身份' : ''}
                                    </p>
                                )}
                            </div>
                        </div>
                        <div className="flex min-w-0 flex-wrap items-center gap-3">
                            <Label htmlFor="board-pending" className="flex min-h-11 items-center gap-2">
                                <Checkbox
                                    id="board-pending"
                                    checked={filters.pendingOnly}
                                    onCheckedChange={checked => changeFilters({ ...filters, pendingOnly: checked === true })}
                                />
                                仅看待我处理
                            </Label>
                            <Button variant="outline" disabled={!filtering} onClick={() => changeFilters({ ...EMPTY_BOARD_FILTERS })}>
                                清除筛选
                            </Button>
                            <Button variant="outline" disabled={progress.loading} onClick={onRefresh}>
                                刷新看板
                            </Button>
                        </div>
                        <p className="text-xs text-muted-foreground">
                            看板只读。状态来自真实工作记录；请求数与工作卡数分别统计，不表示完成率。
                        </p>
                    </div>
                    {board.total === 0 ? (
                        <Card>
                            <CardContent className="grid min-h-40 place-content-center gap-3 text-center">
                                <h3 className="font-medium">还没有协作工作</h3>
                                <p className="text-sm text-muted-foreground">可创建一项本人工作，进入普通空聊天。</p>
                                <Button onClick={onStart}>开始我的工作</Button>
                            </CardContent>
                        </Card>
                    ) : (
                        <>
                            {board.matched === 0 && (
                                <div className="grid gap-3 border-y py-5">
                                    <p>没有符合当前筛选的工作。</p>
                                    <Button variant="outline" onClick={() => changeFilters({ ...EMPTY_BOARD_FILTERS })}>
                                        清除筛选查看全部
                                    </Button>
                                </div>
                            )}
                            <nav className="flex min-w-0 flex-wrap gap-x-4 gap-y-2" aria-label="跳到看板状态组">
                                {board.columns.map(column => (
                                    <a
                                        key={column.id}
                                        href={`#board-column-${column.id}`}
                                        className="inline-flex min-h-11 items-center text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                                    >
                                        {column.label}（{column.cards.length}）
                                    </a>
                                ))}
                            </nav>
                            <div className="grid min-w-0 items-start gap-4 md:grid-cols-2 xl:grid-cols-3">
                                {board.columns.map(column => {
                                    const limit = limits[column.id] ?? 20
                                    const remaining = Math.max(0, column.cards.length - limit)
                                    return (
                                        <section
                                            className="grid min-w-0 gap-3 rounded-xl bg-muted p-3"
                                            key={column.id}
                                            aria-labelledby={`board-column-${column.id}`}
                                        >
                                            <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-2">
                                                <h3
                                                    id={`board-column-${column.id}`}
                                                    tabIndex={-1}
                                                    className="scroll-mt-4 text-[length:var(--type-subheading)] font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                                >
                                                    {column.label}
                                                </h3>
                                                <p className="text-xs text-muted-foreground">
                                                    {filtering
                                                        ? `匹配 ${column.cards.length} 项 / 全部 ${column.total} 项`
                                                        : `${column.total} 项`}
                                                </p>
                                            </div>
                                            {column.cards.length ? (
                                                <>
                                                    <p id={`board-scroll-hint-${column.id}`} className="text-xs text-muted-foreground">
                                                        较长列表可纵向滚动；Tab 可进入工作链接。
                                                    </p>
                                                    <div
                                                        role="region"
                                                        aria-label={`${column.label}工作列表`}
                                                        aria-describedby={`board-scroll-hint-${column.id}`}
                                                        tabIndex={0}
                                                        className="max-h-[min(60dvh,40rem)] min-w-0 overflow-y-auto rounded-lg p-1 outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                                    >
                                                        <ol className="grid min-w-0 gap-3" aria-label={`${column.label}工作`}>
                                                            {column.cards.slice(0, limit).map(card => (
                                                                <ProjectBoardCard
                                                                    key={card.node.id}
                                                                    card={card}
                                                                    userId={userId}
                                                                    origin={origins[card.node.id]}
                                                                />
                                                            ))}
                                                        </ol>
                                                    </div>
                                                </>
                                            ) : (
                                                <p className="text-sm text-muted-foreground">该列暂无匹配工作。</p>
                                            )}
                                            {remaining > 0 && (
                                                <Button
                                                    variant="outline"
                                                    className="h-auto min-h-8 max-w-full whitespace-normal"
                                                    onClick={() => setLimits(current => ({ ...current, [column.id]: limit + 20 }))}
                                                >
                                                    再显示20项（剩余{remaining}项）
                                                </Button>
                                            )}
                                        </section>
                                    )
                                })}
                            </div>
                        </>
                    )}
                </>
            )}
        </section>
    )
}
