import type { Metadata } from 'next'
import { LandingPage } from '../../components/landing-page'

export const metadata: Metadata = {
    title: 'orbit — 让想法，接着往前走',
    description: '和自己的 Agent 理清问题、查阅资料、推进任务。上下游沟通、项目文件与每一步工作，在 orbit 有序展开。',
}

/**
 * Opens the public product introduction without mounting private workspace data.
 * @returns The Orbit landing page with its four product chapters.
 */
export default function LandingRoute() {
    return <LandingPage />
}
