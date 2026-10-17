'use client'

import {
    ArrowDown,
    ArrowUp,
    CalendarDays,
    Check,
    ChevronDown,
    ChevronLeft,
    ChevronRight,
    CircleCheck,
    FileText,
    Folder,
    Info,
    Plus,
    TriangleAlert,
    X,
} from 'lucide-react'
import { useEffect, useId, useRef, useState, type DragEvent, type ReactNode } from 'react'
import styles from './gallery-collections.module.css'

function CollectionCard({ title, meta, full = false, children }: { title: string; meta: string; full?: boolean; children: ReactNode }) {
    const titleId = useId()
    return (
        <article className={`${styles.card} ${full ? styles.fullSample : ''}`} aria-labelledby={titleId} data-component={meta}>
            <header className={styles.cardHeading}>
                <h3 id={titleId}>{title}</h3>
            </header>
            <div className={styles.cardBody}>{children}</div>
        </article>
    )
}

type RecordType = '文档' | '表格' | '便签'
type TableRecord = { id: string; name: string; type: RecordType; updated: string }
const records: TableRecord[] = [
    { id: 'requirements', name: '产品需求', type: '文档', updated: '2026-10-12' },
    { id: 'interview', name: '访谈摘录', type: '文档', updated: '2026-10-11' },
    { id: 'design', name: '设计指南', type: '文档', updated: '2026-10-10' },
    { id: 'roadmap', name: '项目计划', type: '表格', updated: '2026-10-09' },
    { id: 'schedule', name: '本周安排', type: '表格', updated: '2026-10-08' },
    { id: 'research', name: '研究记录', type: '表格', updated: '2026-10-07' },
    { id: 'ideas', name: '灵感收集', type: '便签', updated: '2026-10-06' },
    { id: 'reading', name: '阅读笔记', type: '便签', updated: '2026-10-05' },
    { id: 'meeting', name: '会议要点', type: '便签', updated: '2026-10-04' },
]

function TableCollection() {
    const [filter, setFilter] = useState<RecordType | '全部'>('全部')
    const [sort, setSort] = useState<{ key: 'name' | 'updated'; direction: 'asc' | 'desc' }>({ key: 'updated', direction: 'desc' })
    const [page, setPage] = useState(1)
    const [selected, setSelected] = useState<string[]>([])
    const selectAllRef = useRef<HTMLInputElement>(null)
    const filterId = useId()
    const sortedRecords = records
        .filter(record => filter === '全部' || record.type === filter)
        .sort((a, b) => {
            const order = a[sort.key].localeCompare(b[sort.key], 'zh-CN')
            return sort.direction === 'asc' ? order : -order
        })
    const pageCount = Math.max(1, Math.ceil(sortedRecords.length / 3))
    const currentPage = Math.min(page, pageCount)
    const pageRecords = sortedRecords.slice((currentPage - 1) * 3, currentPage * 3)
    const pageSelectedCount = pageRecords.filter(record => selected.includes(record.id)).length
    const allPageSelected = pageRecords.length > 0 && pageSelectedCount === pageRecords.length

    useEffect(() => {
        if (selectAllRef.current) selectAllRef.current.indeterminate = pageSelectedCount > 0 && !allPageSelected
    }, [pageSelectedCount, allPageSelected])

    function changeSort(key: 'name' | 'updated') {
        setSort(current => ({ key, direction: current.key === key && current.direction === 'asc' ? 'desc' : 'asc' }))
        setPage(1)
    }

    function togglePageSelection() {
        const pageIds = pageRecords.map(record => record.id)
        setSelected(current => (allPageSelected ? current.filter(id => !pageIds.includes(id)) : [...new Set([...current, ...pageIds])]))
    }

    function toggleRecord(id: string) {
        setSelected(current => (current.includes(id) ? current.filter(value => value !== id) : [...current, id]))
    }

    function sortDirection(key: 'name' | 'updated'): 'none' | 'ascending' | 'descending' {
        return sort.key !== key ? 'none' : sort.direction === 'asc' ? 'ascending' : 'descending'
    }

    return (
        <CollectionCard title="数据表格" meta="TABLE / PAGINATION" full>
            <div className={styles.tableToolbar}>
                <label className={styles.inlineLabel} htmlFor={filterId}>
                    类型
                    <span className="select-control">
                        <select
                            id={filterId}
                            className={styles.control}
                            value={filter}
                            onChange={event => {
                                setFilter(event.target.value as RecordType | '全部')
                                setPage(1)
                            }}
                        >
                            <option>全部</option>
                            <option>文档</option>
                            <option>表格</option>
                            <option>便签</option>
                        </select>
                        <ChevronDown size={14} aria-hidden="true" />
                    </span>
                </label>
                <span className={styles.caption}>每页 3 项</span>
            </div>
            <div className={styles.tableFrame}>
                <table className={styles.table}>
                    <caption className={styles.srOnly}>资料表格，可按名称或更新日期排序，每页显示三项。</caption>
                    <thead>
                        <tr>
                            <th scope="col" className={styles.checkboxCell}>
                                <label className={styles.checkboxTarget}>
                                    <input
                                        ref={selectAllRef}
                                        type="checkbox"
                                        className={styles.checkbox}
                                        checked={allPageSelected}
                                        onChange={togglePageSelection}
                                        aria-label="选择当前页全部条目"
                                    />
                                </label>
                            </th>
                            <th scope="col" aria-sort={sortDirection('name')}>
                                <button type="button" className={styles.sortButton} onClick={() => changeSort('name')}>
                                    <span>名称</span>
                                    {sort.key === 'name' &&
                                        (sort.direction === 'asc' ? (
                                            <ArrowUp size={12} aria-hidden="true" />
                                        ) : (
                                            <ArrowDown size={12} aria-hidden="true" />
                                        ))}
                                </button>
                            </th>
                            <th scope="col">类型</th>
                            <th scope="col" aria-sort={sortDirection('updated')}>
                                <button type="button" className={styles.sortButton} onClick={() => changeSort('updated')}>
                                    <span>更新日期</span>
                                    {sort.key === 'updated' &&
                                        (sort.direction === 'asc' ? (
                                            <ArrowUp size={12} aria-hidden="true" />
                                        ) : (
                                            <ArrowDown size={12} aria-hidden="true" />
                                        ))}
                                </button>
                            </th>
                        </tr>
                    </thead>
                    <tbody>
                        {pageRecords.map(record => (
                            <tr key={record.id} className={selected.includes(record.id) ? styles.selectedRow : undefined}>
                                <td className={styles.checkboxCell}>
                                    <label className={styles.checkboxTarget}>
                                        <input
                                            type="checkbox"
                                            className={styles.checkbox}
                                            checked={selected.includes(record.id)}
                                            onChange={() => toggleRecord(record.id)}
                                            aria-label={`选择${record.name}`}
                                        />
                                    </label>
                                </td>
                                <th scope="row">{record.name}</th>
                                <td>{record.type}</td>
                                <td className={styles.dateCell}>{record.updated.slice(5).replace('-', '/')}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
            <div className={styles.tableFooter}>
                <p className={styles.caption} role="status">
                    共 {sortedRecords.length} 项 · 已选 {selected.length} 项
                </p>
                <nav className={styles.pagination} aria-label="资料表格分页">
                    <button
                        type="button"
                        className={styles.pageButton}
                        disabled={currentPage === 1}
                        onClick={() => setPage(currentPage - 1)}
                        aria-label="上一页"
                    >
                        <ChevronLeft size={14} aria-hidden="true" />
                    </button>
                    {Array.from({ length: pageCount }, (_, index) => index + 1).map(number => (
                        <button
                            key={number}
                            type="button"
                            className={`${styles.pageButton} ${currentPage === number ? styles.currentPage : ''}`}
                            aria-label={`第 ${number} 页`}
                            aria-current={currentPage === number ? 'page' : undefined}
                            onClick={() => setPage(number)}
                        >
                            {number}
                        </button>
                    ))}
                    <button
                        type="button"
                        className={styles.pageButton}
                        disabled={currentPage === pageCount}
                        onClick={() => setPage(currentPage + 1)}
                        aria-label="下一页"
                    >
                        <ChevronRight size={14} aria-hidden="true" />
                    </button>
                </nav>
            </div>
        </CollectionCard>
    )
}

const directories = [
    { name: '产品与设计', files: ['产品需求.md', '设计系统.md', '交互说明.md'] },
    { name: '日常工作', files: ['工作计划.md', '阅读笔记.md'] },
]

function DirectoryCollection() {
    const [selectedFile, setSelectedFile] = useState('产品需求.md')
    return (
        <CollectionCard title="目录" meta="DIRECTORY / DISCLOSURE">
            <div className={styles.directory}>
                {directories.map((directory, index) => (
                    <details key={directory.name} open={index === 0}>
                        <summary>
                            <ChevronRight size={14} className={styles.disclosureArrow} aria-hidden="true" />
                            <Folder size={16} aria-hidden="true" />
                            <span>{directory.name}</span>
                            <span className={styles.directoryCount}>{directory.files.length}</span>
                        </summary>
                        <ul>
                            {directory.files.map(file => (
                                <li key={file}>
                                    <button
                                        type="button"
                                        className={`${styles.directoryFile} ${selectedFile === file ? styles.selectedFile : ''}`}
                                        onClick={() => setSelectedFile(file)}
                                        aria-pressed={selectedFile === file}
                                    >
                                        <FileText size={14} aria-hidden="true" />
                                        <span>{file}</span>
                                    </button>
                                </li>
                            ))}
                        </ul>
                    </details>
                ))}
            </div>
            <p className={styles.directorySelection} role="status">
                当前选择 <strong>{selectedFile}</strong>
            </p>
        </CollectionCard>
    )
}

function DateCollection() {
    const [date, setDate] = useState('')
    const dateId = useId()
    const dateDescriptionId = useId()
    const formattedDate = date
        ? date
              .split('-')
              .map((value, index) => `${Number(value)}${['年', '月', '日'][index]}`)
              .join('')
        : ''
    return (
        <CollectionCard title="日期选择" meta="DATE PICKER">
            <div className={styles.dateContent}>
                <div className={styles.dateLabel}>
                    <CalendarDays size={16} aria-hidden="true" />
                    <label className={styles.fieldLabel} htmlFor={dateId}>
                        计划日期
                    </label>
                </div>
                <input
                    id={dateId}
                    className={styles.dateInput}
                    type="date"
                    value={date}
                    onChange={event => setDate(event.target.value)}
                    aria-describedby={dateDescriptionId}
                />
                <p id={dateDescriptionId} className={styles.caption} role="status">
                    {date ? `已选择 ${formattedDate}` : '选择一个日期，安排下一步。'}
                </p>
                <button type="button" className={styles.button} disabled={!date} onClick={() => setDate('')}>
                    清除日期
                </button>
            </div>
        </CollectionCard>
    )
}

type SelectedFile = { id: string; name: string; size: number }

function formatFileSize(bytes: number) {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${Number((bytes / 1024).toFixed(1))} KB`
    return `${Number((bytes / (1024 * 1024)).toFixed(1))} MB`
}

function FileCollection() {
    const [files, setFiles] = useState<SelectedFile[]>([])
    const [dragging, setDragging] = useState(false)
    const fileId = useId()
    const fileDescriptionId = useId()
    const inputRef = useRef<HTMLInputElement>(null)

    function selectFiles(selection: FileList | null) {
        setFiles(
            Array.from(selection ?? []).map((file, index) => ({
                id: `${file.name}-${file.lastModified}-${index}`,
                name: file.name,
                size: file.size,
            }))
        )
    }

    function dropFiles(event: DragEvent<HTMLLabelElement>) {
        event.preventDefault()
        setDragging(false)
        if (!event.dataTransfer.files.length) return
        selectFiles(event.dataTransfer.files)
        if (inputRef.current) inputRef.current.files = event.dataTransfer.files
    }

    return (
        <CollectionCard title="文件选择" meta="FILE INPUT / DROP ZONE">
            <label
                htmlFor={fileId}
                className={`${styles.dropZone} ${dragging ? styles.dragging : ''}`}
                onDragOver={event => {
                    event.preventDefault()
                    setDragging(event.dataTransfer.types.includes('Files'))
                }}
                onDragLeave={event => {
                    if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return
                    setDragging(false)
                }}
                onDrop={dropFiles}
            >
                <span className={styles.dropZoneIntro}>
                    <FileText size={28} aria-hidden="true" />
                    <strong>拖入文件，或点击选择</strong>
                </span>
                <span id={fileDescriptionId}>查看文件名称与大小</span>
                <span className={`${styles.button} ${styles.filePicker}`}>
                    选择文件
                    <input
                        ref={inputRef}
                        id={fileId}
                        type="file"
                        multiple
                        className={styles.fileInput}
                        onChange={event => selectFiles(event.currentTarget.files)}
                        aria-describedby={fileDescriptionId}
                        aria-label="选择一个或多个文件"
                    />
                </span>
            </label>
            <div className={styles.fileSummaryRow}>
                <p className={styles.fileSummary} role="status">
                    {files.length ? `已选择 ${files.length} 个文件` : '尚未选择文件'}
                </p>
                {files.length > 0 && (
                    <button
                        type="button"
                        className={styles.button}
                        onClick={() => {
                            setFiles([])
                            if (inputRef.current) inputRef.current.value = ''
                            inputRef.current?.focus()
                        }}
                    >
                        清除选择
                    </button>
                )}
            </div>
            {files.length > 0 && (
                <ul className={styles.fileList}>
                    {files.map(file => (
                        <li key={file.id}>
                            <FileText size={14} aria-hidden="true" />
                            <span>
                                <strong>{file.name}</strong>
                                <small>{formatFileSize(file.size)}</small>
                            </span>
                        </li>
                    ))}
                </ul>
            )}
        </CollectionCard>
    )
}

function StatusCollection() {
    return (
        <CollectionCard title="状态与头像" meta="BADGE / AVATAR">
            <div className={styles.statusComparison}>
                <div>
                    <p className={styles.sampleLabel}>状态标记</p>
                    <div className={styles.badgeRow}>
                        <span className={styles.badge}>待处理</span>
                        <span className={`${styles.badge} ${styles.progressBadge}`}>
                            <span className={styles.statusDot} aria-hidden="true" />
                            <span>进行中</span>
                        </span>
                        <span className={`${styles.badge} ${styles.outlineBadge}`}>
                            <Check size={12} aria-hidden="true" />
                            <span>已完成</span>
                        </span>
                        <span className={`${styles.badge} ${styles.quietBadge}`}>已归档</span>
                    </div>
                </div>
                <div>
                    <p className={styles.sampleLabel}>头像尺寸</p>
                    <ul className={styles.avatarRow} aria-label="头像尺寸">
                        <li>
                            <span role="img" aria-label="小号 K 字母头像" className={`${styles.avatar} ${styles.smallAvatar}`}>
                                K
                            </span>
                            <span>24 px</span>
                        </li>
                        <li>
                            <span role="img" aria-label="标准 K 字母头像" className={styles.avatar}>
                                K
                            </span>
                            <span>32 px</span>
                        </li>
                        <li>
                            <span role="img" aria-label="大号 K 字母头像" className={`${styles.avatar} ${styles.largeAvatar}`}>
                                K
                            </span>
                            <span>40 px</span>
                        </li>
                    </ul>
                </div>
            </div>
        </CollectionCard>
    )
}

type NoticeKind = 'info' | 'success' | 'warning'
const notices: Record<NoticeKind, { title: string; description: string }> = {
    info: { title: '信息通知', description: '在这里查看提示与最新动态。' },
    success: { title: '成功通知', description: '清晰反馈每一步的操作结果。' },
    warning: { title: '提醒通知', description: '继续之前，留意需要确认的信息。' },
}

function NotificationCollection() {
    const [notice, setNotice] = useState<NoticeKind | null>('info')
    const triggerRefs = useRef<Partial<Record<NoticeKind, HTMLButtonElement | null>>>({})
    const lastKindRef = useRef<NoticeKind>('info')
    const NoticeIcon = notice === 'success' ? CircleCheck : notice === 'warning' ? TriangleAlert : Info

    function dismissNotice() {
        setNotice(null)
        triggerRefs.current[lastKindRef.current]?.focus()
    }

    return (
        <CollectionCard title="通知反馈" meta="NOTIFICATION">
            <div className={styles.feedbackStage}>
                <div className={styles.noticeArea}>
                    {notice ? (
                        <div className={styles.notice} role={notice === 'warning' ? 'alert' : 'status'}>
                            <NoticeIcon size={18} aria-hidden="true" />
                            <div>
                                <strong>{notices[notice].title}</strong>
                                <p>{notices[notice].description}</p>
                            </div>
                            <button type="button" className={styles.iconButton} aria-label="关闭通知" onClick={dismissNotice}>
                                <X size={14} aria-hidden="true" />
                            </button>
                        </div>
                    ) : (
                        <p className={styles.noticeEmpty}>选择一种状态，查看通知。</p>
                    )}
                </div>
            </div>
            <div className={styles.feedbackControls} role="group" aria-label="通知状态">
                {(['info', 'success', 'warning'] as NoticeKind[]).map(kind => (
                    <button
                        key={kind}
                        ref={element => {
                            triggerRefs.current[kind] = element
                        }}
                        className={`${styles.button} ${notice === kind ? styles.activeButton : ''}`}
                        type="button"
                        aria-pressed={notice === kind}
                        onClick={() => {
                            lastKindRef.current = kind
                            setNotice(kind)
                        }}
                    >
                        {kind === 'info' ? '信息' : kind === 'success' ? '成功' : '提醒'}
                    </button>
                ))}
            </div>
        </CollectionCard>
    )
}

function EmptyCollection() {
    const [hasEntry, setHasEntry] = useState(false)
    const addButtonRef = useRef<HTMLButtonElement>(null)
    const removeButtonRef = useRef<HTMLButtonElement>(null)

    function toggleEntry(value: boolean) {
        setHasEntry(value)
        requestAnimationFrame(() => {
            if (value) removeButtonRef.current?.focus()
            else addButtonRef.current?.focus()
        })
    }

    return (
        <CollectionCard title="空状态" meta="EMPTY STATE">
            <div className={`${styles.feedbackStage} ${styles.emptyStage}`}>
                {hasEntry ? (
                    <div className={styles.entry}>
                        <FileText size={20} aria-hidden="true" />
                        <div>
                            <strong>新条目</strong>
                            <span>一条记录，新的开始。</span>
                        </div>
                    </div>
                ) : (
                    <div className={styles.emptyState}>
                        <Folder size={30} strokeWidth={1.5} aria-hidden="true" />
                        <div className={styles.emptyCopy}>
                            <strong>还没有内容</strong>
                            <p>从一条记录开始。</p>
                        </div>
                    </div>
                )}
                <p className={styles.srOnly} role="status">
                    {hasEntry ? '已添加新条目' : '当前没有条目'}
                </p>
                <div className={styles.feedbackControls}>
                    {hasEntry ? (
                        <button
                            ref={removeButtonRef}
                            className={styles.button}
                            type="button"
                            aria-label="移除新条目"
                            onClick={() => toggleEntry(false)}
                        >
                            <X size={14} aria-hidden="true" />
                            <span>移除条目</span>
                        </button>
                    ) : (
                        <button
                            ref={addButtonRef}
                            className={`${styles.button} ${styles.primaryButton}`}
                            type="button"
                            onClick={() => toggleEntry(true)}
                        >
                            <Plus size={14} aria-hidden="true" />
                            <span>添加一项</span>
                        </button>
                    )}
                </div>
            </div>
        </CollectionCard>
    )
}

function LoadingCollection() {
    const [progress, setProgress] = useState(40)
    const progressId = useId()
    const rangeId = useId()
    return (
        <CollectionCard title="加载与进度" meta="SKELETON / PROGRESS">
            <div className={`${styles.feedbackStage} ${styles.loadingStage}`}>
                <div className={styles.progressHeading}>
                    <label htmlFor={progressId}>进度</label>
                    <span>{progress}%</span>
                </div>
                <progress id={progressId} className={styles.progress} max={100} value={progress} />
                <p className={styles.loadingLabel}>{progress < 100 ? '内容加载中' : '内容已就绪'}</p>
                {progress < 100 ? (
                    <div className={styles.skeleton} aria-hidden="true">
                        <span />
                        <span />
                        <span />
                    </div>
                ) : (
                    <p className={styles.progressComplete} role="status">
                        <CircleCheck size={18} aria-hidden="true" />
                        <span>进度已到 100%</span>
                    </p>
                )}
                <div className={styles.feedbackControls}>
                    <label className={styles.rangeLabel} htmlFor={rangeId}>
                        调整进度
                    </label>
                    <input
                        id={rangeId}
                        className={styles.range}
                        type="range"
                        min={0}
                        max={100}
                        step={10}
                        value={progress}
                        onChange={event => setProgress(Number(event.target.value))}
                    />
                </div>
            </div>
        </CollectionCard>
    )
}

export function GalleryCollections() {
    return (
        <div className={styles.sections}>
            <section id="collections" className={styles.section} aria-labelledby="collections-title">
                <header className={styles.sectionHeading}>
                    <h2 id="collections-title">集合与选择</h2>
                    <span className={styles.sectionOrdinal} aria-hidden="true">
                        05
                    </span>
                </header>
                <div className={styles.grid}>
                    <TableCollection />
                    <DirectoryCollection />
                    <DateCollection />
                    <FileCollection />
                </div>
            </section>
            <section id="feedback" className={styles.section} aria-labelledby="feedback-title">
                <header className={styles.sectionHeading}>
                    <h2 id="feedback-title">状态与反馈</h2>
                    <span className={styles.sectionOrdinal} aria-hidden="true">
                        06
                    </span>
                </header>
                <div className={`${styles.grid} ${styles.feedbackGrid}`}>
                    <StatusCollection />
                    <NotificationCollection />
                    <EmptyCollection />
                    <LoadingCollection />
                </div>
            </section>
        </div>
    )
}
