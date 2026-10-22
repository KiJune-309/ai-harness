import { GallerySection } from './gallery-section'
import styles from './gallery-foundations.module.css'

const typeScale = [
    { size: 32, token: '--type-display', lineHeight: 44, weight: 600, label: '展示标题', text: '把想法，变成进展。' },
    { size: 24, token: '--type-title', lineHeight: 34, weight: 600, label: '页面标题', text: '为重要的工作留出空间' },
    { size: 18, token: '--type-heading', lineHeight: 28, weight: 600, label: '内容标题', text: '新的计划，从这里开始' },
    { size: 15, token: '--type-subheading', lineHeight: 24, weight: 600, label: '区块标题', text: '让每一步，都有清楚的方向。' },
    { size: 14, token: '--type-body', lineHeight: 24, weight: 400, label: '阅读正文', text: '整理信息，梳理思路，让工作有序推进。' },
    { size: 13, token: '--type-ui', lineHeight: 20, weight: 500, label: '控件文字', text: '新建内容 · 查看详情 · Workspace 01' },
    { size: 12, token: '--type-caption', lineHeight: 18, weight: 400, label: '辅助说明', text: '项目说明 · 2026.10.22 · 09:41' },
]

const neutralScale = [
    { step: 0, hex: '#FFFFFF' },
    { step: 50, hex: '#FAFAFA' },
    { step: 100, hex: '#F5F5F5' },
    { step: 200, hex: '#E5E5E5' },
    { step: 300, hex: '#D4D4D4' },
    { step: 400, hex: '#A3A3A3' },
    { step: 500, hex: '#737373' },
    { step: 600, hex: '#525252' },
    { step: 700, hex: '#404040' },
    { step: 800, hex: '#262626' },
    { step: 900, hex: '#171717' },
    { step: 950, hex: '#0A0A0A' },
]

const semanticScales = [
    {
        name: 'success',
        label: '成功',
        description: '完成与可用',
        colors: [
            { step: 50, hex: '#ECFDF5' },
            { step: 100, hex: '#D1FAE5' },
            { step: 300, hex: '#6EE7B7' },
            { step: 600, hex: '#059669' },
            { step: 800, hex: '#065F46' },
        ],
    },
    {
        name: 'info',
        label: '信息',
        description: '提示与进行中',
        colors: [
            { step: 50, hex: '#EFF6FF' },
            { step: 100, hex: '#DBEAFE' },
            { step: 300, hex: '#93C5FD' },
            { step: 600, hex: '#2563EB' },
            { step: 800, hex: '#1E40AF' },
        ],
    },
    {
        name: 'warning',
        label: '注意',
        description: '待检查与提醒',
        colors: [
            { step: 50, hex: '#FFFBEB' },
            { step: 100, hex: '#FEF3C7' },
            { step: 300, hex: '#FCD34D' },
            { step: 600, hex: '#D97706' },
            { step: 800, hex: '#92400E' },
        ],
    },
    {
        name: 'error',
        label: '错误',
        description: '失败与危险操作',
        colors: [
            { step: 50, hex: '#FEF2F2' },
            { step: 100, hex: '#FEE2E2' },
            { step: 300, hex: '#FCA5A5' },
            { step: 600, hex: '#DC2626' },
            { step: 800, hex: '#991B1B' },
        ],
    },
]

const spacingScale = [4, 8, 12, 16, 24, 32]
const radiusScale = [
    { value: 6, label: '紧凑元素' },
    { value: 8, label: '按钮与输入' },
    { value: 12, label: '容器与浮层' },
]

/**
 * Displays the shared typography, color and spacing foundations used by Orbit UI.
 * @returns Read-only, responsive specimens of the design system tokens.
 */
export function GalleryFoundations() {
    return (
        <div className={styles.foundations}>
            <GallerySection title="字体与排版" description="清晰的字阶建立层级。用字重区分重点，让正文保持轻松易读。">
                <div className={styles.fontHeading}>
                    <div>
                        <p className={styles.fontName}>MiSans</p>
                        <p className={styles.annotation}>中文、英文与数字统一 · 正文 400 / 控件 500 / 标题 600</p>
                    </div>
                    <span className={styles.fontSpecimen} aria-hidden="true">
                        Aa 0123
                    </span>
                </div>
                <div className={styles.typeScale}>
                    {typeScale.map(type => (
                        <div className={styles.typeRow} key={type.size}>
                            <div className={styles.typeMeta}>
                                <span className={styles.typeSize}>{type.size}</span>
                                <span>{type.label}</span>
                            </div>
                            <p
                                className={styles.typeSample}
                                style={{ fontSize: `var(${type.token})`, lineHeight: `${type.lineHeight}px`, fontWeight: type.weight }}
                            >
                                {type.text}
                            </p>
                        </div>
                    ))}
                </div>
                <div className={styles.monoRow}>
                    <div className={styles.monoHeading}>
                        <span className={styles.smallLabel}>等宽字体</span>
                        <span className={styles.annotation}>SF Mono / Consolas</span>
                    </div>
                    <p className={styles.monoSample}>Aa Bb 0123456789</p>
                    <p className={styles.annotation}>用于数值、编号与代码，保持字符对齐。</p>
                </div>
            </GallerySection>

            <GallerySection title="中性色阶" description="从纯白到墨黑，承载页面、边界与文字。主操作使用深色，层次由灰阶展开。">
                <ul className={styles.neutralGrid} aria-label="中性色阶">
                    {neutralScale.map(color => (
                        <li className={styles.colorItem} key={color.step}>
                            <div
                                className={styles.neutralSwatch}
                                style={{ backgroundColor: `var(--orbit-neutral-${color.step})` }}
                                aria-hidden="true"
                            />
                            <span className={styles.colorStep}>{color.step}</span>
                            <span className={styles.colorHex}>{color.hex}</span>
                        </li>
                    ))}
                </ul>
                <div className={styles.colorUsage}>
                    <span>
                        0–100 <span>页面与表面</span>
                    </span>
                    <span>
                        200–400 <span>边界与禁用</span>
                    </span>
                    <span>
                        500–950 <span>文字与操作</span>
                    </span>
                </div>
            </GallerySection>

            <GallerySection title="语义色彩" description="颜色只传达状态。浅色铺底，中色作强调，深色承载可读的文字。">
                <div className={styles.semanticScales}>
                    {semanticScales.map(scale => (
                        <div className={styles.semanticRow} key={scale.name}>
                            <div className={styles.semanticHeading}>
                                <span className={styles.smallLabel}>
                                    <span
                                        className={styles.semanticDot}
                                        style={{ backgroundColor: `var(--orbit-${scale.name}-600)` }}
                                        aria-hidden="true"
                                    />
                                    {scale.label}
                                </span>
                                <span className={styles.annotation}>{scale.description}</span>
                            </div>
                            <ul className={styles.semanticGrid} aria-label={`${scale.label}色阶`}>
                                {scale.colors.map(color => (
                                    <li className={styles.colorItem} key={color.step}>
                                        <div
                                            className={styles.semanticSwatch}
                                            style={{ backgroundColor: `var(--orbit-${scale.name}-${color.step})` }}
                                            aria-hidden="true"
                                        />
                                        <span className={styles.colorStep}>{color.step}</span>
                                        <span className={styles.colorHex}>{color.hex}</span>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    ))}
                </div>
            </GallerySection>

            <GallerySection title="间距与形状" description="以 4px 为基础保持节奏。小圆角让控件温和，清楚的边界保留秩序。">
                <div className={styles.rhythmGroup}>
                    <p className={styles.smallLabel}>间距</p>
                    <ul className={styles.spacingGrid} aria-label="间距尺度">
                        {spacingScale.map(space => (
                            <li className={styles.spacingItem} key={space}>
                                <div className={styles.spacingSample} style={{ gap: `${space}px` }} aria-hidden="true">
                                    <span />
                                    <span />
                                </div>
                                <span className={styles.measurement}>
                                    {space}
                                    <span>px</span>
                                </span>
                            </li>
                        ))}
                    </ul>
                </div>
                <div className={styles.radiusGroup}>
                    <p className={styles.smallLabel}>圆角</p>
                    <ul className={styles.radiusGrid} aria-label="圆角尺度">
                        {radiusScale.map(radius => (
                            <li className={styles.radiusItem} key={radius.value}>
                                <div className={styles.radiusSample} style={{ borderRadius: `${radius.value}px` }} aria-hidden="true" />
                                <span className={styles.measurement}>
                                    {radius.value}
                                    <span>px</span>
                                </span>
                                <span className={styles.annotation}>{radius.label}</span>
                            </li>
                        ))}
                    </ul>
                </div>
            </GallerySection>
        </div>
    )
}
