'use client'

import { useId, useState } from 'react'
import { zhCN } from 'react-day-picker/locale'
import {
    CalendarIcon,
    Check,
    ChevronLeft,
    ChevronRight,
    Circle,
    CircleCheck,
    CircleDot,
    FileText,
    FolderOpen,
    Plus,
    Upload,
} from 'lucide-react'
import { GallerySection } from './gallery-section'
import styles from './gallery.module.css'
import { Button } from './ui/button'
import { EmptyState } from './ui/empty-state'
import { Badge } from './ui/badge'
import { Calendar } from './ui/calendar'
import { Input } from './ui/input'
import { SearchInput } from './ui/search-input'
import { Label } from './ui/label'
import { Pagination, PaginationContent, PaginationItem } from './ui/pagination'
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover'
import { Progress, ProgressLabel, ProgressValue } from './ui/progress'
import { Skeleton } from './ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table'

const sampleRows = [
    { name: '产品访谈整理', status: '进行中', type: '研究记录' },
    { name: '资料结构设计', status: '已完成', type: '设计文档' },
    { name: '下周工作计划', status: '未开始', type: '工作计划' },
    { name: '组件交互检查', status: '进行中', type: '设计检查' },
]

/**
 * Demonstrates collection, date, file and feedback components with local state.
 * @returns Responsive examples without business requests or file-content access.
 */
export function GalleryCollections() {
    const prefix = useId()
    const [query, setQuery] = useState('')
    const [page, setPage] = useState(1)
    const [date, setDate] = useState<Date | undefined>()
    const [fileName, setFileName] = useState('')
    const [exampleAdded, setExampleAdded] = useState(false)
    const [progress, setProgress] = useState(40)
    const filtered = sampleRows.filter(row => row.name.includes(query))
    const pages = Math.max(1, Math.ceil(filtered.length / 2))

    return (
        <div className={styles.collectionStack}>
            <GallerySection title="表格与分页" description="先读到名称，再看到状态。用轻量行分隔保留清晰的阅读顺序。">
                <div className={styles.tableToolbar}>
                    <SearchInput
                        id={`${prefix}-search`}
                        aria-label="搜索示例任务"
                        containerClassName={styles.searchField}
                        placeholder="搜索示例任务"
                        value={query}
                        onValueChange={value => {
                            setQuery(value)
                            setPage(1)
                        }}
                    />
                    <span className={styles.caption}>演示数据</span>
                </div>
                <Table className="table-fixed">
                    <TableHeader>
                        <TableRow>
                            <TableHead className="whitespace-normal">任务名称</TableHead>
                            <TableHead className="w-24 whitespace-normal">状态</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {filtered.slice((page - 1) * 2, page * 2).map(row => (
                            <TableRow key={row.name}>
                                <TableCell className="py-4 whitespace-normal">
                                    <div className={styles.rowName}>
                                        <FileText aria-hidden="true" />
                                        <span className="min-w-0 break-words">{row.name}</span>
                                    </div>
                                    <p className={styles.rowMeta}>{row.type}</p>
                                </TableCell>
                                <TableCell className="whitespace-normal">
                                    <Badge variant={row.status === '已完成' ? 'success' : 'secondary'}>
                                        {row.status === '已完成' ? (
                                            <CircleCheck aria-hidden="true" />
                                        ) : row.status === '进行中' ? (
                                            <CircleDot aria-hidden="true" />
                                        ) : (
                                            <Circle aria-hidden="true" />
                                        )}
                                        {row.status}
                                    </Badge>
                                </TableCell>
                            </TableRow>
                        ))}
                        {!filtered.length && (
                            <TableRow>
                                <TableCell colSpan={2} className="py-10 text-center whitespace-normal text-muted-foreground">
                                    没有匹配的示例，试试其他名称。
                                </TableCell>
                            </TableRow>
                        )}
                    </TableBody>
                </Table>
                <div className={styles.tableFoot}>
                    <p className={styles.hint} role="status">
                        共 {filtered.length} 条 · 每页 2 条
                    </p>
                    <Pagination aria-label="示例表格分页">
                        <PaginationContent>
                            <PaginationItem>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    aria-label="上一页"
                                    disabled={page <= 1}
                                    onClick={() => setPage(value => value - 1)}
                                >
                                    <ChevronLeft aria-hidden="true" />
                                </Button>
                            </PaginationItem>
                            <PaginationItem className="px-2 text-xs text-muted-foreground" aria-current="page">
                                {page} / {pages}
                            </PaginationItem>
                            <PaginationItem>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    aria-label="下一页"
                                    disabled={page >= pages}
                                    onClick={() => setPage(value => value + 1)}
                                >
                                    <ChevronRight aria-hidden="true" />
                                </Button>
                            </PaginationItem>
                        </PaginationContent>
                    </Pagination>
                </div>
            </GallerySection>
            <GallerySection title="日期与文件" description="简短的操作入口，配合明确的选择结果与使用说明。">
                <div className={styles.utilityGrid}>
                    <div className={styles.field}>
                        <Label htmlFor={`${prefix}-date`}>日期</Label>
                        <Popover>
                            <PopoverTrigger render={<Button id={`${prefix}-date`} variant="outline" className="justify-start" />}>
                                <CalendarIcon aria-hidden="true" />
                                {date ? date.toLocaleDateString('zh-CN') : '选择日期'}
                            </PopoverTrigger>
                            <PopoverContent className="w-auto p-0">
                                <Calendar mode="single" selected={date} onSelect={setDate} locale={zhCN} />
                            </PopoverContent>
                        </Popover>
                        <p className={styles.hint}>点击日期可再次调整。</p>
                    </div>
                    <div className={styles.field}>
                        <Label htmlFor={`${prefix}-file`}>本地文件</Label>
                        <div className={styles.upload}>
                            <Upload aria-hidden="true" />
                            <span className="text-sm font-medium">{fileName ? '更换文件' : '点击选择文件'}</span>
                            <span id={`${prefix}-file-hint`} className={styles.hint}>
                                仅显示文件名，不读取或上传
                            </span>
                            <Input
                                id={`${prefix}-file`}
                                type="file"
                                className="h-full"
                                aria-describedby={`${prefix}-file-hint`}
                                onChange={event => setFileName(event.target.files?.[0]?.name ?? '')}
                            />
                        </div>
                        {fileName && (
                            <p className={styles.fileName} role="status">
                                {fileName}
                            </p>
                        )}
                    </div>
                </div>
            </GallerySection>
            <GallerySection title="空态" description="给出当前状态与下一步，让第一次使用也有清楚的方向。">
                <EmptyState
                    titleAs="h3"
                    icon={<div className={styles.emptyIcon}>{exampleAdded ? <Check /> : <FolderOpen />}</div>}
                    title={exampleAdded ? '演示条目已加入' : '这里还没有内容'}
                    description={exampleAdded ? '当前页面已切换到有内容的演示状态。' : '从一个清楚的操作开始，逐步建立你的内容。'}
                    actionLabel={exampleAdded ? '恢复空态' : '添加演示条目'}
                    actionIcon={exampleAdded ? undefined : <Plus />}
                    actionVariant={exampleAdded ? 'outline' : 'default'}
                    onAction={() => setExampleAdded(value => !value)}
                    aria-live="polite"
                />
                <p className={`${styles.hint} text-center`}>仅切换本地展示状态</p>
            </GallerySection>
            <GallerySection title="进度与加载" description="可确定的进度显示数值，等待内容时保留稳定的阅读轮廓。">
                <div className={styles.utilityGrid}>
                    <div className={styles.feedbackStack}>
                        <p className={styles.caption}>确定进度</p>
                        <Progress value={progress}>
                            <ProgressLabel>演示进度</ProgressLabel>
                            <ProgressValue />
                        </Progress>
                        <div className={styles.buttonRow}>
                            <Button variant="outline" onClick={() => setProgress(value => (value >= 100 ? 0 : value + 20))}>
                                {progress >= 100 ? '重新演示' : '更新演示进度'}
                            </Button>
                        </div>
                        <p className={styles.hint}>每次增加 20%，不代表真实处理进度。</p>
                    </div>
                    <div className={styles.feedbackStack}>
                        <p className={styles.caption}>加载骨架</p>
                        <div className={styles.skeletonCard} role="img" aria-label="加载骨架示例">
                            <Skeleton className="size-10 shrink-0 rounded-lg" />
                            <div className={styles.skeletonLines}>
                                <Skeleton className="h-3 w-2/3" />
                                <Skeleton className="h-3 w-full" />
                                <Skeleton className="h-3 w-1/2" />
                            </div>
                        </div>
                        <p className={styles.hint}>用于内容读取中，与没有内容的空态区分。</p>
                    </div>
                </div>
            </GallerySection>
        </div>
    )
}
