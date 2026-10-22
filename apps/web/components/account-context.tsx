'use client'

import type { AccountMe, AccountUser } from '@ai-harness/contracts'
import { createContext, useContext } from 'react'

export type AccountContextValue = AccountMe & {
    updateUser: (user: AccountUser) => void
    clearAccount: () => void
    modelLabel: (modelId: string | undefined) => string
    refreshModelNames: () => void
}

export const AccountContext = createContext<AccountContextValue | null>(null)

/**
 * Reads the profile already verified by the authentication boundary.
 * @returns The current profile, storage mode, and profile update callback.
 * @throws Error if a private component is mounted outside the boundary.
 */
export function useAccount(): AccountContextValue {
    const account = useContext(AccountContext)
    if (!account) throw new Error('账户组件需要已登录的会话。')
    return account
}
