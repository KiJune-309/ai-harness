'use client'

import {
    ArrowRight,
    Check,
    ChevronDown,
    CircleHelp,
    Copy,
    Layers,
    LoaderCircle,
    MoreHorizontal,
    PanelRight,
    Plus,
    TriangleAlert,
    X,
} from 'lucide-react'
import { useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type FormEvent, type ReactNode } from 'react'
import { GalleryCollections } from './gallery-collections'
import styles from './component-gallery.module.css'

const sections = [
    ['foundations', '视觉基础'],
    ['actions', '按钮与导航'],
    ['fields', '输入与表单'],
    ['overlays', '浮层'],
    ['collections', '集合'],
    ['feedback', '反馈'],
] as const

type ColorSpec = { token: string; label: string; value: string; usage?: string }

const colors: ColorSpec[] = [
    { token: '--surface', label: '页面表面', value: '#FFFFFF', usage: '页面内容' },
    { token: '--sidebar', label: '侧栏背景', value: '#ECECEC', usage: '侧栏 / 抽屉' },
    { token: '--selected', label: '选中背景', value: '#E0E0E0', usage: '当前导航 / 选中' },
    { token: '--line', label: '分隔线', value: '#DCDCD6', usage: '控件 / 分隔' },
    { token: '--muted', label: '次级文字', value: '#5C5C5C', usage: '补充说明' },
    { token: '--ink', label: '主要文字', value: '#222222', usage: '主要内容' },
]

type TypographySpec = {
    role: string
    size: number
    mobileSize?: number
    weight: number
    lineHeight: number
    sample: string
}

const typography: TypographySpec[] = [
    { role: 'Hero', size: 24, mobileSize: 24, weight: 550, lineHeight: 1.35, sample: '新对话' },
    { role: 'Display', size: 36, weight: 500, lineHeight: 1.5, sample: 'Ag 字' },
    { role: 'Heading', size: 30, weight: 500, lineHeight: 1.5, sample: '让想法向前' },
    { role: 'Title', size: 22, weight: 550, lineHeight: 1.5, sample: '从一个想法开始' },
    { role: 'Body', size: 15, weight: 400, lineHeight: 1.9, sample: '把每一个细节，放在合适的位置。' },
    { role: 'Label', size: 14, weight: 500, lineHeight: 1.5, sample: '清晰的名称，明确的动作' },
    { role: 'Caption', size: 13, weight: 400, lineHeight: 1.6, sample: '恰到好处的补充说明' },
]

function ColorPalette({ onCopy }: { onCopy: (token: string) => void }) {
    return (
        <div className={styles.palette}>
            {colors.map(color => (
                <button
                    key={color.token}
                    className={styles.swatch}
                    aria-label={'复制' + color.label + '颜色值'}
                    onClick={() => onCopy(color.token)}
                >
                    {color.token === '--ink' || color.token === '--muted' ? (
                        <span className={styles.swatchText} style={{ color: 'var(' + color.token + ')' }}>
                            <span>Aa</span>
                            <Copy size={12} aria-hidden="true" />
                        </span>
                    ) : (
                        <span className={styles.swatchColor} style={{ background: 'var(' + color.token + ')' }}>
                            <Copy size={12} aria-hidden="true" />
                        </span>
                    )}
                    <strong>{color.label}</strong>
                    {color.usage && <span className={styles.swatchUsage}>{color.usage}</span>}
                    <span>{color.value}</span>
                </button>
            ))}
        </div>
    )
}

function GalleryButton({
    tone = 'secondary',
    scale = 'medium',
    busy = false,
    className = '',
    children,
    disabled,
    type = 'button',
    ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
    tone?: 'primary' | 'secondary' | 'ghost'
    scale?: 'small' | 'medium' | 'large'
    busy?: boolean
}) {
    return (
        <button
            {...props}
            type={type}
            disabled={disabled || busy}
            aria-busy={busy || undefined}
            className={[styles.button, styles[tone], styles[scale], className].join(' ')}
        >
            {busy && <LoaderCircle size={14} className={styles.spinner} aria-hidden="true" />}
            {typeof children === 'string' ? <span>{children}</span> : children}
        </button>
    )
}

function GallerySection({
    id,
    number,
    title,
    english,
    children,
}: {
    id: string
    number: string
    title: string
    english: string
    children: ReactNode
}) {
    return (
        <section id={id} className={styles.section} aria-labelledby={id + '-title'} data-category={english}>
            <div className={styles.sectionHeading}>
                <h2 id={id + '-title'}>{title}</h2>
                <span className={styles.sectionOrdinal} aria-hidden="true">
                    {number}
                </span>
            </div>
            <div className={styles.board}>{children}</div>
        </section>
    )
}

function GalleryCard({
    title,
    english,
    full = false,
    help,
    children,
}: {
    title: string
    english: string
    full?: boolean
    help?: ReactNode
    children: ReactNode
}) {
    const titleId = useId()
    return (
        <article className={`${styles.card} ${full ? styles.fullSample : ''}`} aria-labelledby={titleId} data-component={english}>
            <header className={styles.cardHeading}>
                <h3 id={titleId}>{title}</h3>
            </header>
            <div className={styles.cardBody}>{children}</div>
            {help && <div className={styles.sampleHelp}>{help}</div>}
        </article>
    )
}

type OverlayKind = 'dialog' | 'drawer' | null

export function ComponentGallery() {
    const prefix = useId()
    const galleryRef = useRef<HTMLDivElement>(null)
    const sectionNavRef = useRef<HTMLElement>(null)
    const [activeSection, setActiveSection] = useState<string>('foundations')
    const [notice, setNotice] = useState('')
    const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
    const [activeTab, setActiveTab] = useState(0)
    const tabRefs = useRef<(HTMLButtonElement | null)[]>([])
    const [shortName, setShortName] = useState('')
    const [description, setDescription] = useState('')
    const [checked, setChecked] = useState(true)
    const [notifications, setNotifications] = useState(true)
    const [frequency, setFrequency] = useState('weekly')
    const [projectName, setProjectName] = useState('')
    const [formError, setFormError] = useState('')
    const nameRef = useRef<HTMLInputElement>(null)
    const [tooltipOpen, setTooltipOpen] = useState(false)
    const tooltipTriggerRef = useRef<HTMLButtonElement>(null)
    const [overlay, setOverlay] = useState<OverlayKind>(null)
    const overlayRef = useRef<HTMLDialogElement>(null)
    const overlayTriggerRef = useRef<HTMLElement | null>(null)
    const menuRef = useRef<HTMLDetailsElement>(null)
    const tabs = ['概览', '资料', '动态']

    useEffect(() => {
        const scrollRoot = galleryRef.current?.closest('.route-content')
        if (!(scrollRoot instanceof HTMLElement)) return
        const elements = sections.map(([id]) => document.getElementById(id)).filter((element): element is HTMLElement => Boolean(element))
        let frame = 0

        function updateLayout() {
            const gallery = galleryRef.current
            if (!gallery || !(scrollRoot instanceof HTMLElement)) return
            const anchorOffset = (sectionNavRef.current?.offsetHeight ?? 0) + 24
            const endSpace = Math.max(40, scrollRoot.clientHeight - anchorOffset - (elements.at(-1)?.offsetHeight ?? 0))
            gallery.style.setProperty('--gallery-anchor-offset', `${anchorOffset}px`)
            gallery.style.setProperty('--gallery-end-space', `${endSpace}px`)
        }

        function updateSection() {
            if (!(scrollRoot instanceof HTMLElement)) return
            const readingLine = scrollRoot.getBoundingClientRect().top + (sectionNavRef.current?.offsetHeight ?? 0) + 25
            let current = elements[0]?.id ?? 'foundations'
            for (const element of elements) {
                if (element.getBoundingClientRect().top <= readingLine) current = element.id
            }
            if (scrollRoot.scrollTop + scrollRoot.clientHeight >= scrollRoot.scrollHeight - 2) {
                current = elements.at(-1)?.id ?? current
            }
            setActiveSection(current)
        }

        function scheduleUpdate() {
            cancelAnimationFrame(frame)
            frame = requestAnimationFrame(() => {
                updateLayout()
                updateSection()
            })
        }

        const observer = new IntersectionObserver(scheduleUpdate, { root: scrollRoot, threshold: [0, 0.1, 0.5, 1] })
        const resizeObserver = new ResizeObserver(scheduleUpdate)
        elements.forEach(element => observer.observe(element))
        resizeObserver.observe(scrollRoot)
        if (sectionNavRef.current) resizeObserver.observe(sectionNavRef.current)
        const lastSection = elements.at(-1)
        if (lastSection) resizeObserver.observe(lastSection)
        scrollRoot.addEventListener('scroll', scheduleUpdate, { passive: true })
        window.addEventListener('resize', scheduleUpdate)
        updateLayout()
        const initialSection = elements.find(element => '#' + element.id === window.location.hash)
        initialSection?.scrollIntoView({ block: 'start' })
        scheduleUpdate()
        return () => {
            observer.disconnect()
            resizeObserver.disconnect()
            scrollRoot.removeEventListener('scroll', scheduleUpdate)
            window.removeEventListener('resize', scheduleUpdate)
            cancelAnimationFrame(frame)
        }
    }, [])

    useEffect(
        () => () => {
            if (noticeTimer.current) clearTimeout(noticeTimer.current)
        },
        []
    )

    function notify(message: string) {
        if (noticeTimer.current) clearTimeout(noticeTimer.current)
        setNotice(message)
        noticeTimer.current = setTimeout(() => setNotice(''), 3500)
    }

    async function copyColor(token: string) {
        const value = getComputedStyle(document.documentElement).getPropertyValue(token).trim()
        try {
            await navigator.clipboard.writeText(value)
            notify('颜色值已复制：' + value)
        } catch {
            notify('未能复制，请手动选择颜色值。')
        }
    }

    function openOverlay(kind: Exclude<OverlayKind, null>) {
        overlayTriggerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
        setOverlay(kind)
        overlayRef.current?.showModal()
    }

    function closeOverlay() {
        setOverlay(null)
        overlayTriggerRef.current?.focus()
    }

    function submitForm(event: FormEvent<HTMLFormElement>) {
        event.preventDefault()
        if (!projectName.trim()) {
            setFormError('请填写项目名称。')
            nameRef.current?.focus()
            return
        }
        setFormError('')
        notify('已确认项目名称：' + projectName.trim())
    }

    function chooseMenu(action: string) {
        if (menuRef.current) menuRef.current.open = false
        menuRef.current?.querySelector('summary')?.focus()
        notify(action)
    }

    return (
        <div className={styles.gallery} ref={galleryRef}>
            <header className={styles.pageHeading}>
                <h1>组件展示</h1>
                <p>查看视觉规范、控件状态与交互方式。</p>
            </header>
            <nav ref={sectionNavRef} className={styles.sectionNav} aria-label="组件分类">
                <div className={styles.navLinks}>
                    {sections.map(([id, label]) => (
                        <a key={id} href={'#' + id} aria-current={activeSection === id ? 'location' : undefined}>
                            {label}
                        </a>
                    ))}
                </div>
                <div className={styles.mobileSectionNav}>
                    <label htmlFor={prefix + '-category'}>组件分类</label>
                    <span className="select-control">
                        <select
                            id={prefix + '-category'}
                            value={activeSection}
                            onChange={event => {
                                const sectionId = event.target.value
                                document.getElementById(sectionId)?.scrollIntoView({ block: 'start' })
                                window.location.hash = sectionId
                            }}
                        >
                            {sections.map(([id, label]) => (
                                <option key={id} value={id}>
                                    {label}
                                </option>
                            ))}
                        </select>
                        <ChevronDown size={14} aria-hidden="true" />
                    </span>
                </div>
            </nav>

            <GallerySection id="foundations" number="01" title="视觉基础" english="FOUNDATIONS">
                <GalleryCard title="颜色" english="Colors" full>
                    <ColorPalette onCopy={copyColor} />
                </GalleryCard>
                <GalleryCard title="排版" english="Typography" full help="系统字体与阅读字体的语义层级。">
                    <div className={styles.typeList}>
                        {typography.map(type => (
                            <div className={styles.typeRow} key={type.role}>
                                <span>{type.role}</span>
                                <span
                                    className={`${styles.typeSample} ${type.role === 'Hero' ? styles.editorialType : ''}`}
                                    style={{
                                        fontSize: type.role === 'Hero' ? undefined : type.size,
                                        fontWeight: type.weight,
                                        lineHeight: type.lineHeight,
                                    }}
                                >
                                    {type.sample}
                                </span>
                                <span>
                                    {type.mobileSize ? `${type.size}/${type.mobileSize}px` : `${type.size}px`}
                                    <br />
                                    {type.weight}
                                </span>
                            </div>
                        ))}
                    </div>
                </GalleryCard>
                <GalleryCard title="圆角" english="Continuous corners" help="圆角采用连续曲率。">
                    <div className={styles.cornerSamples}>
                        {[
                            ['--radius-xs', '8px'],
                            ['--radius-sm', '12px'],
                            ['--radius-md', '16px'],
                            ['--radius-lg', '20px'],
                            ['--radius-xl', '26px'],
                        ].map(([token, value]) => (
                            <div key={token}>
                                <span style={{ borderRadius: 'var(' + token + ')' }} />
                                <span>{value}</span>
                            </div>
                        ))}
                    </div>
                </GalleryCard>
                <GalleryCard title="间距与图标" english="Spacing & icons" help="图文间距 4px，图标采用一致的细线描边。">
                    <div className={styles.spacingSamples}>
                        {[4, 8, 12, 16, 20, 28].map(value => (
                            <div key={value}>
                                <span style={{ width: value }} />
                                <span>{value}</span>
                            </div>
                        ))}
                    </div>
                    <div className={styles.iconSamples}>
                        <span>
                            <Plus size={14} aria-hidden="true" />
                            <span>14px</span>
                        </span>
                        <span>
                            <Copy size={16} aria-hidden="true" />
                            <span>16px</span>
                        </span>
                        <span>
                            <Layers size={18} aria-hidden="true" />
                            <span>18px</span>
                        </span>
                        <span>
                            <PanelRight size={20} aria-hidden="true" />
                            <span>20px</span>
                        </span>
                    </div>
                </GalleryCard>
            </GallerySection>

            <GallerySection id="actions" number="02" title="按钮与导航" english="ACTIONS & NAVIGATION">
                <GalleryCard title="按钮" english="Button">
                    <div className={styles.exampleRow}>
                        <span className={styles.rowLabel}>外观</span>
                        <GalleryButton tone="primary" onClick={() => notify('操作已确认')}>
                            确认操作
                        </GalleryButton>
                        <GalleryButton onClick={() => notify('操作已取消')}>次要操作</GalleryButton>
                        <GalleryButton tone="ghost" onClick={() => notify('轻量操作已触发')}>
                            <span>轻量操作</span>
                            <ArrowRight size={14} aria-hidden="true" />
                        </GalleryButton>
                    </div>
                    <div className={styles.exampleRow}>
                        <span className={styles.rowLabel}>尺寸</span>
                        <GalleryButton scale="small" onClick={() => notify('小号按钮已触发')}>
                            小号
                        </GalleryButton>
                        <GalleryButton onClick={() => notify('常规按钮已触发')}>常规</GalleryButton>
                        <GalleryButton scale="large" onClick={() => notify('大号按钮已触发')}>
                            大号
                        </GalleryButton>
                    </div>
                    <div className={styles.exampleRow}>
                        <span className={styles.rowLabel}>状态</span>
                        <GalleryButton disabled>不可用</GalleryButton>
                        <GalleryButton busy>处理中</GalleryButton>
                        <GalleryButton tone="primary" onClick={() => openOverlay('dialog')}>
                            <Plus size={14} aria-hidden="true" />
                            <span>添加项目</span>
                        </GalleryButton>
                    </div>
                </GalleryCard>
                <GalleryCard title="标签页与图标按钮" english="Tabs & icon buttons">
                    <div className={styles.tabs} role="tablist" aria-label="项目内容">
                        {tabs.map((tab, index) => (
                            <button
                                key={tab}
                                ref={node => {
                                    tabRefs.current[index] = node
                                }}
                                type="button"
                                role="tab"
                                id={prefix + '-tab-' + index}
                                aria-controls={prefix + '-panel-' + index}
                                aria-selected={activeTab === index}
                                tabIndex={activeTab === index ? 0 : -1}
                                onClick={() => setActiveTab(index)}
                                onKeyDown={event => {
                                    let next = index
                                    if (event.key === 'ArrowRight') next = (index + 1) % tabs.length
                                    else if (event.key === 'ArrowLeft') next = (index + tabs.length - 1) % tabs.length
                                    else if (event.key === 'Home') next = 0
                                    else if (event.key === 'End') next = tabs.length - 1
                                    else return
                                    event.preventDefault()
                                    setActiveTab(next)
                                    tabRefs.current[next]?.focus()
                                }}
                            >
                                {tab}
                            </button>
                        ))}
                    </div>
                    {tabs.map((tab, index) => (
                        <div
                            key={tab}
                            className={styles.tabPanel}
                            role="tabpanel"
                            id={prefix + '-panel-' + index}
                            aria-labelledby={prefix + '-tab-' + index}
                            tabIndex={0}
                            hidden={activeTab !== index}
                        >
                            <strong>{['产品工作区', '资料与上下文', '最近的动态'][index]}</strong>
                            <p>
                                {
                                    [
                                        '把想法、资料和要做的事放在一起。',
                                        '需求文档、研究笔记与设计指南。',
                                        '今天 · 整理了工作区的信息层级。',
                                    ][index]
                                }
                            </p>
                        </div>
                    ))}
                    <div className={styles.exampleRow}>
                        <span className={styles.rowLabel}>图标</span>
                        <button className={styles.iconButton} aria-label="添加内容" onClick={() => notify('添加操作已触发')}>
                            <Plus size={18} aria-hidden="true" />
                        </button>
                        <button className={styles.iconButton} aria-label="查看更多操作" onClick={() => notify('更多操作已触发')}>
                            <MoreHorizontal size={18} aria-hidden="true" />
                        </button>
                        <button className={styles.iconButton} aria-label="关闭内容" onClick={() => notify('关闭操作已触发')}>
                            <X size={18} aria-hidden="true" />
                        </button>
                    </div>
                </GalleryCard>
            </GallerySection>

            <GallerySection id="fields" number="03" title="输入与表单" english="INPUTS & FORMS">
                <GalleryCard title="文本输入" english="Input">
                    <div className={styles.fieldStack}>
                        <label className={styles.field}>
                            <span>默认</span>
                            <input placeholder="工作区名称" />
                        </label>
                        <label className={styles.field}>
                            <span>已填写</span>
                            <input defaultValue="产品与设计" />
                        </label>
                        <label className={styles.field}>
                            <span>不可编辑</span>
                            <input disabled value="当前不可编辑" readOnly />
                        </label>
                        <label className={styles.field}>
                            <span>输入校验</span>
                            <input
                                value={shortName}
                                aria-label="输入校验"
                                onChange={event => setShortName(event.target.value)}
                                aria-invalid={shortName.trim().length < 2}
                                aria-describedby={prefix + '-input-error'}
                                placeholder="请输入名称"
                            />
                            <span
                                className={shortName.trim().length < 2 ? styles.fieldError : styles.fieldHint}
                                id={prefix + '-input-error'}
                            >
                                {shortName.trim().length < 2 ? (
                                    <>
                                        <TriangleAlert size={16} aria-hidden="true" />
                                        <span>请至少填写 2 个字符，再继续。</span>
                                    </>
                                ) : (
                                    '名称长度符合要求。'
                                )}
                            </span>
                        </label>
                    </div>
                </GalleryCard>
                <GalleryCard title="多行文本与选择" english="Textarea & Select" help={checked ? '资料上下文已选择' : '资料上下文未选择'}>
                    <label className={styles.field}>
                        <span>任务描述</span>
                        <textarea
                            value={description}
                            aria-label="任务描述"
                            onChange={event => setDescription(event.target.value)}
                            maxLength={240}
                            rows={4}
                            placeholder="任务与背景…"
                        />
                        <span className={styles.counter}>{description.length} / 240</span>
                    </label>
                    <label className={styles.field}>
                        <span>优先级</span>
                        <span className="select-control">
                            <select defaultValue="normal">
                                <option value="low">低优先级</option>
                                <option value="normal">普通优先级</option>
                                <option value="high">高优先级</option>
                            </select>
                            <ChevronDown size={14} aria-hidden="true" />
                        </span>
                    </label>
                    <div className={styles.formDivider} />
                    <label className={styles.checkLabel}>
                        <input type="checkbox" checked={checked} onChange={event => setChecked(event.target.checked)} />
                        <span>包含资料上下文</span>
                    </label>
                </GalleryCard>
                <GalleryCard title="单选与开关" english="Radio & Switch">
                    <fieldset className={styles.radioGroup}>
                        <legend>总结频率</legend>
                        {[
                            ['daily', '每天'],
                            ['weekly', '每周'],
                            ['monthly', '每月'],
                        ].map(([value, label]) => (
                            <label key={value} className={styles.checkLabel}>
                                <input
                                    type="radio"
                                    name={prefix + '-frequency'}
                                    value={value}
                                    checked={frequency === value}
                                    onChange={() => setFrequency(value)}
                                />
                                <span>{label}</span>
                            </label>
                        ))}
                    </fieldset>
                    <div className={styles.formDivider} />
                    <label className={styles.switchLabel}>
                        <span>
                            <strong>接收提醒</strong>
                            <span>{notifications ? '提醒已开启' : '提醒已关闭'}</span>
                        </span>
                        <span className={styles.switchControl}>
                            <input
                                type="checkbox"
                                role="switch"
                                aria-label="接收提醒"
                                checked={notifications}
                                onChange={event => setNotifications(event.target.checked)}
                            />
                            <span className={styles.switchTrack} />
                        </span>
                    </label>
                </GalleryCard>
                <GalleryCard title="表单校验" english="Form">
                    <form className={styles.fieldStack} onSubmit={submitForm} noValidate>
                        <label className={styles.field}>
                            <span>
                                项目名称 <span aria-hidden="true">*</span>
                            </span>
                            <input
                                ref={nameRef}
                                value={projectName}
                                onChange={event => {
                                    setProjectName(event.target.value)
                                    if (formError) setFormError('')
                                }}
                                required
                                maxLength={80}
                                aria-invalid={Boolean(formError)}
                                aria-describedby={formError ? prefix + '-form-error' : undefined}
                                placeholder="例如：产品体验"
                            />
                        </label>
                        <label className={styles.field}>
                            <span>项目类型</span>
                            <span className="select-control">
                                <select defaultValue="design">
                                    <option value="design">产品与设计</option>
                                    <option value="research">研究与整理</option>
                                    <option value="personal">日常工作</option>
                                </select>
                                <ChevronDown size={14} aria-hidden="true" />
                            </span>
                        </label>
                        {formError && (
                            <p className={styles.error} role="alert" id={prefix + '-form-error'}>
                                <TriangleAlert size={16} aria-hidden="true" />
                                <span>{formError}</span>
                            </p>
                        )}
                        <div className={styles.formActions}>
                            <GalleryButton tone="primary" type="submit">
                                <span>确认名称</span>
                                <ArrowRight size={14} aria-hidden="true" />
                            </GalleryButton>
                        </div>
                    </form>
                </GalleryCard>
            </GallerySection>

            <GallerySection id="overlays" number="04" title="浮层与提示" english="OVERLAYS">
                <GalleryCard title="对话框" english="Dialog">
                    <div className={styles.miniDialog}>
                        <div className={styles.previewHeading}>
                            <strong>让下一步更清晰</strong>
                            <X size={14} aria-hidden="true" />
                        </div>
                        <p>用一个简短的确认，聚焦当前操作。</p>
                        <div className={styles.formActions}>
                            <GalleryButton onClick={() => notify('操作已取消')}>取消</GalleryButton>
                            <GalleryButton tone="primary" onClick={() => openOverlay('dialog')}>
                                打开对话框
                            </GalleryButton>
                        </div>
                    </div>
                </GalleryCard>
                <GalleryCard title="侧边抽屉" english="Drawer">
                    <div className={styles.drawerPreview} aria-hidden="true">
                        <div>
                            <span />
                            <span />
                            <span />
                        </div>
                        <div>
                            <strong>项目详情</strong>
                            <span />
                            <span />
                            <span />
                        </div>
                    </div>
                    <div className={styles.previewFooter}>
                        <span>保留上下文，展开更多细节</span>
                        <GalleryButton onClick={() => openOverlay('drawer')}>
                            <PanelRight size={14} aria-hidden="true" />
                            <span>打开抽屉</span>
                        </GalleryButton>
                    </div>
                </GalleryCard>
                <GalleryCard title="文字提示" english="Tooltip" help="悬停、聚焦或点击图标查看提示。">
                    <div className={styles.tooltipExample}>
                        <div
                            className={styles.tooltipAnchor}
                            data-open={tooltipOpen || undefined}
                            onMouseEnter={() => setTooltipOpen(true)}
                            onMouseLeave={() => setTooltipOpen(document.activeElement === tooltipTriggerRef.current)}
                        >
                            <button
                                className={styles.iconButton}
                                ref={tooltipTriggerRef}
                                aria-label="查看提示"
                                aria-describedby={tooltipOpen ? prefix + '-tooltip' : undefined}
                                onFocus={() => setTooltipOpen(true)}
                                onBlur={() => setTooltipOpen(false)}
                                onClick={() => setTooltipOpen(true)}
                                onKeyDown={event => {
                                    if (event.key === 'Escape') {
                                        event.preventDefault()
                                        setTooltipOpen(false)
                                    }
                                }}
                            >
                                <CircleHelp size={20} aria-hidden="true" />
                            </button>
                            <span role="tooltip" id={prefix + '-tooltip'} className={styles.tooltip} hidden={!tooltipOpen}>
                                为当前操作补充简短说明。
                            </span>
                        </div>
                    </div>
                </GalleryCard>
                <GalleryCard title="操作菜单" english="Dropdown" help="将相关动作放在同一个入口。">
                    <div className={styles.menuExample}>
                        <details
                            ref={menuRef}
                            className={styles.menu}
                            onKeyDown={event => {
                                if (event.key === 'Escape' && menuRef.current?.open) {
                                    event.preventDefault()
                                    menuRef.current.open = false
                                    menuRef.current.querySelector('summary')?.focus()
                                }
                            }}
                        >
                            <summary>
                                <span>项目操作</span>
                                <ChevronDown size={14} aria-hidden="true" />
                            </summary>
                            <div className={styles.menuItems}>
                                <button onClick={() => chooseMenu('重命名操作已选择')}>
                                    <span>重命名</span>
                                    <span>名称</span>
                                </button>
                                <button onClick={() => chooseMenu('复制操作已选择')}>
                                    <span>创建副本</span>
                                    <Copy size={14} aria-hidden="true" />
                                </button>
                                <div />
                                <button onClick={() => chooseMenu('归档操作已选择')}>归档项目</button>
                            </div>
                        </details>
                    </div>
                </GalleryCard>
            </GallerySection>

            <GalleryCollections />
            <div className={styles.notice} role="status">
                {notice && (
                    <>
                        <Check size={15} aria-hidden="true" />
                        <span>{notice}</span>
                    </>
                )}
            </div>
            <dialog
                ref={overlayRef}
                className={overlay === 'drawer' ? styles.drawer : styles.dialog}
                aria-labelledby={prefix + '-overlay-title'}
                aria-describedby={prefix + '-overlay-description'}
                onClose={closeOverlay}
            >
                <div className={styles.overlayHeading}>
                    <span>{overlay === 'drawer' ? 'PROJECT DETAILS' : 'CONFIRMATION'}</span>
                    <button className={styles.iconButton} aria-label="关闭组件浮层" onClick={() => overlayRef.current?.close()}>
                        <X size={18} aria-hidden="true" />
                    </button>
                </div>
                <h2 id={prefix + '-overlay-title'}>{overlay === 'drawer' ? '产品体验改进' : '准备好迈出下一步了吗？'}</h2>
                <p id={prefix + '-overlay-description'}>
                    {overlay === 'drawer' ? '把目标、上下文和下一步放在一起。' : '确认后继续推进，或返回完善你的想法。'}
                </p>
                {overlay === 'drawer' && (
                    <div className={styles.drawerDetails}>
                        <span>项目状态</span>
                        <strong>进行中</strong>
                        <span>工作目标</span>
                        <p>梳理工作区的信息层级，让每一个操作都有清晰的起点。</p>
                        <span>下一步</span>
                        <ul>
                            <li>整理核心页面</li>
                            <li>确认交互与组件</li>
                            <li>复核阅读和操作体验</li>
                        </ul>
                    </div>
                )}
                <div className={styles.formActions}>
                    <GalleryButton onClick={() => overlayRef.current?.close()}>返回</GalleryButton>
                    <GalleryButton
                        tone="primary"
                        onClick={() => {
                            overlayRef.current?.close()
                            notify('操作已确认')
                        }}
                    >
                        <span>确认</span>
                        <ArrowRight size={14} aria-hidden="true" />
                    </GalleryButton>
                </div>
            </dialog>
        </div>
    )
}
