// @vitest-environment jsdom

import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useRef, useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProjectFolder } from '@ai-harness/contracts'
import { ProjectFolders } from '../../components/project-folders'
import { ProjectFiles } from '../../components/project-files'
import { SidebarProvider, useSidebar } from '../../components/ui/sidebar'
import { Button } from '../../components/ui/button'
import { PrivatePortalProvider } from '../../components/private-portal'
import { acceptanceDeferred, installAcceptanceBrowser } from './shadcn-acceptance-fixture'

const fixture = vi.hoisted(() => ({ list: vi.fn(), create: vi.fn(), documents: vi.fn(), upload: vi.fn() }))
vi.mock('../../lib/project-folder-client', () => ({ listProjectFolders: fixture.list, createProjectFolder: fixture.create }))
vi.mock('../../lib/knowledge-client', () => ({ listKnowledgeDocuments: fixture.documents, uploadKnowledgeDocument: fixture.upload }))

const folder: ProjectFolder = {
    id: '642f7bcd-c9ce-4ac0-985a-45b1e8378a79',
    name: '网站改版',
    createdAt: '2026-10-22T00:00:00.000Z',
    updatedAt: '2026-10-22T00:00:00.000Z',
}
const otherFolder: ProjectFolder = { ...folder, id: 'c0c1b318-77b5-43b2-88c2-bc76e3acbbba', name: '客户方案' }
const document = {
    id: '1751363c-39c5-4825-aa7a-96ee6b13608b',
    projectFolderId: folder.id,
    fileName: '改版资料.md',
    status: 'ready',
    format: 'md',
    size: 40,
    chunkSize: 1000,
    overlap: 200,
    characterCount: 10,
    chunkCount: 1,
    attempt: 1,
    createdAt: folder.createdAt,
    updatedAt: folder.updatedAt,
}

/**
 * Mounts accessible private overlays in a disposable authenticated host.
 * @param child - Actual project component under test.
 * @returns Testing Library controls for rerendering and cleanup.
 */
function mount(child: React.ReactNode) {
    const host = window.document.createElement('div')
    window.document.body.append(host)
    return render(
        <PrivatePortalProvider container={host}>
            <SidebarProvider>{child}</SidebarProvider>
        </PrivatePortalProvider>,
        { container: host }
    )
}

/**
 * Connects a real responsive opener ref to the standard Sheet focus manager.
 * @returns One visible project files button and its controlled project Sheet.
 */
function ProjectFilesWithOpener() {
    const { isMobile } = useSidebar()
    const mobile = useRef<HTMLButtonElement>(null)
    const desktop = useRef<HTMLButtonElement>(null)
    const [open, setOpen] = useState(false)
    return (
        <>
            <Button ref={mobile} hidden={!isMobile} onClick={() => setOpen(true)} aria-label="打开项目资料">
                手机资料
            </Button>
            <Button ref={desktop} hidden={isMobile} onClick={() => setOpen(true)} aria-label="打开项目资料">
                桌面资料
            </Button>
            <ProjectFiles
                projectFolderId={folder.id}
                projectName={folder.name}
                open={open}
                onOpenChange={setOpen}
                returnFocusRef={isMobile ? mobile : desktop}
            />
        </>
    )
}

beforeEach(() => {
    installAcceptanceBrowser()
    fixture.list.mockReset().mockResolvedValue([folder, otherFolder])
    fixture.create.mockReset().mockResolvedValue(folder)
    fixture.documents.mockReset().mockResolvedValue({ documents: [document], total: 1, page: 1, pageSize: 20 })
    fixture.upload.mockReset().mockResolvedValue({ ...document, status: 'queued' })
})
afterEach(() => {
    cleanup()
    window.document.body.replaceChildren()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
})

describe('personal project navigation and files', () => {
    it('creates only after manual submission, retains failed action and shows each folder independently', async () => {
        const user = userEvent.setup()
        fixture.list.mockResolvedValue([])
        fixture.create.mockRejectedValueOnce(new Error('暂时不可用')).mockResolvedValueOnce(folder)
        const change = vi.fn()
        const createChat = vi.fn()
        mount(
            <ProjectFolders
                folders={[]}
                onFoldersChange={change}
                conversations={[]}
                activeId={null}
                onSelectConversation={vi.fn()}
                onNewConversation={createChat}
            />
        )
        await waitFor(() => expect(fixture.list).toHaveBeenCalled())
        await user.click(screen.getByRole('button', { name: '新建项目' }))
        await user.type(screen.getByLabelText('项目名称'), folder.name)
        expect(fixture.create).not.toHaveBeenCalled()
        await user.click(screen.getByRole('button', { name: '创建项目' }))
        await screen.findByText('暂时不可用')
        await user.click(screen.getByRole('button', { name: '创建项目' }))
        await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
        expect(fixture.create.mock.calls[0]![0]).toEqual(fixture.create.mock.calls[1]![0])
        expect(fixture.create.mock.calls[0]![0]).toEqual({ name: folder.name, requestId: expect.any(String) })
        expect(createChat).not.toHaveBeenCalled()
    })

    it('expands only a selected folder and opens the exact ordinary conversation or empty project draft', async () => {
        const user = userEvent.setup()
        const select = vi.fn()
        const createChat = vi.fn()
        const conversation = {
            id: document.id,
            title: '改版讨论',
            projectFolderId: folder.id,
            messages: [],
            createdAt: folder.createdAt,
            updatedAt: folder.updatedAt,
        }
        mount(
            <ProjectFolders
                folders={[folder, otherFolder]}
                onFoldersChange={vi.fn()}
                conversations={[conversation]}
                activeId={null}
                onSelectConversation={select}
                onNewConversation={createChat}
            />
        )
        const header = await screen.findByRole('button', { name: folder.name })
        expect(screen.queryByRole('button', { name: '项目' })).toBeNull()
        expect(screen.queryByRole('button', { name: conversation.title })).toBeNull()
        await user.click(header)
        await user.click(await screen.findByRole('button', { name: conversation.title }))
        expect(select).toHaveBeenCalledExactlyOnceWith(conversation.id)
        await user.click(screen.getByRole('button', { name: `在“${folder.name}”中新建对话` }))
        expect(createChat).toHaveBeenCalledExactlyOnceWith(folder)
        expect(fixture.create).not.toHaveBeenCalled()
    })

    it('reads and uploads under the exact project, retaining the file action after failure', async () => {
        const user = userEvent.setup()
        fixture.upload.mockRejectedValueOnce(new Error('上传中断')).mockResolvedValueOnce({ ...document, status: 'queued' })
        mount(<ProjectFiles projectFolderId={folder.id} projectName={folder.name} open onOpenChange={vi.fn()} />)
        const panel = within(await screen.findByRole('dialog', { name: '项目资料' }))
        await panel.findByText(document.fileName)
        expect(fixture.documents.mock.calls[0]![0]).toMatchObject({ projectFolderId: folder.id })
        expect(panel.getByRole('link', { name: '查看资料' }).getAttribute('href')).toBe(`/rag/${document.id}?projectFolderId=${folder.id}`)
        const file = new File(['真实项目资料'], 'project.md', { type: 'text/markdown' })
        await user.upload(panel.getByLabelText('上传资料'), file)
        await user.click(panel.getByRole('button', { name: '上传资料' }))
        await panel.findByText('上传中断')
        await user.click(panel.getByRole('button', { name: '重试上传' }))
        await panel.findByText(/已上传，处理完成后/)
        expect(fixture.upload.mock.calls[0]![1]).toEqual(fixture.upload.mock.calls[1]![1])
        expect(fixture.upload.mock.calls[0]![1]).toMatchObject({ projectFolderId: folder.id, requestId: expect.any(String) })
    })

    it('ignores a late old-project file response after switching project scope', async () => {
        const pending = acceptanceDeferred<{ documents: (typeof document)[]; total: number; page: number; pageSize: number }>()
        fixture.documents.mockReturnValueOnce(pending.promise).mockResolvedValueOnce({ documents: [], total: 0, page: 1, pageSize: 20 })
        const host = window.document.createElement('div')
        window.document.body.append(host)
        const view = render(
            <PrivatePortalProvider container={host}>
                <ProjectFiles key={folder.id} projectFolderId={folder.id} projectName={folder.name} open onOpenChange={vi.fn()} />
            </PrivatePortalProvider>,
            { container: host }
        )
        await waitFor(() => expect(fixture.documents).toHaveBeenCalledTimes(1))
        view.rerender(
            <PrivatePortalProvider container={host}>
                <ProjectFiles
                    key={otherFolder.id}
                    projectFolderId={otherFolder.id}
                    projectName={otherFolder.name}
                    open
                    onOpenChange={vi.fn()}
                />
            </PrivatePortalProvider>
        )
        await screen.findByText('还没有项目资料，可以先上传一份文件。')
        pending.resolve({ documents: [document], total: 1, page: 1, pageSize: 20 })
        await waitFor(() => expect(screen.queryByText(document.fileName)).toBeNull())
        expect(fixture.documents.mock.calls[1]![0]).toMatchObject({ projectFolderId: otherFolder.id })
    })
})

it.each([390, 1280])('returns Escape focus to the actual visible project files opener at %ipx', async width => {
    installAcceptanceBrowser(width)
    const user = userEvent.setup()
    mount(<ProjectFilesWithOpener />)
    const opener = screen.getByRole('button', { name: '打开项目资料' })
    await user.click(opener)
    await screen.findByRole('dialog', { name: '项目资料' })
    await screen.findByText(document.fileName)
    const input = screen.getByLabelText('上传资料')
    await user.click(input)
    expect(window.document.activeElement).toBe(input)
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '项目资料' })).toBeNull())
    await waitFor(() => expect(window.document.activeElement).toBe(opener))
})
