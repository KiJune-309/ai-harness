'use client'

import { useId, useState, type FormEvent } from 'react'
import { ArrowRight, Check, CircleAlert, Info, LoaderCircle, MoreHorizontal, Plus } from 'lucide-react'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { SearchInput } from './ui/search-input'
import { Label } from './ui/label'
import { Textarea } from './ui/textarea'
import { NativeSelect, NativeSelectOption } from './ui/native-select'
import { Checkbox } from './ui/checkbox'
import { Switch } from './ui/switch'
import { RadioGroup, RadioGroupItem } from './ui/radio-group'
import { Badge } from './ui/badge'
import { FeedbackMessage, FeedbackToast } from './ui/feedback-message'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from './ui/dialog'
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
    AlertDialogTrigger,
} from './ui/alert-dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuTrigger } from './ui/dropdown-menu'
import { Disclosure } from './ui/disclosure'
import { Presence } from './ui/presence'
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs'
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip'
import { GalleryCollections } from './gallery-collections'
import { GallerySection } from './gallery-section'
import { GalleryFoundations } from './gallery-foundations'
import styles from './gallery.module.css'

/**
 * Presents shared components through local, interactive design examples.
 * @returns A responsive gallery without backend writes or model calls.
 */
export function ComponentGallery() {
    const prefix = useId()
    const [name, setName] = useState('')
    const [description, setDescription] = useState('')
    const [checked, setChecked] = useState(true)
    const [notifications, setNotifications] = useState(false)
    const [frequency, setFrequency] = useState<string | null>('weekly')
    const [error, setError] = useState('')
    const [notice, setNotice] = useState('')
    const [open, setOpen] = useState(false)
    const [deleteOpen, setDeleteOpen] = useState(false)
    const [searchQuery, setSearchQuery] = useState('')
    const [loadingQuery, setLoadingQuery] = useState('设计规范')
    const [motionVisible, setMotionVisible] = useState(true)
    const [motionExpanded, setMotionExpanded] = useState(false)
    const [feedbackCount, setFeedbackCount] = useState(0)

    /**
     * Validates the form and announces its result without saving data.
     * @param event - The local demonstration form submission.
     * @returns Nothing; focuses an invalid field or updates the local notice.
     */
    function validateForm(event: FormEvent<HTMLFormElement>) {
        event.preventDefault()
        if (!name.trim()) {
            setError('请填写名称后再试一次。')
            document.getElementById(`${prefix}-name`)?.focus()
            return
        }
        setError('')
        setNotice(`验证通过：${name.trim()}。这次演示不会保存数据。`)
    }

    return (
        <section className={styles.gallery}>
            <header className={styles.header}>
                <div>
                    <h1>组件展示</h1>
                </div>
                <span className={styles.systemName}>
                    <span className={styles.systemMark} aria-hidden="true" />
                    Orbit UI
                </span>
            </header>
            <Tabs defaultValue="foundations" className={styles.tabs}>
                <div className={styles.navigation}>
                    <TabsList variant="line" className={styles.tabList} aria-label="组件分类">
                        <TabsTrigger value="foundations">设计基础</TabsTrigger>
                        <TabsTrigger value="controls">基础控件</TabsTrigger>
                        <TabsTrigger value="overlays">浮层与反馈</TabsTrigger>
                        <TabsTrigger value="collections">集合与状态</TabsTrigger>
                        <TabsTrigger value="motion">动效</TabsTrigger>
                    </TabsList>
                </div>
                <TabsContent value="foundations" className={styles.panel}>
                    <GalleryFoundations />
                </TabsContent>
                <TabsContent value="controls" className={styles.panel}>
                    <GallerySection title="按钮">
                        <div className={styles.exampleGroup}>
                            <div className={styles.buttonRow}>
                                <Button onClick={() => setNotice('已点击主要操作；不会创建真实内容。')}>
                                    <Plus aria-hidden="true" />
                                    新建内容
                                </Button>
                                <Button variant="outline" onClick={() => setNotice('已打开预览演示。')}>
                                    查看预览
                                </Button>
                                <Button variant="ghost" onClick={() => setNotice('已取消本地演示。')}>
                                    取消
                                </Button>
                                <Button variant="outline" disabled>
                                    <LoaderCircle className="animate-spin motion-reduce:animate-none" aria-hidden="true" />
                                    处理中
                                </Button>
                            </div>
                        </div>
                        <Disclosure
                            title="更多按钮状态"
                            className={styles.buttonDisclosure}
                            triggerClassName="w-auto justify-start text-xs text-muted-foreground"
                        >
                            <div className={styles.buttonRow}>
                                <Button variant="link" onClick={() => setNotice('辅助操作使用轻量的文字链接。')}>
                                    了解更多
                                    <ArrowRight aria-hidden="true" />
                                </Button>
                                <Button variant="secondary" onClick={() => setNotice('已点击次级操作。')}>
                                    次级操作
                                </Button>
                                <Button variant="outline" disabled>
                                    暂不可用
                                </Button>
                                <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
                                    <AlertDialogTrigger render={<Button variant="destructive" />}>删除内容</AlertDialogTrigger>
                                    <AlertDialogContent>
                                        <AlertDialogHeader>
                                            <AlertDialogTitle>删除这条示例内容？</AlertDialogTitle>
                                            <AlertDialogDescription>
                                                这里只演示危险操作的确认流程，不会删除任何真实记录。
                                            </AlertDialogDescription>
                                        </AlertDialogHeader>
                                        <AlertDialogFooter>
                                            <AlertDialogCancel>保留内容</AlertDialogCancel>
                                            <AlertDialogAction
                                                variant="destructive"
                                                onClick={() => {
                                                    setDeleteOpen(false)
                                                    setNotice('删除流程演示已完成，真实数据未改变。')
                                                }}
                                            >
                                                确认删除
                                            </AlertDialogAction>
                                        </AlertDialogFooter>
                                    </AlertDialogContent>
                                </AlertDialog>
                            </div>
                        </Disclosure>
                    </GallerySection>
                    <GallerySection title="表单">
                        <form className={styles.form} onSubmit={validateForm} noValidate>
                            <div className={styles.formGrid}>
                                <div className={styles.field}>
                                    <Label htmlFor={`${prefix}-name`}>
                                        名称<span className={styles.required}>必填</span>
                                    </Label>
                                    <Input
                                        id={`${prefix}-name`}
                                        value={name}
                                        onChange={event => {
                                            setName(event.target.value)
                                            if (error) setError('')
                                        }}
                                        placeholder="例如：每周工作整理"
                                        required
                                        aria-invalid={Boolean(error)}
                                        aria-describedby={error ? `${prefix}-error` : undefined}
                                    />
                                    {error && (
                                        <p id={`${prefix}-error`} role="alert" className={styles.fieldError}>
                                            <CircleAlert aria-hidden="true" />
                                            {error}
                                        </p>
                                    )}
                                </div>
                            </div>
                            <div className={styles.field}>
                                <Label htmlFor={`${prefix}-description`}>
                                    说明<span className={styles.required}>选填</span>
                                </Label>
                                <Textarea
                                    id={`${prefix}-description`}
                                    value={description}
                                    onChange={event => setDescription(event.target.value)}
                                    placeholder="补充一些背景，让目标更清楚…"
                                    aria-describedby={`${prefix}-description-hint`}
                                />
                                <p id={`${prefix}-description-hint`} className={styles.hint}>
                                    简短描述用途即可，之后也可以修改。
                                </p>
                            </div>
                            <div className={styles.field}>
                                <Label htmlFor={`${prefix}-select`}>工作方式</Label>
                                <NativeSelect id={`${prefix}-select`} defaultValue="personal" className="w-full">
                                    <NativeSelectOption value="personal">个人工作区</NativeSelectOption>
                                    <NativeSelectOption value="preview">演示预览</NativeSelectOption>
                                </NativeSelect>
                            </div>
                            <div className={styles.formFooter}>
                                <span className={styles.hint}>试着留空名称，查看校验反馈。</span>
                                <Button type="submit">
                                    验证表单
                                    <ArrowRight aria-hidden="true" />
                                </Button>
                            </div>
                        </form>
                    </GallerySection>
                    <GallerySection title="搜索框" description="输入、清除与加载，共用一个边界。">
                        <div className={styles.form}>
                            <div className={styles.field}>
                                <Label htmlFor={`${prefix}-search`}>搜索内容</Label>
                                <SearchInput
                                    id={`${prefix}-search`}
                                    placeholder="搜索名称或说明"
                                    value={searchQuery}
                                    onValueChange={setSearchQuery}
                                    aria-describedby={`${prefix}-search-hint`}
                                />
                                <p id={`${prefix}-search-hint`} className={`${styles.hint} wrap-anywhere`} role="status">
                                    {searchQuery ? `当前关键词：${searchQuery}` : '输入关键词，试试右侧的清除操作。'}
                                </p>
                            </div>
                            <div className={styles.utilityGrid}>
                                <div className={styles.field}>
                                    <Label htmlFor={`${prefix}-search-loading`}>搜索中</Label>
                                    <SearchInput
                                        id={`${prefix}-search-loading`}
                                        value={loadingQuery}
                                        onValueChange={setLoadingQuery}
                                        loading
                                    />
                                    <p className={styles.hint}>加载状态演示，仍可修改关键词。</p>
                                </div>
                                <div className={styles.field}>
                                    <Label htmlFor={`${prefix}-search-disabled`}>暂不可用</Label>
                                    <SearchInput
                                        id={`${prefix}-search-disabled`}
                                        value=""
                                        onValueChange={setSearchQuery}
                                        placeholder="搜索名称或说明"
                                        disabled
                                    />
                                </div>
                            </div>
                        </div>
                    </GallerySection>
                    <GallerySection title="选择与偏好" description="用合适的控件表达选择。说明与选项保持在同一组。">
                        <div className={styles.preferenceRow}>
                            <Label htmlFor={`${prefix}-checkbox`} className={styles.preferenceLabel}>
                                <span>包含详细信息</span>
                                <span className={styles.hint}>在内容中保留必要的背景与说明。</span>
                            </Label>
                            <Checkbox id={`${prefix}-checkbox`} checked={checked} onCheckedChange={setChecked} />
                        </div>
                        <div className={styles.preferenceRow}>
                            <Label htmlFor={`${prefix}-switch`} className={styles.preferenceLabel}>
                                <span>演示通知</span>
                                <span className={styles.hint}>打开后仅改变此处的演示状态。</span>
                            </Label>
                            <Switch id={`${prefix}-switch`} checked={notifications} onCheckedChange={setNotifications} />
                        </div>
                        <fieldset className={styles.frequency}>
                            <legend id={`${prefix}-frequency-label`}>更新频率</legend>
                            <RadioGroup
                                aria-labelledby={`${prefix}-frequency-label`}
                                value={frequency}
                                onValueChange={setFrequency}
                                className="flex flex-wrap gap-x-8 gap-y-3"
                            >
                                <Label htmlFor={`${prefix}-weekly`} className={styles.option}>
                                    <RadioGroupItem id={`${prefix}-weekly`} value="weekly" />
                                    每周
                                </Label>
                                <Label htmlFor={`${prefix}-daily`} className={styles.option}>
                                    <RadioGroupItem id={`${prefix}-daily`} value="daily" />
                                    每天
                                </Label>
                            </RadioGroup>
                        </fieldset>
                    </GallerySection>
                    <GallerySection title="状态标签" description="浅底与深字保持可读，图标与文字共同表达状态。">
                        <div className={styles.buttonRow}>
                            <Badge variant="outline">未开始</Badge>
                            <Badge variant="info">
                                <LoaderCircle aria-hidden="true" />
                                进行中
                            </Badge>
                            <Badge variant="success">
                                <Check aria-hidden="true" />
                                已完成
                            </Badge>
                            <Badge variant="warning">
                                <CircleAlert aria-hidden="true" />
                                需要检查
                            </Badge>
                            <Badge variant="destructive">
                                <CircleAlert aria-hidden="true" />
                                未能完成
                            </Badge>
                        </div>
                    </GallerySection>
                </TabsContent>
                <TabsContent value="overlays" className={styles.panel}>
                    <GallerySection title="菜单与提示" description="常用操作直接可见，更多选择按需展开。提示同样支持键盘聚焦。">
                        <div className={styles.buttonRow}>
                            <DropdownMenu>
                                <DropdownMenuTrigger render={<Button variant="outline" />}>
                                    操作菜单
                                    <MoreHorizontal aria-hidden="true" />
                                </DropdownMenuTrigger>
                                <DropdownMenuContent>
                                    <DropdownMenuGroup>
                                        <DropdownMenuItem onClick={() => setNotice('已选择编辑演示。')}>编辑内容</DropdownMenuItem>
                                        <DropdownMenuItem onClick={() => setNotice('已选择复制演示。')}>创建副本</DropdownMenuItem>
                                        <DropdownMenuItem disabled>暂不可用</DropdownMenuItem>
                                    </DropdownMenuGroup>
                                </DropdownMenuContent>
                            </DropdownMenu>
                            <Tooltip>
                                <TooltipTrigger render={<Button variant="ghost" />}>
                                    <Info aria-hidden="true" />
                                    使用提示
                                </TooltipTrigger>
                                <TooltipContent>悬停或使用 Tab 聚焦，都可以查看提示。</TooltipContent>
                            </Tooltip>
                        </div>
                        <Disclosure title="查看交互说明" className={styles.disclosure} contentClassName="text-muted-foreground">
                            菜单支持方向键选择，按 Esc 关闭并返回触发位置。辅助信息按需展开，保持页面简洁。
                        </Disclosure>
                    </GallerySection>
                    <GallerySection title="对话框" description="让需要专注的操作独立呈现。标题、内容与操作各有自己的空间。">
                        <div className={styles.previewFooter}>
                            <span className={styles.hint}>支持 Esc 关闭与焦点返回。</span>
                            <Dialog open={open} onOpenChange={setOpen}>
                                <DialogTrigger render={<Button variant="outline" />}>
                                    打开对话框
                                    <ArrowRight aria-hidden="true" />
                                </DialogTrigger>
                                <DialogContent className="gap-6 p-6 sm:max-w-md">
                                    <DialogHeader>
                                        <DialogTitle>确认演示操作</DialogTitle>
                                        <DialogDescription>这是一次本地交互演示，不会保存数据或调用模型。</DialogDescription>
                                    </DialogHeader>
                                    <DialogFooter>
                                        <Button variant="outline" onClick={() => setOpen(false)}>
                                            取消
                                        </Button>
                                        <Button
                                            onClick={() => {
                                                setOpen(false)
                                                setNotice('演示操作已确认。')
                                            }}
                                        >
                                            确认操作
                                        </Button>
                                    </DialogFooter>
                                </DialogContent>
                            </Dialog>
                        </div>
                    </GallerySection>
                    <GallerySection title="操作反馈" description="告诉用户发生了什么，以及下一步可以做什么。">
                        <div className={styles.feedbackStack}>
                            <FeedbackMessage variant="success">演示操作已完成，未保存业务数据。</FeedbackMessage>
                            <FeedbackMessage variant="info">更改会在下次打开时生效。</FeedbackMessage>
                            <FeedbackMessage variant="warning">离开前请保存，未保存的更改会丢失。</FeedbackMessage>
                            <FeedbackMessage variant="error">保存失败，你的输入已保留，请稍后重试。</FeedbackMessage>
                        </div>
                    </GallerySection>
                </TabsContent>
                <TabsContent value="collections" className={styles.panel}>
                    <GalleryCollections />
                </TabsContent>
                <TabsContent value="motion" className={styles.panel}>
                    <GallerySection title="进入与退出" description="内容以轻微淡入和位移出现，收起后让出空间。">
                        <div className={styles.motionExample}>
                            <div className={styles.buttonRow}>
                                <Button
                                    variant="outline"
                                    aria-expanded={motionVisible}
                                    aria-controls={`${prefix}-motion-content`}
                                    onClick={() => setMotionVisible(value => !value)}
                                >
                                    {motionVisible ? '隐藏演示内容' : '显示演示内容'}
                                </Button>
                                <span className={styles.hint}>180 ms</span>
                            </div>
                            <Presence id={`${prefix}-motion-content`} visible={motionVisible}>
                                <div className={styles.motionContent}>
                                    <Check aria-hidden="true" />
                                    <div>
                                        <p>演示内容</p>
                                        <p className={styles.hint}>只改变当前展示，不创建或保存数据。</p>
                                    </div>
                                </div>
                            </Presence>
                            <p className={styles.hint} role="status">
                                {motionVisible ? '演示内容已显示。' : '演示内容已隐藏。'}
                            </p>
                        </div>
                    </GallerySection>
                    <GallerySection title="展开与收起" description="高度跟随内容平滑变化，保持阅读位置稳定。">
                        <Disclosure
                            title="查看动效规则"
                            open={motionExpanded}
                            onOpenChange={setMotionExpanded}
                            className={styles.motionDisclosure}
                            contentClassName="text-muted-foreground"
                        >
                            常用反馈控制在 120–180 ms。只在状态变化时使用轻微位移、透明度或高度变化；开启“减少动态效果”后直接切换。
                        </Disclosure>
                    </GallerySection>
                    <GallerySection title="按钮反馈" description="悬停、按下与键盘聚焦各有清晰反馈，操作结果就近呈现。">
                        <div className={styles.motionExample}>
                            <div className={styles.buttonRow}>
                                <Button onClick={() => setFeedbackCount(value => value + 1)}>触发反馈</Button>
                                <span className={styles.hint}>按下 150 ms · 反馈 150 ms</span>
                            </div>
                            <FeedbackMessage variant="info">
                                <span
                                    key={feedbackCount}
                                    className={
                                        feedbackCount
                                            ? 'motion-safe:animate-in motion-safe:fade-in-0 motion-safe:duration-(--motion-normal)'
                                            : undefined
                                    }
                                >
                                    {feedbackCount ? `已触发 ${feedbackCount} 次本地反馈。` : '点击按钮或使用键盘 Enter，查看反馈。'}
                                </span>
                            </FeedbackMessage>
                        </div>
                    </GallerySection>
                </TabsContent>
            </Tabs>
            <footer className={styles.galleryFooter}>
                <span>此页交互不会保存业务数据</span>
            </footer>
            {notice && (
                <FeedbackToast onDismiss={() => setNotice('')} dismissLabel="关闭演示提示">
                    {notice}
                </FeedbackToast>
            )}
        </section>
    )
}
