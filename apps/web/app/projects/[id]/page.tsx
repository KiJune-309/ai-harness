import { notFound } from 'next/navigation'

/**
 * Rejects removed legacy project links without resolving unrelated conversations.
 * @returns Nothing because legacy project details are no longer available.
 */
export default function ProjectPage() {
    notFound()
}
