import { notFound } from 'next/navigation'

/**
 * Rejects the removed legacy project collection route.
 * @returns Nothing because the route is no longer available.
 */
export default function ProjectsPage() {
    notFound()
}
