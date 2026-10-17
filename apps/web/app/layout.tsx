import type { Metadata } from 'next'
import { Suspense, type ReactNode } from 'react'
import { Workspace } from '../components/workspace'
import './globals.css'
import './home-overview.css'

export const metadata: Metadata = {
    title: 'orbit — 你的 LLM 工作区',
    description: '一个安静、有序的空间，和 LLM 一起把想法变成行动。',
}

export default function RootLayout({ children }: { children: ReactNode }) {
    return (
        <html lang="zh-CN">
            <body>
                <Suspense
                    fallback={
                        <main className="workspace-loading" role="status">
                            正在打开工作区…
                        </main>
                    }
                >
                    <Workspace>{children}</Workspace>
                </Suspense>
            </body>
        </html>
    )
}
