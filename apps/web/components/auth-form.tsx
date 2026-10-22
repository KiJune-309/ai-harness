'use client'

import { loginAccountSchema, registerAccountSchema } from '@ai-harness/contracts'
import { LoaderCircle } from 'lucide-react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { useState, type FormEvent } from 'react'
import { loginAccount, registerAccount, safeReturnTo } from '../lib/account-client'
import styles from './auth-form.module.css'
import { AuthPoster } from './auth-poster'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Label } from './ui/label'

type AuthFieldProps = {
    id: string
    label: string
    value: string
    onChange: (value: string) => void
    type?: 'text' | 'email' | 'password'
    autoComplete?: string
    inputMode?: 'email' | 'text'
    maxLength?: number
    hint?: string
    error?: string
}

/**
 * Renders a shared form field with its label, hint, and locally attached error.
 * @param props - Field identity, current value, input attributes, and optional hint or error copy.
 * @returns A labelled input whose description is announced with the field.
 */
function AuthField({ id, label, value, onChange, type = 'text', autoComplete, inputMode, maxLength, hint, error }: AuthFieldProps) {
    const messageId = `${id}-message`
    const message = error ?? hint ?? ''
    return (
        <div className={styles.field}>
            <Label htmlFor={id}>{label}</Label>
            <Input
                id={id}
                type={type}
                value={value}
                onChange={event => onChange(event.target.value)}
                autoComplete={autoComplete}
                inputMode={inputMode}
                maxLength={maxLength}
                required
                aria-invalid={Boolean(error)}
                aria-describedby={message ? messageId : undefined}
            />
            {message && (
                <span className={styles.fieldMessage} id={messageId} data-kind={error ? 'error' : 'hint'}>
                    {message}
                </span>
            )}
        </div>
    )
}

/**
 * Renders the public registration or login surface with private credential handling.
 * @param props - Whether this form creates an account instead of opening an existing one.
 * @returns An accessible split poster-and-form authentication page with local validation feedback.
 */
export function AuthForm({ register = false }: { register?: boolean }) {
    const params = useSearchParams()
    const requestedReturnTo = params.get('returnTo')
    const returnTo = safeReturnTo(requestedReturnTo)
    // Session notices come from the auth boundary; the register page never renders a return reason.
    const reason = register ? null : params.get('reason')
    const [username, setUsername] = useState('')
    const [email, setEmail] = useState('')
    const [password, setPassword] = useState('')
    const [confirmation, setConfirmation] = useState('')
    const [errors, setErrors] = useState<Record<string, string>>({})
    const [failure, setFailure] = useState('')
    const [busy, setBusy] = useState(false)

    /**
     * Validates entered fields and establishes a session before full-page navigation.
     * @param event - Form submission event.
     * @returns After the request settles or local validation fails.
     */
    async function submit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault()
        if (busy) return
        const input = register ? { username, email, password } : { email, password }
        const parsed = (register ? registerAccountSchema : loginAccountSchema).safeParse(input)
        const nextErrors: Record<string, string> = {}
        if (!parsed.success) for (const issue of parsed.error.issues) nextErrors[String(issue.path[0])] ??= issue.message
        // An untouched field asks for an entry instead of repeating the shared length rule.
        if (register && !username.trim()) nextErrors.username = '请输入用户名。'
        if (!email.trim()) nextErrors.email = '请输入邮箱。'
        if (!password) nextErrors.password = '请输入密码。'
        if (register && password !== confirmation) nextErrors.confirmation = '两次输入的密码不一致。'
        setErrors(nextErrors)
        setFailure('')
        if (Object.keys(nextErrors).length || !parsed.success) {
            const form = event.currentTarget
            requestAnimationFrame(() => form.querySelector<HTMLInputElement>('[aria-invalid="true"]')?.focus())
            return
        }
        setBusy(true)
        try {
            if (register) await registerAccount(registerAccountSchema.parse(input))
            else await loginAccount(loginAccountSchema.parse(input))
            setPassword('')
            setConfirmation('')
            window.location.assign(returnTo)
        } catch (cause) {
            setFailure(cause instanceof Error ? cause.message : '暂时无法完成，请重试。')
            setBusy(false)
        }
    }

    // Only a real session notice earns the line above the title; a plain visit starts with the title itself.
    const statusLine =
        reason === 'expired' ? '登录状态已过期。' : reason === 'updated' ? '账户信息已更新，请用更新后的邮箱或密码重新登录。' : null
    const headline = register ? '进入你的轨道。' : '回到你的轨道。'
    const lede = register ? '工作空间、对话和资料，都从这里开始。' : '工作空间、对话和资料都还在。'

    return (
        <main className={styles.page} data-busy={busy ? 'true' : undefined}>
            <AuthPoster />
            <section className={styles.access} aria-label={register ? '注册' : '登录'}>
                <div className={styles.accessInner}>
                    {statusLine && (
                        <>
                            <p className={styles.kicker} data-state={reason} role="status">
                                {statusLine}
                            </p>
                            <div className={styles.kickerRule} aria-hidden="true" />
                        </>
                    )}
                    <h1 className={styles.title}>{headline}</h1>
                    <p className={styles.lede}>{lede}</p>
                    <form className={styles.form} onSubmit={submit} aria-label={register ? '注册' : '登录'} aria-busy={busy} noValidate>
                        <fieldset className={styles.fields} data-mode={register ? 'register' : 'login'} disabled={busy}>
                            {register && (
                                <AuthField
                                    id="auth-username"
                                    label="用户名"
                                    value={username}
                                    onChange={setUsername}
                                    autoComplete="nickname"
                                    maxLength={50}
                                    error={errors.username}
                                />
                            )}
                            <AuthField
                                id="auth-email"
                                label="邮箱"
                                type="email"
                                value={email}
                                onChange={setEmail}
                                autoComplete="email"
                                inputMode="email"
                                maxLength={254}
                                error={errors.email}
                            />
                            <AuthField
                                id="auth-password"
                                label="密码"
                                type="password"
                                value={password}
                                onChange={setPassword}
                                autoComplete={register ? 'new-password' : 'current-password'}
                                maxLength={128}
                                hint={register ? '12–128 个字符，空格也会保留。' : undefined}
                                error={errors.password}
                            />
                            {register && (
                                <AuthField
                                    id="auth-confirmation"
                                    label="确认密码"
                                    type="password"
                                    value={confirmation}
                                    onChange={setConfirmation}
                                    autoComplete="new-password"
                                    maxLength={128}
                                    error={errors.confirmation}
                                />
                            )}
                        </fieldset>
                        <Button className={styles.submit} type="submit" size="lg" disabled={busy}>
                            {busy && <LoaderCircle aria-hidden="true" className="animate-spin motion-reduce:animate-none" />}
                            {busy ? (register ? '正在创建…' : '正在登录…') : register ? '创建账户' : '登录'}
                        </Button>
                        {failure && (
                            <p className={styles.formStatus} role="alert">
                                {failure}
                            </p>
                        )}
                        <p className={styles.switch}>
                            {register ? '已经有账户？' : '还没有账户？'}
                            {busy ? (
                                <span className={styles.switchLinkDisabled} aria-disabled="true">
                                    {register ? '前往登录' : '注册账户'}
                                </span>
                            ) : (
                                <Link
                                    className={styles.switchLink}
                                    href={`${register ? '/login' : '/register'}?returnTo=${encodeURIComponent(returnTo)}`}
                                >
                                    {register ? '前往登录' : '注册账户'}
                                </Link>
                            )}
                        </p>
                    </form>
                </div>
            </section>
        </main>
    )
}
