'use client'

import { updateEmailSchema, updatePasswordSchema, updateUsernameSchema } from '@ai-harness/contracts'
import { ArrowUpRight, KeyRound, Mail } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { updateAccountEmail, updateAccountPassword, updateAccountUsername } from '../lib/account-client'
import { useAccount } from './account-context'
import { AccountModels } from './account-models'
import { EmbeddingModels } from './embedding-models'
import styles from './account-workspace.styles'
import { FeedbackMessage } from './ui/feedback-message'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Label } from './ui/label'

/**
 * Maps shared validation issues to the fields where the user can resolve them.
 * @param issues - Contract validation issues.
 * @returns The first useful message for each field.
 */
function fieldErrors(issues: { path: PropertyKey[]; message: string }[]): Record<string, string> {
    const result: Record<string, string> = {}
    for (const issue of issues) result[String(issue.path[0])] ??= issue.message
    return result
}

/**
 * Renders real account profile, sensitive credential changes, and personal model settings.
 * @returns The authenticated account settings page.
 */
export function AccountWorkspace() {
    const { user, updateUser, clearAccount } = useAccount()
    const [username, setUsername] = useState(user.username)
    const [email, setEmail] = useState(user.email)
    const [emailPassword, setEmailPassword] = useState('')
    const [currentPassword, setCurrentPassword] = useState('')
    const [newPassword, setNewPassword] = useState('')
    const [confirmation, setConfirmation] = useState('')
    const [busy, setBusy] = useState('')
    const [errors, setErrors] = useState<Record<string, Record<string, string>>>({})
    const [messages, setMessages] = useState<Record<string, { error?: string; success?: string }>>({})

    /**
     * Submits one validated profile or credential change and handles session revocation.
     * @param event - Submitted form event.
     * @param kind - Account section being saved.
     * @returns After a confirmed save or recoverable failure.
     */
    async function save(event: FormEvent<HTMLFormElement>, kind: 'username' | 'email' | 'password') {
        event.preventDefault()
        if (busy) return
        const input =
            kind === 'username'
                ? { username }
                : kind === 'email'
                  ? { email, currentPassword: emailPassword }
                  : { currentPassword, newPassword }
        const schema = kind === 'username' ? updateUsernameSchema : kind === 'email' ? updateEmailSchema : updatePasswordSchema
        const parsed = schema.safeParse(input)
        const nextErrors = parsed.success ? {} : fieldErrors(parsed.error.issues)
        if (kind === 'password' && newPassword !== confirmation) nextErrors.confirmation = '两次输入的新密码不一致。'
        setErrors(previous => ({ ...previous, [kind]: nextErrors }))
        setMessages(previous => ({ ...previous, [kind]: {} }))
        if (!parsed.success || Object.keys(nextErrors).length) {
            const form = event.currentTarget
            requestAnimationFrame(() => form.querySelector<HTMLInputElement>('[aria-invalid="true"]')?.focus())
            return
        }
        setBusy(kind)
        try {
            if (kind === 'username') {
                const updated = await updateAccountUsername(updateUsernameSchema.parse(input))
                updateUser(updated)
                setUsername(updated.username)
                setMessages(previous => ({ ...previous, username: { success: '用户名已更新。' } }))
            } else {
                if (kind === 'email') await updateAccountEmail(updateEmailSchema.parse(input))
                else await updateAccountPassword(updatePasswordSchema.parse(input))
                setEmailPassword('')
                setCurrentPassword('')
                setNewPassword('')
                setConfirmation('')
                clearAccount()
                window.setTimeout(() => window.location.assign('/login?reason=updated'), 0)
            }
        } catch (cause) {
            setMessages(previous => ({ ...previous, [kind]: { error: cause instanceof Error ? cause.message : '未能保存，请重试。' } }))
        } finally {
            setBusy('')
        }
    }

    return (
        <div className={styles.page}>
            <header className={styles.pageHeading}>
                <h1>账户设置</h1>
                <p>管理全局个人资料、安全设置与当前工作空间的个人模型连接。</p>
            </header>
            <nav className={styles.sectionNav} aria-label="账户设置分区">
                <Button variant="ghost" nativeButton={false} render={<a href="#profile" />}>
                    个人资料
                </Button>
                <Button variant="ghost" nativeButton={false} render={<a href="#security" />}>
                    账户安全
                </Button>
                <Button variant="ghost" nativeButton={false} render={<a href="#models" />}>
                    模型连接
                    <ArrowUpRight size={13} aria-hidden="true" />
                </Button>
                <Button variant="ghost" nativeButton={false} render={<a href="#embedding-models" />}>
                    向量模型
                </Button>
            </nav>
            <section role="region" id="profile" className={styles.section} aria-labelledby="profile-title">
                <div className={styles.sectionLayout}>
                    <div className={styles.sectionIntro}>
                        <h2 id="profile-title">个人资料</h2>
                        <p>在工作区中使用的名字。</p>
                    </div>
                    <form onSubmit={event => save(event, 'username')} className={styles.settingsForm} aria-busy={Boolean(busy)} noValidate>
                        <fieldset className={styles.fields} disabled={Boolean(busy)}>
                            <div className={styles.field}>
                                <Label htmlFor="account-username">用户名</Label>
                                <Input
                                    id="account-username"
                                    autoComplete="nickname"
                                    value={username}
                                    onChange={event => setUsername(event.target.value)}
                                    maxLength={50}
                                    required
                                    aria-invalid={Boolean(errors.username?.username)}
                                    aria-describedby="account-username-hint"
                                />
                                <span id="account-username-hint" className={errors.username?.username ? styles.error : styles.hint}>
                                    {errors.username?.username || '2–50 个字符，无需唯一。'}
                                </span>
                            </div>
                        </fieldset>
                        {messages.username?.error && <FeedbackMessage variant="error">{messages.username.error}</FeedbackMessage>}
                        {messages.username?.success && (
                            <FeedbackMessage variant="success" role="status">
                                {messages.username.success}
                            </FeedbackMessage>
                        )}
                        <Button type="submit" variant="outline" disabled={Boolean(busy)}>
                            {busy === 'username' ? '正在保存…' : '保存用户名'}
                        </Button>
                    </form>
                </div>
            </section>
            <section role="region" id="security" className={styles.section} aria-labelledby="security-title">
                <div className={styles.sectionLayout}>
                    <div className={styles.sectionIntro}>
                        <h2 id="security-title">账户安全</h2>
                        <p>修改邮箱或密码后，所有已登录的会话都会退出，需要重新登录。</p>
                    </div>
                    <div className={styles.securityForms}>
                        <form onSubmit={event => save(event, 'email')} className={styles.settingsForm} aria-busy={Boolean(busy)} noValidate>
                            <h3>
                                <Mail size={16} aria-hidden="true" /> 登录邮箱
                            </h3>
                            <fieldset className={styles.fields} disabled={Boolean(busy)}>
                                <div className={styles.field}>
                                    <Label htmlFor="account-email">新邮箱</Label>
                                    <Input
                                        id="account-email"
                                        type="email"
                                        autoComplete="email"
                                        value={email}
                                        onChange={event => setEmail(event.target.value)}
                                        maxLength={254}
                                        required
                                        aria-invalid={Boolean(errors.email?.email)}
                                        aria-describedby={errors.email?.email ? 'account-email-error' : undefined}
                                    />
                                    {errors.email?.email && (
                                        <span id="account-email-error" className={styles.error}>
                                            {errors.email.email}
                                        </span>
                                    )}
                                </div>
                                <div className={styles.field}>
                                    <Label htmlFor="email-current-password">当前密码</Label>
                                    <Input
                                        id="email-current-password"
                                        type="password"
                                        autoComplete="current-password"
                                        value={emailPassword}
                                        onChange={event => setEmailPassword(event.target.value)}
                                        maxLength={128}
                                        required
                                        aria-invalid={Boolean(errors.email?.currentPassword)}
                                        aria-describedby={errors.email?.currentPassword ? 'email-password-error' : undefined}
                                    />
                                    {errors.email?.currentPassword && (
                                        <span id="email-password-error" className={styles.error}>
                                            {errors.email.currentPassword}
                                        </span>
                                    )}
                                </div>
                            </fieldset>
                            {messages.email?.error && <FeedbackMessage variant="error">{messages.email.error}</FeedbackMessage>}
                            <Button type="submit" variant="outline" disabled={Boolean(busy)}>
                                {busy === 'email' ? '正在修改…' : '修改邮箱并重新登录'}
                            </Button>
                        </form>
                        <form
                            onSubmit={event => save(event, 'password')}
                            className={styles.settingsForm}
                            aria-busy={Boolean(busy)}
                            noValidate
                        >
                            <h3>
                                <KeyRound size={16} aria-hidden="true" /> 登录密码
                            </h3>
                            <fieldset className={styles.fields} disabled={Boolean(busy)}>
                                <div className={styles.field}>
                                    <Label htmlFor="password-current-password">当前密码</Label>
                                    <Input
                                        id="password-current-password"
                                        type="password"
                                        autoComplete="current-password"
                                        value={currentPassword}
                                        onChange={event => setCurrentPassword(event.target.value)}
                                        maxLength={128}
                                        required
                                        aria-invalid={Boolean(errors.password?.currentPassword)}
                                        aria-describedby={errors.password?.currentPassword ? 'password-current-error' : undefined}
                                    />
                                    {errors.password?.currentPassword && (
                                        <span id="password-current-error" className={styles.error}>
                                            {errors.password.currentPassword}
                                        </span>
                                    )}
                                </div>
                                <div className={styles.field}>
                                    <Label htmlFor="account-new-password">新密码</Label>
                                    <Input
                                        id="account-new-password"
                                        type="password"
                                        autoComplete="new-password"
                                        value={newPassword}
                                        onChange={event => setNewPassword(event.target.value)}
                                        maxLength={128}
                                        required
                                        aria-invalid={Boolean(errors.password?.newPassword)}
                                        aria-describedby="new-password-hint"
                                    />
                                    <span id="new-password-hint" className={errors.password?.newPassword ? styles.error : styles.hint}>
                                        {errors.password?.newPassword || '12–128 个字符，空格也会保留。'}
                                    </span>
                                </div>
                                <div className={styles.field}>
                                    <Label htmlFor="account-confirm-password">确认新密码</Label>
                                    <Input
                                        id="account-confirm-password"
                                        type="password"
                                        autoComplete="new-password"
                                        value={confirmation}
                                        onChange={event => setConfirmation(event.target.value)}
                                        maxLength={128}
                                        required
                                        aria-invalid={Boolean(errors.password?.confirmation)}
                                        aria-describedby={errors.password?.confirmation ? 'password-confirm-error' : undefined}
                                    />
                                    {errors.password?.confirmation && (
                                        <span id="password-confirm-error" className={styles.error}>
                                            {errors.password.confirmation}
                                        </span>
                                    )}
                                </div>
                            </fieldset>
                            {messages.password?.error && <FeedbackMessage variant="error">{messages.password.error}</FeedbackMessage>}
                            <Button type="submit" variant="outline" disabled={Boolean(busy)}>
                                {busy === 'password' ? '正在修改…' : '修改密码并重新登录'}
                            </Button>
                        </form>
                    </div>
                </div>
            </section>
            <AccountModels />
            <EmbeddingModels />
        </div>
    )
}
