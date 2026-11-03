/**
 * Compatibility surface for the old editor toolbar.
 *
 * The toolbar itself now lives in `editor-chrome.tsx`: a vertical tool rail
 * plus a contextual options bar, both driven by the tool capability registry.
 * Only the shared tokens are re-exported here so older imports keep one
 * source of truth.
 */

export { type EditorTool } from '@/lib/editor-tools';
export { editorStepZoom as stepZoom, ZOOM_STEPS } from '@/components/editor/editor-chrome';
