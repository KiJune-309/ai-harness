import { LibraryWorkspace } from '../../../components/library-workspace'

/**
 * Opens a saved document at a stable address for original and chunk inspection.
 * @param props - Saved document identifier supplied by application routing.
 * @returns The persistent document details and ordered chunk pages.
 */
export default async function DocumentPage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = await params
    return <LibraryWorkspace documentId={id} />
}
