import type { CollaborationCommand } from '@ai-harness/contracts'
import { GoneException, Injectable, type CanActivate } from '@nestjs/common'

/**
 * Rejects removed project behavior before it can create or restore old business records.
 * @returns Nothing; every call throws before retired work can proceed.
 * @throws GoneException because the old project model has been removed.
 */
export function throwLegacyProjectRetired(): void {
    throw new GoneException('旧项目功能已移除，请从侧栏创建个人项目。')
}

/**
 * Preserves ordinary colleague messaging while refusing retired project and node capabilities.
 * @param command - Validated human or leased Agent command.
 * @returns Nothing for independent messaging and its dedicated confirmation actions.
 * @throws GoneException for a command tied to the old project model.
 */
export function assertLegacyProjectCommandAvailable(command: CollaborationCommand): void {
    if (!['message', 'read', 'confirm-dispatch', 'cancel-dispatch'].includes(command.type)) throwLegacyProjectRetired()
}

/** Prevents old project HTTP routes from reaching persistence or model preparation. */
@Injectable()
export class LegacyProjectsRetiredGuard implements CanActivate {
    /**
     * Refuses a retired feature route after normal application authentication.
     * @returns No authorization; every call throws before returning.
     * @throws GoneException for every request to the removed route.
     */
    canActivate(): boolean {
        throwLegacyProjectRetired()
        return false
    }
}
