import type { Metadata } from 'next'
import { Suspense, type ReactNode } from 'react'
import { AuthBoundary } from '../components/auth-boundary'
import './globals.css'
import { TooltipProvider } from '../components/ui/tooltip'
import localFont from 'next/font/local'
import { cn } from '@/lib/utils'

const miSans = localFont({
    src: [
        { path: './fonts/MiSans-Regular.woff2', weight: '400', style: 'normal' },
        { path: './fonts/MiSans-Medium.woff2', weight: '500', style: 'normal' },
        { path: './fonts/MiSans-Semibold.woff2', weight: '600', style: 'normal' },
    ],
    variable: '--font-misans',
    display: 'swap',
    preload: false,
    adjustFontFallback: false,
})

export const metadata: Metadata = {
    title: 'orbit — 你的 LLM 工作区',
    description: '一个安静、有序的空间，和 LLM 一起把想法变成行动。',
}

/**
 * Mounts the authentication boundary before any private workspace component.
 * @param props - Current route content.
 * @returns The shared document and authenticated or public route.
 */
export default function RootLayout({ children }: { children: ReactNode }) {
    // Translation extensions can add root attributes before hydration; descendants remain checked.
    return (
        <html lang="zh-CN" className={cn('font-sans', miSans.variable)} suppressHydrationWarning>
            <body>
                <Suspense
                    fallback={
                        <main className="workspace-loading" role="status">
                            正在打开工作区…
                        </main>
                    }
                >
                    <TooltipProvider>
                        <AuthBoundary>{children}</AuthBoundary>
                    </TooltipProvider>
                </Suspense>
            </body>
        </html>
    )
}
