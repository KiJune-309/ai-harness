'use client'

import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react'

type IconName = 'file' | 'search' | 'plus' | 'arrow' | 'close' | 'check'

function Icon({ name }: { name: IconName }) {
    const paths: Record<IconName, ReactNode> = {
        file: (
            <>
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
                <path d="M14 2v6h6M8 13h8M8 17h5" />
            </>
        ),
        search: (
            <>
                <circle cx="10.5" cy="10.5" r="6.5" />
                <path d="m16 16 4.5 4.5" />
            </>
        ),
        plus: <path d="M12 5v14M5 12h14" />,
        arrow: <path d="M5 12h14m-6-6 6 6-6 6" />,
        close: <path d="m6 6 12 12M6 18 18 6" />,
        check: <path d="m5 12 4 4L19 6" />,
    }

    return (
        <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
        >
            {paths[name]}
        </svg>
    )
}

function ResourceDialog({
    title,
    onClose,
    children,
    dialogRef,
}: {
    title: string
    onClose: () => void
    children: ReactNode
    dialogRef: RefObject<HTMLDialogElement | null>
}) {
    useEffect(() => {
        dialogRef.current?.showModal()
    }, [dialogRef])

    return (
        <dialog ref={dialogRef} className="resource-dialog" aria-labelledby="resource-dialog-title" onClose={onClose}>
            <div className="dialog-heading">
                <div>
                    <h2 id="resource-dialog-title">{title}</h2>
                </div>
                <button className="icon-button dialog-close" type="button" aria-label="关闭详情" onClick={() => dialogRef.current?.close()}>
                    <Icon name="close" />
                </button>
            </div>
            {children}
        </dialog>
    )
}

type DemoDocument = {
    id: string
    title: string
    type: string
    meta: string
    description: string
    excerpt: string
    topics: string[]
}

const initialDocuments: DemoDocument[] = [
    {
        id: 'product',
        title: '产品需求文档',
        type: 'PDF',
        meta: '12 页 · 248 KB',
        description: '明确工作区目标与第一阶段范围。',
        excerpt:
            '让人与 LLM 在同一个工作区里协作。从一个清晰的问题开始，让对话、资料和任务自然连接起来。第一阶段聚焦聊天体验、资料管理和任务可见性。',
        topics: ['产品目标', '工作区', '功能范围'],
    },
    {
        id: 'research',
        title: '用户访谈摘录',
        type: 'DOC',
        meta: '8 页 · 96 KB',
        description: '记录日常研究、信息整理与协作习惯。',
        excerpt:
            '受访者希望在开始工作时快速找到上下文，不必在多个工具间反复切换。一个安静的界面、明确的进度和可以继续追问的结果，有助于保持专注。',
        topics: ['用户研究', '协作习惯', '访谈记录'],
    },
    {
        id: 'design',
        title: '设计系统指南',
        type: 'MD',
        meta: '6 节 · 32 KB',
        description: '统一排版、间距与组件交互。',
        excerpt: '以黑、白、灰建立层次。留白承担布局，文字承担信息，细线承担边界。交互状态应该清晰可见，同时让工作内容成为视觉中心。',
        topics: ['界面设计', '排版', '交互原则'],
    },
]

export function LibraryView() {
    const [documents, setDocuments] = useState(initialDocuments)
    const [query, setQuery] = useState('')
    const [activeDocument, setActiveDocument] = useState<DemoDocument | null>(null)
    const [announcement, setAnnouncement] = useState('')
    const openerRef = useRef<HTMLButtonElement | null>(null)
    const dialogRef = useRef<HTMLDialogElement>(null)
    const trimmedQuery = query.trim().toLowerCase()
    const filteredDocuments = documents.filter(document =>
        `${document.title} ${document.description} ${document.type}`.toLowerCase().includes(trimmedQuery)
    )

    function addDemoDocument() {
        const number = documents.length - initialDocuments.length + 1
        setDocuments(current => [
            ...current,
            {
                id: `demo-note-${number}`,
                title: number === 1 ? '工作区灵感笔记' : `工作区灵感笔记 ${number}`,
                type: 'MD',
                meta: '1 节 · 2 KB',
                description: '记录想法，列出下一步。',
                excerpt: '把有价值的想法放在这里：先写下想解决的问题，再整理现有上下文。让每一次讨论都留下下一步可以使用的线索。',
                topics: ['灵感笔记', '工作笔记'],
            },
        ])
        setQuery('')
        setAnnouncement('资料已添加')
    }

    function closeDocument() {
        setActiveDocument(null)
        openerRef.current?.focus()
    }

    return (
        <section className="page-view library-page">
            <header className="page-heading">
                <div className="page-heading-row">
                    <div>
                        <h1>资料库</h1>
                    </div>
                    <button className="action-button page-primary-action" type="button" onClick={addDemoDocument}>
                        <Icon name="plus" />
                        <span>添加资料</span>
                    </button>
                </div>
            </header>
            <div className="toolbar library-toolbar">
                <span className="library-view-label">
                    全部资料 <span className="resource-count">{documents.length}</span>
                </span>
                <label className="search-field">
                    <Icon name="search" />
                    <input
                        type="search"
                        value={query}
                        onChange={event => setQuery(event.target.value)}
                        placeholder="搜索资料"
                        aria-label="搜索资料"
                    />
                </label>
            </div>
            <div className="list-surface">
                {filteredDocuments.map(document => (
                    <button
                        className="resource-row"
                        key={document.id}
                        type="button"
                        onClick={event => {
                            openerRef.current = event.currentTarget
                            setActiveDocument(document)
                        }}
                        aria-label={`查看${document.title}详情`}
                    >
                        <span className="resource-primary">
                            <span className="resource-icon">
                                <Icon name="file" />
                            </span>
                            <span className="resource-info">
                                <strong>{document.title}</strong>
                                <span className="resource-description">{document.description}</span>
                            </span>
                        </span>
                        <span className="resource-meta">
                            {document.type} · {document.meta}
                        </span>
                        <span className="resource-arrow">
                            <Icon name="arrow" />
                        </span>
                    </button>
                ))}
                {filteredDocuments.length === 0 && <p className="empty-message">没有找到相关资料，试试其他关键词。</p>}
            </div>
            <p className="sr-only" role="status">
                {announcement}
            </p>
            {activeDocument && (
                <ResourceDialog title={activeDocument.title} onClose={closeDocument} dialogRef={dialogRef}>
                    <p className="muted">{activeDocument.description}</p>
                    <div className="detail-meta">
                        <span className="small-meta">
                            {activeDocument.type} · {activeDocument.meta}
                        </span>
                    </div>
                    <div className="detail-content">
                        <span className="detail-label">内容预览</span>
                        <p>{activeDocument.excerpt}</p>
                    </div>
                    <div className="detail-tags">
                        {activeDocument.topics.map(topic => (
                            <span key={topic}>{topic}</span>
                        ))}
                    </div>
                </ResourceDialog>
            )}
        </section>
    )
}
