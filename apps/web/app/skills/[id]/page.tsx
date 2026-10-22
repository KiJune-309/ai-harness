import { SkillWorkspace } from '../../../components/skills-workspace'

/**
 * Opens one stable private skill record and its immutable history.
 * @param props - Stable skill identity from the application route.
 * @returns The complete literal skill editor and historical versions.
 */
export default async function SkillPage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = await params
    return <SkillWorkspace skillId={id} />
}
