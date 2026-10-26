/**
 * Adding AcroForm fields to a page.
 *
 * The editor's `forms.ts` reads and fills fields that already exist; this is
 * the other direction. A field spec arrives in *display space* -- the same
 * top-left, y-down frame the page preview uses -- so the UI never does PDF
 * rotation math, and `viewRectToPdf` maps it onto the page exactly as
 * `extractFormWidgets` maps it back.
 *
 * Names are labels as well as keys: they are what a form's data and every
 * reader shows, so they are validated here rather than trusted from the UI.
 * Every field is created only after the whole batch validates, which means a
 * bad spec cannot leave a half-built form behind.
 */

import { PDFDocument } from '@cantoo/pdf-lib';
import { LIMITS } from '../limits.js';
import { displaySize, pageGeom, viewRectToPdf, type PageGeom } from './geometry.js';

export type NewFormFieldType = 'text' | 'checkbox';

export interface NewFormField {
  type: NewFormFieldType;
  /** Field name, also used as its label in most readers. */
  name: string;
  /** Zero-based page index. */
  pageIndex: number;
  /** Display-space box (top-left origin, y down, PDF points). */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Text fields only. Points, clamped to 4..48. */
  fontSize?: number;
  /** Readers refuse to submit while the field is empty. */
  required?: boolean;
  /** Text fields only: text written into the field when it is created. */
  defaultValue?: string;
  /** Checkboxes only: start checked. */
  checked?: boolean;
}

export const FORM_FIELD_LIMITS = {
  minWidth: 8,
  minHeight: 8,
  minTextWidth: 20,
  minTextHeight: 10,
  minFontSize: 4,
  maxFontSize: 48,
  defaultFontSize: 10,
} as const;

/** ASCII start, then letters/digits/space/dot/underscore/dash. */
const FIELD_NAME = /^[A-Za-z0-9][A-Za-z0-9 ._-]*$/;

interface PreparedField extends NewFormField {
  geom: PageGeom;
}

/**
 * Creates the fields and returns how many were added. Throws on the first
 * invalid spec; callers get a message naming the field, not an index.
 */
export function addFormFields(doc: PDFDocument, fields: NewFormField[]): number {
  if (!Array.isArray(fields) || fields.length === 0) {
    throw new Error('Add at least one form field');
  }
  if (fields.length > LIMITS.tool.maxFormFields) {
    throw new Error(`A form can receive at most ${LIMITS.tool.maxFormFields} fields at a time`);
  }

  const pages = doc.getPages();
  const prepared = fields.map((field, index) => prepare(field, index, pages));

  // Duplicate names silently merge widgets and make one field unreachable, so
  // they are refused before anything is created.
  const seen = new Map<string, number>();
  for (const [index, field] of prepared.entries()) {
    const previous = seen.get(field.name);
    if (previous !== undefined) {
      throw new Error(
        `Field "${field.name}" is used twice (fields ${previous + 1} and ${index + 1}); names must be unique`,
      );
    }
    seen.set(field.name, index);
  }

  const form = doc.getForm();
  const existing = new Set(
    form
      .getFields()
      .map((field) => field.getName())
      .filter((name): name is string => Boolean(name)),
  );
  for (const field of prepared) {
    if (existing.has(field.name)) {
      throw new Error(`Field "${field.name}" already exists in this document`);
    }
  }

  for (const field of prepared) {
    const page = pages[field.pageIndex]!;
    const box = viewRectToPdf(field.geom, {
      x: field.x,
      y: field.y,
      width: field.width,
      height: field.height,
    });

    if (field.type === 'text') {
      const text = form.createTextField(field.name);
      text.addToPage(page, { x: box.x, y: box.y, width: box.width, height: box.height });
      text.setFontSize(field.fontSize ?? FORM_FIELD_LIMITS.defaultFontSize);
      if (field.defaultValue) text.setText(field.defaultValue);
      if (field.required) text.enableRequired();
    } else {
      const checkbox = form.createCheckBox(field.name);
      checkbox.addToPage(page, { x: box.x, y: box.y, width: box.width, height: box.height });
      if (field.checked) checkbox.check();
      if (field.required) checkbox.enableRequired();
    }
  }

  // Regenerating appearances can fail on documents with exotic existing
  // fields; the new widgets still work, so this must not fail the save.
  try {
    form.updateFieldAppearances();
  } catch {
    /* readers rebuild appearances on open */
  }

  return prepared.length;
}

function prepare(field: NewFormField, index: number, pages: ReturnType<PDFDocument['getPages']>): PreparedField {
  const label = `Field ${index + 1}`;
  if (!field || typeof field !== 'object') throw new Error(`${label} is not an object`);
  if (field.type !== 'text' && field.type !== 'checkbox') {
    throw new Error(`${label} must be a text field or a checkbox`);
  }
  if (typeof field.name !== 'string') throw new Error(`${label} needs a name`);
  const name = field.name.trim();
  if (!name) throw new Error(`${label} needs a name`);
  if (name.length > LIMITS.tool.maxFormFieldNameChars) {
    throw new Error(`${label} name is too long (max ${LIMITS.tool.maxFormFieldNameChars} characters)`);
  }
  if (!FIELD_NAME.test(name)) {
    throw new Error(
      `${label} ("${name}") may only use letters, digits, spaces, dots, underscores and dashes, and must start with a letter or digit`,
    );
  }

  if (!Number.isInteger(field.pageIndex) || field.pageIndex < 0 || field.pageIndex >= pages.length) {
    throw new Error(`${label} ("${name}") points at a page that does not exist`);
  }
  const page = pages[field.pageIndex]!;
  const geom = pageGeom(page);
  const size = displaySize(geom);

  const numbers = [field.x, field.y, field.width, field.height];
  if (!numbers.every((value) => typeof value === 'number' && Number.isFinite(value))) {
    throw new Error(`${label} ("${name}") has an invalid position or size`);
  }

  const minWidth = field.type === 'text' ? FORM_FIELD_LIMITS.minTextWidth : FORM_FIELD_LIMITS.minWidth;
  const minHeight = field.type === 'text' ? FORM_FIELD_LIMITS.minTextHeight : FORM_FIELD_LIMITS.minHeight;
  if (field.width < minWidth || field.height < minHeight) {
    throw new Error(
      `${label} ("${name}") is too small; use at least ${minWidth} x ${minHeight} points`,
    );
  }
  // Half a point of tolerance absorbs percentage-rounding in the UI without
  // letting a field sit off the page.
  if (
    field.x < -0.5 ||
    field.y < -0.5 ||
    field.x + field.width > size.width + 0.5 ||
    field.y + field.height > size.height + 0.5
  ) {
    throw new Error(`${label} ("${name}") must stay inside page ${field.pageIndex + 1}`);
  }

  let fontSize: number | undefined;
  if (field.type === 'text' && field.fontSize !== undefined) {
    const value = field.fontSize;
    if (
      typeof value !== 'number' ||
      !Number.isFinite(value) ||
      value < FORM_FIELD_LIMITS.minFontSize ||
      value > FORM_FIELD_LIMITS.maxFontSize
    ) {
      throw new Error(
        `${label} ("${name}") needs a font size between ${FORM_FIELD_LIMITS.minFontSize} and ${FORM_FIELD_LIMITS.maxFontSize}`,
      );
    }
    fontSize = Math.round(value * 2) / 2;
  }

  if (field.required !== undefined && typeof field.required !== 'boolean') {
    throw new Error(`${label} ("${name}") has an invalid required flag`);
  }
  if (field.checked !== undefined && typeof field.checked !== 'boolean') {
    throw new Error(`${label} ("${name}") has an invalid checked state`);
  }

  let defaultValue: string | undefined;
  if (field.defaultValue !== undefined && field.defaultValue !== '') {
    if (field.type !== 'text') throw new Error(`${label} ("${name}") is a checkbox; it has no default text`);
    if (typeof field.defaultValue !== 'string') {
      throw new Error(`${label} ("${name}") has an invalid default value`);
    }
    if (field.defaultValue.length > LIMITS.tool.maxFormFieldValueChars) {
      throw new Error(
        `${label} ("${name}") default value is too long (max ${LIMITS.tool.maxFormFieldValueChars} characters)`,
      );
    }
    defaultValue = field.defaultValue;
  }

  return {
    type: field.type,
    name,
    pageIndex: field.pageIndex,
    x: field.x,
    y: field.y,
    width: field.width,
    height: field.height,
    ...(fontSize !== undefined ? { fontSize } : {}),
    ...(field.required ? { required: true } : {}),
    ...(defaultValue !== undefined ? { defaultValue } : {}),
    ...(field.type === 'checkbox' && field.checked ? { checked: true } : {}),
    geom,
  };
}
