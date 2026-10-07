/**
 * AcroForm support for the editor.
 *
 * Extraction returns every widget with its page and rectangle already mapped
 * into *display space* -- the same frame the rendered page and overlay use --
 * so the UI can lay live inputs straight over the raster. Values are applied
 * by field name through pdf-lib's form API, never by rewriting dictionaries.
 */

import {
  PDFArray,
  PDFCheckBox,
  PDFDocument,
  PDFDropdown,
  PDFName,
  PDFOptionList,
  PDFRadioGroup,
  PDFTextField,
  type PDFDict,
  type PDFPage,
} from '@cantoo/pdf-lib';
import { pageGeom, pdfRectToView } from './geometry.js';

export type FormFieldType = 'text' | 'checkbox' | 'dropdown' | 'optionlist' | 'radio' | 'button';

export interface FormWidgetInfo {
  /** Fully-qualified field name -- shared by every widget of a radio group. */
  name: string;
  type: FormFieldType;
  pageIndex: number;
  /** Widget rectangle in display space (top-left origin, y down). */
  rect: { x: number; y: number; width: number; height: number };
  /** Choice options for dropdowns, option lists and radio groups. */
  options?: string[];
  /** Radio widgets only: the option this particular dot selects. */
  option?: string;
  /** Current field value, for pre-filling the overlay input. */
  value?: string | boolean;
  /** Tooltip (/TU) when present -- nicer label than the raw name. */
  label?: string;
}

type AnyField = ReturnType<PDFDocument['getForm']>['getFields'] extends () => (infer F)[] ? F : never;

/** Every fillable widget in the document, in field order. */
export function extractFormWidgets(doc: PDFDocument): FormWidgetInfo[] {
  const pageByRect = buildRectPageMap(doc);
  const pages = doc.getPages();
  let fields: AnyField[];
  try {
    fields = doc.getForm().getFields();
  } catch {
    return [];
  }

  const out: FormWidgetInfo[] = [];
  for (const field of fields) {
    const name = field.getName();
    if (!name) continue;
    const type = fieldTypeOf(field);
    if (type === 'button') continue; // push buttons take no value

    const options = choiceOptionsOf(field, type);
    const value = currentValueOf(field, type);

    let widgets: { getRectangle(): { x: number; y: number; width: number; height: number } }[];
    try {
      widgets = field.acroField.getWidgets();
    } catch {
      continue;
    }

    widgets.forEach((widget, widgetIndex) => {
      const box = widget.getRectangle();
      const pageIndex = pageByRect.get(rectKey(box));
      // A widget we cannot place on a page is still fillable via the field's
      // value, but we never invent a position for it.
      if (pageIndex === undefined) return;
      const rect = pdfRectToView(pageGeom(pages[pageIndex]!), box);
      const option = type === 'radio' ? options[widgetIndex] : undefined;
      out.push({
        name,
        type,
        pageIndex,
        rect,
        ...(options.length > 0 ? { options } : {}),
        ...(option !== undefined ? { option } : {}),
        ...(type === 'radio' ? { value: value === option } : { value }),
        ...readLabel(widget),
      });
    });
  }
  return out;
}

/** Applies UI form values (`name → value`) to the open document. */
export function applyFormValues(doc: PDFDocument, values: Record<string, string | boolean>): void {
  const entries = Object.entries(values ?? {});
  if (entries.length === 0) return;
  const form = doc.getForm();
  const known = new Set(form.getFields().map((field) => field.getName()).filter(Boolean));

  for (const [name, value] of entries) {
    if (!known.has(name)) {
      throw new Error(`Form field "${name}" does not exist in this document`);
    }
    const field = form.getField(name);
    try {
      if (field instanceof PDFTextField) {
        field.setText(typeof value === 'string' ? value : value ? 'Yes' : '');
      } else if (field instanceof PDFCheckBox) {
        if (value) field.check();
        else field.uncheck();
      } else if (field instanceof PDFDropdown || field instanceof PDFOptionList) {
        if (typeof value === 'string' && value.length > 0) field.select(value);
        else if (field instanceof PDFOptionList) field.select([]);
      } else if (field instanceof PDFRadioGroup) {
        if (typeof value === 'string' && value.length > 0) field.select(value);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Could not fill form field "${name}": ${message}`);
    }
  }

  // Redraw widget appearances so filled values are visible everywhere; some
  // documents cannot regenerate appearances, and most viewers rebuild them on
  // open anyway -- so a failure here must not fail the save.
  try {
    form.updateFieldAppearances();
  } catch {
    /* keep the values; appearances regenerate on open */
  }
}

function fieldTypeOf(field: AnyField): FormFieldType {
  if (field instanceof PDFTextField) return 'text';
  if (field instanceof PDFCheckBox) return 'checkbox';
  if (field instanceof PDFDropdown) return 'dropdown';
  if (field instanceof PDFOptionList) return 'optionlist';
  if (field instanceof PDFRadioGroup) return 'radio';
  return 'button';
}

function choiceOptionsOf(field: AnyField, type: FormFieldType): string[] {
  if (type !== 'dropdown' && type !== 'optionlist' && type !== 'radio') return [];
  try {
    const options = (field as PDFDropdown | PDFOptionList | PDFRadioGroup).getOptions();
    return Array.isArray(options) ? options.filter((o) => typeof o === 'string') : [];
  } catch {
    return [];
  }
}

function currentValueOf(field: AnyField, type: FormFieldType): string | boolean | undefined {
  try {
    if (type === 'text') return (field as PDFTextField).getText() ?? '';
    if (type === 'checkbox') return (field as PDFCheckBox).isChecked() ?? false;
    if (type === 'dropdown') return (field as PDFDropdown).getSelected()[0] ?? '';
    if (type === 'optionlist') return (field as PDFOptionList).getSelected()[0] ?? '';
    if (type === 'radio') return (field as PDFRadioGroup).getSelected() ?? '';
  } catch {
    return undefined;
  }
  return undefined;
}

/** `rect → pageIndex` for every widget annotation, keyed by rounded corners. */
function buildRectPageMap(doc: PDFDocument): Map<string, number> {
  const map = new Map<string, number>();
  const pages = doc.getPages();
  pages.forEach((page, index) => {
    for (const dict of widgetDicts(page, doc)) {
      const numbers = readRect(dict.get(PDFName.of('Rect')) as PDFArray | undefined);
      if (!numbers) continue;
      const key = rectKey({ x: numbers[0], y: numbers[1], width: numbers[2] - numbers[0], height: numbers[3] - numbers[1] });
      // Duplicated pages share annotations: keep the first occurrence, which is
      // where the overlay should appear (values still apply to the whole field).
      if (!map.has(key)) map.set(key, index);
    }
  });
  return map;
}

function widgetDicts(page: PDFPage, doc: PDFDocument): PDFDict[] {
  try {
    const annots = page.node.get(PDFName.of('Annots'));
    if (!annots || typeof (annots as PDFArray).size !== 'function') return [];
    const array = annots as PDFArray;
    const dicts: PDFDict[] = [];
    for (let i = 0; i < array.size(); i += 1) {
      const looked = doc.context.lookup(array.get(i));
      const dict = looked as PDFDict | undefined;
      if (!dict || typeof dict.get !== 'function') continue;
      const subtype = dict.get(PDFName.of('Subtype'));
      if (subtype?.toString() !== '/Widget') continue;
      dicts.push(dict);
    }
    return dicts;
  } catch {
    return [];
  }
}

function readRect(rect: PDFArray | undefined): [number, number, number, number] | null {
  try {
    if (!rect || typeof rect.size !== 'function' || rect.size() < 4) return null;
    const nums = [rect.get(0), rect.get(1), rect.get(2), rect.get(3)].map((v) =>
      Number((v as { asNumber?: () => number }).asNumber?.() ?? NaN),
    );
    if (nums.some((n) => !Number.isFinite(n))) return null;
    return [nums[0]!, nums[1]!, nums[2]!, nums[3]!];
  } catch {
    return null;
  }
}

function rectKey(box: { x: number; y: number; width: number; height: number }): string {
  const r = (n: number) => Math.round(n * 100) / 100;
  return `${r(box.x)},${r(box.y)},${r(box.width)},${r(box.height)}`;
}

function readLabel(widget: unknown): { label?: string } {
  try {
    const dict = (widget as { getDictionary?: () => PDFDict }).getDictionary?.();
    const tu = dict?.get(PDFName.of('TU')) as { asString?: () => string } | undefined;
    const label = tu?.asString?.()?.trim();
    return label ? { label } : {};
  } catch {
    return {};
  }
}
