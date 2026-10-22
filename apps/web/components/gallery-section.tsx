import { type ReactNode } from 'react'
import styles from './gallery.module.css'

/**
 * Groups a component example with its title and concise usage guidance.
 * @param props - Section title, optional usage guidance and live example.
 * @returns A labelled section with an adaptive preview surface.
 */
export function GallerySection({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
    return (
        <section className={styles.section} aria-label={title}>
            <header className={styles.sectionHeading}>
                <h2>{title}</h2>
                {description && <p>{description}</p>}
            </header>
            <div className={styles.preview}>{children}</div>
        </section>
    )
}
