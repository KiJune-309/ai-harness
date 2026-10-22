'use client'

import { ArrowDown, ArrowRight, ArrowUpRight, Check, FileText, LockKeyhole, MessageSquare } from 'lucide-react'
import Link from 'next/link'
import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react'
import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { LandingDocument, landingFiles } from './landing-document'
import { buttonVariants } from './ui/button'
import styles from './landing-page.module.css'

/**
 * Connects the continuous paper scene to the real positions of its four chapters.
 * @param page - The public landing page root.
 * @param onChapterChange - Updates the current reading chapter without storing business data.
 * @returns A cleanup function that restores styles and removes owned scroll triggers.
 */
function connectLandingMotion(page: HTMLDivElement | null, onChapterChange: (index: number) => void) {
    if (!page) return undefined
    gsap.registerPlugin(ScrollTrigger)
    const media = gsap.matchMedia()
    const story = page.querySelector<HTMLElement>('[data-story]')
    const document = page.querySelector<HTMLElement>('[data-document]')
    const rail = page.querySelector<HTMLElement>('[data-document-rail]')
    const steps = Array.from(page.querySelectorAll<HTMLElement>('[data-step]'))
    const panels = Array.from(page.querySelectorAll<HTMLElement>('[data-document-panel]'))
    if (!story || !document || !rail || steps.length !== 4 || panels.length !== 4) return undefined

    /**
     * Builds the scrub timeline for the current viewport and motion preference.
     * @param context - GSAP media-query context containing current conditions.
     * @returns Nothing; GSAP owns and reverts the animations created here.
     */
    function configureMotion(context: gsap.Context) {
        const desktop = Boolean(context.conditions?.desktop)
        const motion = Boolean(context.conditions?.motion)
        for (const [index, step] of steps.entries()) {
            /**
             * Marks the chapter reached by forward or backward native scrolling.
             * @returns Nothing; updates the presentation state only.
             */
            function activateChapter() {
                onChapterChange(index)
            }
            ScrollTrigger.create({
                trigger: step,
                start: 'top 55%',
                end: 'bottom 55%',
                onEnter: activateChapter,
                onEnterBack: activateChapter,
            })
        }
        if (!motion) return

        gsap.from('[data-hero-word]', { y: 18, opacity: 0, stagger: 0.06, duration: 0.42, ease: 'power2.out' })
        gsap.from('[data-document-sheet]', { y: 24, opacity: 0, duration: 0.48, ease: 'power2.out', delay: 0.12 })
        gsap.from('[data-doodle]', { strokeDashoffset: 100, duration: 0.52, delay: 0.2, ease: 'power2.out' })

        /**
         * Measures the native scroll distance covered by the shared sticky canvas.
         * @returns The story distance in pixels, with a nonzero minimum.
         */
        function storyDistance() {
            return Math.max(1, story!.offsetHeight - window.innerHeight)
        }
        const timeline = gsap.timeline({
            scrollTrigger: { trigger: story, start: 'top top', end: storyDistance, scrub: true, invalidateOnRefresh: true },
            defaults: { ease: 'none' },
        })
        timeline.to({}, { duration: storyDistance() }, 0)
        for (let index = 1; index < steps.length; index += 1) {
            const position = steps[index].offsetTop - window.innerHeight * 0.64
            const duration = window.innerHeight * 0.46
            /**
             * Places the paper in a readable position after each poster transition.
             * @returns The horizontal displacement for the current viewport.
             */
            function paperX() {
                return desktop ? [-0, -46, -72, -44][index] : (page!.clientWidth - document!.offsetWidth) / 2 - document!.offsetLeft
            }
            /**
             * Lifts the cropped cover paper into the chapter's reading area.
             * @returns The vertical displacement in viewport-relative pixels.
             */
            function paperY() {
                return desktop ? -window.innerHeight * [0, 0.18, 0.15, 0.13][index] : window.innerHeight * 0.41 - document!.offsetTop
            }
            /**
             * Brings the matching section of the same continuous paper into its window.
             * @returns The negative section offset within the paper rail.
             */
            function paperContentY() {
                return -panels[index].offsetTop
            }
            timeline.to(
                document,
                { x: paperX, y: paperY, rotation: desktop ? [11, 2, -2, 1][index] : [8, 1, -1, 0][index], duration },
                Math.max(0, position)
            )
            timeline.to(rail, { y: paperContentY, duration }, Math.max(0, position))
        }
        const sourceSteps = steps.slice(1)
        for (const step of sourceSteps) {
            gsap.from(step.querySelector('[data-chapter-mark]'), {
                scaleX: 0,
                transformOrigin: 'left',
                duration: 0.42,
                ease: 'power2.out',
                scrollTrigger: { trigger: step, start: 'top 65%', once: true },
            })
        }
    }
    media.add(
        { desktop: '(min-width: 768px)', motion: '(prefers-reduced-motion: no-preference) and (min-height: 701px)' },
        configureMotion,
        page
    )

    /**
     * Recalculates chapter and font measurements after the local typeface is ready.
     * @returns Nothing; refreshes only while this page remains mounted.
     */
    function refreshMeasurements() {
        if (page?.isConnected) ScrollTrigger.refresh()
    }
    void window.document.fonts.ready.then(refreshMeasurements)

    /**
     * Releases animations and restores the static reading layout on unmount.
     * @returns Nothing.
     */
    function disconnectMotion() {
        media.revert()
    }
    return disconnectMotion
}

/**
 * Renders the selected freeform cover and a single paper that follows the product story.
 * @returns The public landing page with local explanatory scenes and real entry links.
 */
export function LandingPage() {
    const pageRef = useRef<HTMLDivElement>(null)
    const [activeChapter, setActiveChapter] = useState(0)
    const [selectedFile, setSelectedFile] = useState(0)

    useEffect(
        /**
         * Mounts the presentation-only scroll narrative.
         * @returns The animation cleanup function.
         */
        function mountLandingMotion() {
            return connectLandingMotion(pageRef.current, setActiveChapter)
        },
        []
    )

    /**
     * Selects a static file excerpt without reading or changing any account data.
     * @param event - The selected file button event.
     * @returns Nothing; updates the local presentation.
     */
    function selectFile(event: MouseEvent<HTMLButtonElement>) {
        const index = Number(event.currentTarget.dataset.fileIndex)
        if (Number.isInteger(index) && index >= 0 && index < landingFiles.length) setSelectedFile(index)
    }

    /**
     * Renders one accessible source selector for the continuous document.
     * @param file - Static source metadata.
     * @param index - The source position.
     * @returns A file-selection button with a visible selected state.
     */
    function renderFileChoice(file: (typeof landingFiles)[number], index: number): ReactNode {
        return (
            <button
                type="button"
                key={file.name}
                data-file-index={index}
                aria-pressed={selectedFile === index}
                aria-controls="landing-source-excerpt"
                onClick={selectFile}
                className={styles.fileChoice}
            >
                <FileText size={18} />
                <span className={styles.fileName}>{file.name}</span>
                <span className={styles.fileShort}>{file.label}</span>
                <ArrowUpRight size={19} />
            </button>
        )
    }

    return (
        <div id="landing-top" className={styles.page} ref={pageRef} data-active-chapter={activeChapter}>
            <a className={styles.skipLink} href="#collaboration">
                跳到产品介绍
            </a>
            <header className={styles.header}>
                <Link href="/landing" className={styles.brand} aria-label="orbit 首页">
                    orbit
                    <span />
                </Link>
                <nav className={styles.nav} aria-label="产品介绍">
                    <a href="#collaboration">上下游沟通</a>
                    <a href="#files">文件与存储</a>
                    <a href="#tasks">任务</a>
                </nav>
                <Link href="/login" className={styles.login}>
                    登录 <ArrowUpRight size={20} />
                </Link>
            </header>

            <main>
                <div className={styles.story} data-story>
                    <div className={styles.canvas}>
                        <div className={styles.canvasClip}>
                            <div className={styles.workOutput} data-document>
                                <LandingDocument activeChapter={activeChapter} selectedFile={selectedFile} />
                            </div>
                            <div className={styles.chapterMeter} aria-hidden="true">
                                <span>0{activeChapter + 1}</span>
                                <div />
                                <span>04</span>
                            </div>
                        </div>
                    </div>

                    <div className={styles.panels}>
                        <section className={styles.hero} data-step="0" aria-labelledby="landing-title">
                            <h1 id="landing-title" className={styles.heroTitle}>
                                <span className={styles.thought} data-hero-word>
                                    让想法，
                                </span>
                                <span className={styles.continue} data-hero-word>
                                    接着
                                </span>
                                <span className={styles.forward} data-hero-word>
                                    往前走<span className={styles.titlePeriod}>。</span>
                                </span>
                            </h1>
                            <svg className={styles.thoughtMark} viewBox="0 0 315 175" fill="none" aria-hidden="true">
                                <path
                                    data-doodle
                                    pathLength="100"
                                    strokeDasharray="100"
                                    d="M17 92C8 27 264 4 295 63c37 70-199 117-269 66C-21 95 59 43 107 36"
                                />
                            </svg>
                            <svg className={styles.flowArrow} viewBox="0 0 260 175" fill="none" aria-hidden="true">
                                <path
                                    data-doodle
                                    pathLength="100"
                                    strokeDasharray="100"
                                    d="M12 15c-15 116 71 146 208 83M165 77l58 17-24 56"
                                />
                            </svg>
                            <div className={styles.sceneCaption} aria-hidden="true">
                                <span />
                                从客户反馈，到需求评审
                            </div>
                            <div className={styles.heroBottom}>
                                <p>
                                    和 Agent 理清问题、查阅资料，
                                    <br className={styles.mobileBreak} />
                                    推进任务。
                                </p>
                                <Link href="/register" className={`${buttonVariants({ size: 'lg' })} ${styles.primaryAction}`}>
                                    开始使用 <ArrowRight size={25} />
                                </Link>
                            </div>
                            <a className={styles.readNext} href="#collaboration">
                                往下看看 <ArrowDown size={20} />
                            </a>
                        </section>

                        <section
                            id="collaboration"
                            className={`${styles.chapter} ${styles.collaboration}`}
                            data-step="1"
                            aria-labelledby="collaboration-title"
                        >
                            <div className={styles.chapterCopy}>
                                <p className={styles.chapterLabel}>
                                    <span>01</span>上下游沟通 <span className={styles.chapterMark} data-chapter-mark />
                                </p>
                                <h2 id="collaboration-title">
                                    问题说清，
                                    <br />
                                    <span>再往前递。</span>
                                </h2>
                                <p className={styles.description}>把客户反馈整理成有上下文的问题。发给同事前，由你确认收件人和完整正文。</p>
                                <div className={styles.chapterFootnote}>
                                    <MessageSquare size={19} />
                                    <span>Agent 起草，你决定发送。</span>
                                </div>
                                <a href="#landing-message" className={styles.staticDocumentLink}>
                                    查看对应的沟通草稿 <ArrowUpRight size={17} />
                                </a>
                                <a className={styles.nextChapter} href="#files">
                                    接着，看资料 <ArrowDown size={18} />
                                </a>
                            </div>
                        </section>

                        <section id="files" className={`${styles.chapter} ${styles.files}`} data-step="2" aria-labelledby="files-title">
                            <div className={styles.chapterCopy}>
                                <p className={styles.chapterLabel}>
                                    <span>02</span>文件与存储 <span className={styles.chapterMark} data-chapter-mark />
                                </p>
                                <h2 id="files-title">
                                    回到资料，
                                    <br />
                                    <span>找到依据。</span>
                                </h2>
                                <p className={styles.description}>
                                    访谈记录和需求文件留在自己的项目里。Agent 按问题查阅，回答保留文件与段落出处。
                                </p>
                                <div className={styles.fileChoices} aria-label="选择项目资料">
                                    {landingFiles.map(renderFileChoice)}
                                </div>
                                <a href="#landing-source-excerpt" className={styles.staticDocumentLink}>
                                    查看所选文件的摘录 <ArrowUpRight size={17} />
                                </a>
                                <p className={styles.scopeNote}>
                                    <LockKeyhole size={15} />
                                    资料仅本人可见，转告只含你确认的正文。
                                </p>
                            </div>
                        </section>

                        <section id="tasks" className={`${styles.chapter} ${styles.tasks}`} data-step="3" aria-labelledby="tasks-title">
                            <div className={styles.chapterCopy}>
                                <p className={styles.chapterLabel}>
                                    <span>03</span>个人任务 <span className={styles.chapterMark} data-chapter-mark />
                                </p>
                                <h2 id="tasks-title">
                                    下一步，
                                    <br />
                                    <span>写清楚。</span>
                                </h2>
                                <p className={styles.description}>
                                    给任务一个明确目标，选好 Agent，由你决定何时开始。过程和产出留在同一条记录里。
                                </p>
                                <div className={styles.chapterFootnote}>
                                    <Check size={20} />
                                    <span>目标、过程、产出，接得上。</span>
                                </div>
                                <a href="#landing-task-list" className={styles.staticDocumentLink}>
                                    查看对应的行动清单 <ArrowUpRight size={17} />
                                </a>
                                <Link href="/register" className={`${buttonVariants({ size: 'lg' })} ${styles.chapterAction}`}>
                                    从自己的第一步开始 <ArrowUpRight size={20} />
                                </Link>
                            </div>
                        </section>
                    </div>
                </div>

                <section className={styles.closing} aria-labelledby="closing-title">
                    <h2 id="closing-title">
                        还有想法？
                        <br />
                        <span>接着来。</span>
                    </h2>
                    <Link href="/register" className={`${buttonVariants({ size: 'lg' })} ${styles.closingAction}`}>
                        开始使用 orbit <ArrowUpRight size={26} />
                    </Link>
                </section>
            </main>
            <footer className={styles.footer}>
                <Link href="/landing" className={styles.brand} aria-label="orbit 首页">
                    orbit
                    <span />
                </Link>
                <Link href="/">
                    进入工作区 <ArrowUpRight size={16} />
                </Link>
                <a href="#landing-top">
                    回到顶部 <ArrowUpRight size={16} />
                </a>
            </footer>
        </div>
    )
}
