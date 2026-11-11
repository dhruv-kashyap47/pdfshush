/**
 * Display state for AcroForm widgets in the editor overlay.
 *
 * `extractFormWidgets` reports a radio group per option: every widget carries
 * the option it represents and a boolean `value` saying whether that option is
 * the selected one. Once the user edits the group, the editor stores the chosen
 * option as a string instead. The overlay has to understand both shapes, or the
 * current selection appears as a row of unchecked radios until it is clicked.
 */

import type { FormWidgetInfo } from '@pdfshush/pdf-core';

export type FormWidgetValue = string | boolean | undefined;

/** Whether a widget should render as checked/selected for `value`. */
export function isFormWidgetChecked(
  widget: Pick<FormWidgetInfo, 'type' | 'option'>,
  value: FormWidgetValue,
): boolean {
  if (widget.type === 'radio') {
    // Initial state comes from the document as the selected widget's boolean;
    // an edited state comes from the overlay as the option string.
    if (typeof value === 'boolean') return value;
    return value !== undefined && value === widget.option;
  }
  return Boolean(value);
}
