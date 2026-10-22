'use client'

import { LoaderCircle, type LucideIcon } from 'lucide-react'
import { useLinkStatus } from 'next/link'

/**
 * Shares a navigation label and pending feedback between links and actions.
 * @param props - Visible label, icon, pending state, and optional loading announcement.
 * @returns Consistent navigation content with an accessible pending indicator.
 */
export function WorkspaceNavigationLabel({
    label,
    icon: Icon,
    pending = false,
    pendingLabel = `正在打开${label}…`,
}: {
    label: string
    icon: LucideIcon
    pending?: boolean
    pendingLabel?: string
}) {
    return (
        <>
            {pending ? (
                <LoaderCircle className="animate-spin motion-reduce:animate-none" aria-hidden="true" />
            ) : (
                <Icon aria-hidden="true" />
            )}
            <span>{label}</span>
            {pending && (
                <span className="sr-only" role="status">
                    {pendingLabel}
                </span>
            )}
        </>
    )
}

/**
 * Gives immediate feedback while a workspace link waits for its destination.
 * @param props - Navigation label and icon rendered inside a Next.js Link.
 * @returns The shared label connected to the link's pending state.
 */
export function WorkspaceNavigationContent({ label, icon }: { label: string; icon: LucideIcon }) {
    const { pending } = useLinkStatus()
    return <WorkspaceNavigationLabel label={label} icon={icon} pending={pending} />
}
