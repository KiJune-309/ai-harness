import { ArrowUpRight, Circle, CircleDot, FileText, LockKeyhole, MessageSquare } from 'lucide-react'
import styles from './landing-document.module.css'

export const landingFiles = [
    {
        name: '客户访谈纪要.md',
        label: '客户访谈',
        quote: '高峰时段连续处理多条信息时，等待时间会明显变长。',
        source: '客户访谈纪要.md · 第 3 段',
    },
    {
        name: '产品需求说明.pdf',
        label: '需求说明',
        quote: '评审前需要确认问题出现的频率、影响范围，以及延迟从哪一步开始。',
        source: '产品需求说明.pdf · 第 2 页',
    },
    {
        name: '页面内容清单.docx',
        label: '内容清单',
        quote: '需求说明应包含问题背景、参考资料、待确认信息和下一步行动。',
        source: '页面内容清单.docx · 第 4 段',
    },
] as const

const chapterLabels = ['我的项目', '沟通草稿', '资料来源', '下一步行动'] as const

type LandingDocumentProps = {
    activeChapter: number
    selectedFile: number
}

/**
 * Renders one continuous work document for the landing page scroll narrative.
 * @param props - The reading chapter and locally selected reference file.
 * @returns The paper header and four persistent panels controlled by the parent timeline.
 */
export function LandingDocument({ activeChapter, selectedFile }: LandingDocumentProps) {
    const file = landingFiles[selectedFile] ?? landingFiles[0]

    return (
        <div className={styles.sheet} data-document-sheet>
            <div className={styles.tab}>
                <span>{chapterLabels[activeChapter] ?? chapterLabels[0]}</span>
                <span className={styles.tabIndex}>{String(Math.min(Math.max(activeChapter, 0), 3) + 1).padStart(2, '0')}</span>
            </div>
            <article className={styles.paper} aria-label="客户反馈整理与需求评审提纲">
                <div className={styles.metadata}>
                    <span>客户反馈整理</span>
                    <span className={styles.private}>
                        <LockKeyhole size={12} aria-hidden="true" />
                        仅本人可见
                    </span>
                </div>
                <h2 className={styles.title}>
                    需求评审
                    <br className={styles.titleBreak} />
                    提纲
                    <ArrowUpRight aria-hidden="true" />
                </h2>
                <p className={styles.lead}>把零散反馈，整理成有依据的下一步。</p>
                <div className={styles.rule} aria-hidden="true" />

                <div className={styles.window} data-document-window>
                    <div className={styles.rail} data-document-rail>
                        <section className={styles.panel} data-document-panel="0" aria-label="问题整理">
                            <div className={styles.outlineRow}>
                                <span className={styles.number}>01</span>
                                <div>
                                    <h3>明确问题</h3>
                                    <p>
                                        高峰时段的响应延迟，
                                        <br />
                                        影响了连续操作。
                                    </p>
                                </div>
                            </div>
                            <div className={styles.outlineRow}>
                                <span className={styles.number}>02</span>
                                <div>
                                    <h3>补充信息</h3>
                                    <p>
                                        确认出现频率、影响范围
                                        <br />
                                        与延迟起点。
                                    </p>
                                </div>
                            </div>
                            <div className={styles.sourceFooter}>
                                <span>参考来源</span>
                                <p>客户访谈纪要.md · 第 3 段</p>
                                <ArrowUpRight size={20} aria-hidden="true" />
                            </div>
                        </section>

                        <section className={styles.panel} data-document-panel="1" aria-label="待本人确认的沟通草稿" id="landing-message">
                            <div className={styles.panelHeading}>
                                <h3>
                                    <MessageSquare size={18} aria-hidden="true" />
                                    沟通草稿
                                </h3>
                                <span className={styles.pending}>待本人确认</span>
                            </div>
                            <div className={styles.recipient}>
                                <span>收件人</span>
                                <strong>周宁 · 产品</strong>
                            </div>
                            <p className={styles.draft}>我整理了访谈中提到的响应问题，请帮忙确认高峰时段的影响范围。</p>
                            <div className={styles.sourceFooter}>
                                <span>共享范围</span>
                                <p>只发送本人确认的正文。</p>
                                <LockKeyhole size={18} aria-hidden="true" />
                            </div>
                            <a href="#collaboration" className={styles.staticLink}>
                                看沟通说明 <ArrowUpRight size={16} />
                            </a>
                        </section>

                        <section
                            className={styles.panel}
                            data-document-panel="2"
                            aria-label="私有项目资料摘录"
                            id="landing-source-excerpt"
                            aria-live="polite"
                            aria-atomic="true"
                        >
                            <div className={styles.panelHeading}>
                                <h3>
                                    <FileText size={18} aria-hidden="true" />
                                    资料摘录
                                </h3>
                                <span className={styles.scope}>仅本人可见</span>
                            </div>
                            <div className={styles.referenceContent} key={file.name}>
                                <h4>{file.name}</h4>
                                <blockquote>{file.quote}</blockquote>
                            </div>
                            <div className={styles.sourceFooter}>
                                <span>精确来源</span>
                                <p>{file.source}</p>
                                <ArrowUpRight size={20} aria-hidden="true" />
                            </div>
                            <a href="#files" className={styles.staticLink}>
                                看资料说明 <ArrowUpRight size={16} />
                            </a>
                        </section>

                        <section className={styles.panel} data-document-panel="3" aria-label="个人任务的下一步行动" id="landing-task-list">
                            <div className={styles.panelHeading}>
                                <h3>下一步行动</h3>
                                <span className={styles.scope}>个人任务</span>
                            </div>
                            <ul className={styles.tasks}>
                                <li>
                                    <CircleDot aria-hidden="true" />
                                    <span>明确范围</span>
                                    <span className={styles.taskState}>进行中</span>
                                </li>
                                <li>
                                    <Circle aria-hidden="true" />
                                    <span>补充信息</span>
                                    <span className={styles.taskState}>待补充</span>
                                </li>
                                <li>
                                    <Circle aria-hidden="true" />
                                    <span>准备评审</span>
                                    <span className={styles.taskState}>待开始</span>
                                </li>
                            </ul>
                            <div className={styles.sourceFooter}>
                                <span>任务目标</span>
                                <p>整理访谈中的关键问题。</p>
                                <ArrowUpRight size={20} aria-hidden="true" />
                            </div>
                            <a href="#tasks" className={styles.staticLink}>
                                看任务说明 <ArrowUpRight size={16} />
                            </a>
                        </section>
                    </div>
                </div>
            </article>
        </div>
    )
}
