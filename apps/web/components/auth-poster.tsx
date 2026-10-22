import Link from 'next/link'
import styles from './auth-poster.module.css'

/**
 * Presents the public brand story as a paper-and-type composition beside authentication.
 * @returns A responsive illustrated poster whose content describes private clarification and planning.
 */
export function AuthPoster() {
    return (
        <section className={styles.poster} aria-label="从想法到下一步">
            <header className={styles.header}>
                <Link href="/landing" className={styles.brand} aria-label="了解 orbit">
                    orbit<span aria-hidden="true">.</span>
                </Link>
            </header>
            <div className={styles.composition}>
                <p className={styles.headline}>
                    <span className={styles.thought}>让想法，</span>
                    <span className={styles.continue}>接着</span>
                    <span className={styles.forward}>
                        往前走<span className={styles.period}>。</span>
                    </span>
                </p>
                <svg className={styles.circle} viewBox="0 0 240 122" fill="none" aria-hidden="true">
                    <path
                        pathLength="1"
                        d="M218 27C192 4 129 5 77 13 30 20 6 40 11 67c6 32 57 47 118 43 61-4 106-22 101-47-3-19-23-31-49-36M38 91c37 17 101 18 148 3"
                    />
                </svg>
                <div className={styles.annotation}>
                    <p className={styles.annotationLabel}>先问清一件事</p>
                    <p className={styles.question}>
                        这份方案，
                        <br />
                        是给谁看的？
                    </p>
                    <p className={styles.answer}>给产品团队。</p>
                </div>
                <svg className={styles.route} viewBox="0 0 240 180" fill="none" aria-hidden="true">
                    <path pathLength="1" d="M9 147c57 19 101 6 116-31 14-34-14-72-5-92 9-20 43-13 92 12M190 14l23 23-32 2" />
                </svg>
                <div className={styles.paper}>
                    <div className={styles.paperTop}>
                        <span>需求提纲</span>
                        <span aria-hidden="true">↗</span>
                    </div>
                    <h2 className={styles.paperTitle}>新功能方案</h2>
                    <p className={styles.paperAudience} aria-label="受众从所有人收敛为产品团队">
                        <s>所有人</s>
                        <ins>产品团队</ins>
                    </p>
                    <ul className={styles.paperList}>
                        <li>
                            <span className={styles.check} aria-hidden="true">
                                ✓
                            </span>
                            <span>梳理功能范围</span>
                        </li>
                    </ul>
                    <p className={styles.next}>
                        下一步 <span aria-hidden="true">→</span> 写方案
                    </p>
                    <span className={styles.paperCorner} aria-hidden="true" />
                </div>
            </div>
        </section>
    )
}
