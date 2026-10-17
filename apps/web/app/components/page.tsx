import type { Metadata } from 'next'
import { ComponentGallery } from '../../components/component-gallery'

export const metadata: Metadata = {
    title: '组件展示 — orbit',
    description: 'Orbit 的视觉基础、控件状态与交互组件。',
}

export default function ComponentsPage() {
    return <ComponentGallery />
}
