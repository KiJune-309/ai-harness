import { TemplateWorkspace } from '../../../components/template-workspace'

/**
 * Opens a new collaborative workflow draft without creating server records.
 * @returns The full-page template editor.
 */
export default function NewTemplatePage() {
    return <TemplateWorkspace editing />
}
