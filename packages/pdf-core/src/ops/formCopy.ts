/**
 * AcroForm preservation for page-copy tools.
 *
 * `PDFDocument.copyPages` carries a page's `/Annots` but not the catalog-level
 * `/AcroForm`, so copied widget annotations become unregistered orphans. This
 * module copies the field tree alongside the pages and reconciles the two:
 *
 *  - every widget's `/P` is rewired to the real destination page, never to a
 *    duplicate page dictionary created while cloning the form;
 *  - the page's `/Annots` array is rewritten to point at the copied field
 *    widgets, so the field tree and the page annotations share one object;
 *  - colliding fully-qualified names get `_2`, `_3`, ... suffixes, which also
 *    gives a duplicated page its own independently fillable fields.
 *
 * The tree is cloned node by node rather than through `PDFObjectCopier.copy`
 * on the whole `/AcroForm`: a generic copier follows `/P` into the source page
 * tree and duplicates every page it touches.
 */

import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFNull,
  PDFObject,
  PDFObjectCopier,
  PDFPage,
  PDFRef,
  PDFString,
  PDFStream,
} from '@cantoo/pdf-lib';

export interface FormPlacement {
  docIndex: number;
  sourcePageIndex: number;
  /** The destination page this source page was copied to. */
  page: PDFPage;
}

interface CopyArgs {
  source: PDFDocument;
  target: PDFDocument;
  /** Source page index -> destination page for this call. */
  pageMap: Map<number, PDFPage>;
  /** Source page indexes whose widgets are allowed in this call. */
  allowedPages: Set<number>;
  /** Fully-qualified names already used by earlier copies. */
  usedNames: Set<string>;
}

function refKey(ref: PDFRef): string {
  return `${ref.objectNumber} ${ref.generationNumber}`;
}

function decodeText(value: PDFObject | undefined): string | undefined {
  if (value instanceof PDFString || value instanceof PDFHexString) {
    const text = value.decodeText();
    return text.length > 0 ? text : undefined;
  }
  return undefined;
}

function isWidget(dict: PDFDict): boolean {
  return dict.get(PDFName.of('Subtype'))?.toString() === '/Widget';
}

/** Copies the AcroForm fields whose widgets live on the pages in `pageMap`. */
function copyAcroFormForPages(args: CopyArgs): Map<PDFPage, PDFRef[]> {
  const { source, target, pageMap, allowedPages, usedNames } = args;
  const widgetsByPage = new Map<PDFPage, PDFRef[]>();
  const sourceForm = source.context.lookup(source.catalog.get(PDFName.of('AcroForm')));
  if (!(sourceForm instanceof PDFDict)) return widgetsByPage;
  const sourceFields = source.context.lookup(sourceForm.get(PDFName.of('Fields')));
  if (!(sourceFields instanceof PDFArray)) return widgetsByPage;

  const sourcePageByRef = new Map<string, number>();
  const widgetOwner = new Map<PDFDict, number>();
  source.getPages().forEach((page, index) => {
    sourcePageByRef.set(refKey(page.ref), index);
    const annots = page.node.Annots();
    if (!annots) return;
    for (let i = 0; i < annots.size(); i += 1) {
      const annot = source.context.lookup(annots.get(i));
      if (annot instanceof PDFDict && isWidget(annot) && !widgetOwner.has(annot)) {
        widgetOwner.set(annot, index);
      }
    }
  });

  const copier = PDFObjectCopier.for(source.context, target.context);

  const copyValue = (value: PDFObject): PDFObject => {
    if (value instanceof PDFRef) {
      // A reference to a source page must resolve to the destination page that
      // already exists; copying it would clone the page dictionary and the
      // whole page tree behind it.
      const pageIndex = sourcePageByRef.get(refKey(value));
      if (pageIndex !== undefined) {
        return pageMap.get(pageIndex)?.ref ?? PDFNull;
      }
      // Streams copied this way keep their own indirect identity.
      if (source.context.lookup(value) instanceof PDFStream) return copier.copy(value);
    }
    return copier.copy(value);
  };

  const widgetPage = (dict: PDFDict): number | undefined => {
    try {
      const ref = dict.get(PDFName.of('P'));
      if (ref instanceof PDFRef) {
        const byRef = sourcePageByRef.get(refKey(ref));
        if (byRef !== undefined) return byRef;
      }
    } catch {
      /* fall through to /Annots ownership */
    }
    return widgetOwner.get(dict);
  };

  const cloneWidget = (
    dict: PDFDict,
    parentRef: PDFRef | undefined,
    pageIndex: number | undefined,
  ): PDFRef | undefined => {
    if (pageIndex === undefined || !allowedPages.has(pageIndex)) return undefined;
    const targetPage = pageMap.get(pageIndex);
    if (!targetPage) return undefined;
    const cloned = PDFDict.withContext(target.context);
    const ref = target.context.nextRef();
    for (const [key, value] of dict.entries()) {
      const name = key.toString();
      if (name === '/Parent' || name === '/P') continue;
      cloned.set(key, copyValue(value));
    }
    cloned.set(PDFName.of('P'), targetPage.ref);
    if (parentRef) cloned.set(PDFName.of('Parent'), parentRef);
    target.context.assign(ref, cloned);
    const bucket = widgetsByPage.get(targetPage) ?? [];
    bucket.push(ref);
    widgetsByPage.set(targetPage, bucket);
    return ref;
  };

  const cloneField = (
    node: PDFObject,
    parentRef: PDFRef | undefined,
    parentName: string,
  ): PDFRef | undefined => {
    const dict = source.context.lookup(node);
    if (!(dict instanceof PDFDict)) return undefined;
    const widget = isWidget(dict);
    const hasFieldKey = dict.has(PDFName.of('FT')) || dict.has(PDFName.of('T'));
    const pageIndex = widget ? widgetPage(dict) : undefined;
    if (widget && !hasFieldKey) return cloneWidget(dict, parentRef, pageIndex);
    if (widget && (pageIndex === undefined || !allowedPages.has(pageIndex))) return undefined;

    const cloned = PDFDict.withContext(target.context);
    const ref = target.context.nextRef();
    for (const [key, value] of dict.entries()) {
      const name = key.toString();
      if (name === '/Kids' || name === '/Parent' || name === '/P' || name === '/T') continue;
      cloned.set(key, copyValue(value));
    }

    const kidsValue = source.context.lookup(dict.get(PDFName.of('Kids')));
    const kids = kidsValue instanceof PDFArray ? kidsValue.asArray() : [];
    const terminal =
      kids.length === 0 ||
      kids.every((kid) => {
        const child = source.context.lookup(kid);
        return child instanceof PDFDict && isWidget(child);
      });

    const partial = decodeText(dict.get(PDFName.of('T')));
    let fieldName = parentName;
    if (partial) {
      let nextPartial = partial;
      let nextName = parentName ? `${parentName}.${partial}` : partial;
      if (terminal && usedNames.has(nextName)) {
        let suffix = 2;
        do {
          nextPartial = `${partial}_${suffix}`;
          nextName = parentName ? `${parentName}.${nextPartial}` : nextPartial;
          suffix += 1;
        } while (usedNames.has(nextName));
      }
      cloned.set(PDFName.of('T'), PDFString.of(nextPartial));
      fieldName = nextName;
      if (terminal) usedNames.add(nextName);
    }

    if (parentRef) cloned.set(PDFName.of('Parent'), parentRef);
    if (widget) {
      const targetPage = pageMap.get(pageIndex!);
      if (!targetPage) return undefined;
      cloned.set(PDFName.of('P'), targetPage.ref);
      const bucket = widgetsByPage.get(targetPage) ?? [];
      bucket.push(ref);
      widgetsByPage.set(targetPage, bucket);
    }

    if (kids.length > 0) {
      const childRefs: PDFRef[] = [];
      for (const kid of kids) {
        const child = cloneField(kid, ref, fieldName);
        if (child) childRefs.push(child);
      }
      // A non-terminal field whose every child was on an excluded page has no
      // place in the output; dropping it keeps the form tree honest.
      if (childRefs.length === 0 && !dict.has(PDFName.of('FT'))) return undefined;
      if (childRefs.length > 0) cloned.set(PDFName.of('Kids'), target.context.obj(childRefs));
    }

    target.context.assign(ref, cloned);
    return ref;
  };

  const clonedRoots: PDFRef[] = [];
  for (const root of sourceFields.asArray()) {
    const ref = cloneField(root, undefined, '');
    if (ref) clonedRoots.push(ref);
  }
  if (clonedRoots.length === 0) return widgetsByPage;

  let targetForm = target.context.lookup(target.catalog.get(PDFName.of('AcroForm')));
  let targetFields: PDFArray;
  if (targetForm instanceof PDFDict) {
    const existing = target.context.lookup(targetForm.get(PDFName.of('Fields')));
    targetFields = existing instanceof PDFArray ? existing : PDFArray.withContext(target.context);
    targetForm.set(PDFName.of('Fields'), targetFields);
  } else {
    const createdForm = PDFDict.withContext(target.context);
    for (const [key, value] of sourceForm.entries()) {
      const name = key.toString();
      // XFA duplicates the same values in a second format; keeping the
      // AcroForm tree alone is the predictable choice after a page rebuild.
      if (name === '/Fields' || name === '/XFA' || name === '/Parent') continue;
      createdForm.set(key, copyValue(value));
    }
    targetFields = PDFArray.withContext(target.context);
    createdForm.set(PDFName.of('Fields'), targetFields);
    target.catalog.set(PDFName.of('AcroForm'), target.context.register(createdForm));
  }
  for (const ref of clonedRoots) targetFields.push(ref);

  // One widget object, reachable from both the field tree and the page.
  for (const page of pageMap.values()) {
    const current = page.node.Annots();
    const kept: PDFObject[] = [];
    if (current) {
      for (let i = 0; i < current.size(); i += 1) {
        const value = current.get(i);
        const dict = target.context.lookup(value);
        if (dict instanceof PDFDict && isWidget(dict)) continue;
        kept.push(value);
      }
    }
    const widgets = widgetsByPage.get(page) ?? [];
    if (current || widgets.length > 0) {
      page.node.set(PDFName.of('Annots'), target.context.obj([...kept, ...widgets]));
    }
  }

  return widgetsByPage;
}

/**
 * Preserves forms for every copied page. First occurrences share one field
 * tree; repeated pages get a fresh copy whose names are suffixed.
 */
export function preservePageForms(args: {
  target: PDFDocument;
  docs: PDFDocument[];
  placements: FormPlacement[];
}): void {
  const { target, docs, placements } = args;
  const usedNames = new Set<string>();
  for (let docIndex = 0; docIndex < docs.length; docIndex += 1) {
    const entries = placements.filter((entry) => entry.docIndex === docIndex);
    if (entries.length === 0) continue;
    const firstByPage = new Map<number, PDFPage>();
    const duplicates: FormPlacement[] = [];
    for (const entry of entries) {
      if (!firstByPage.has(entry.sourcePageIndex)) {
        firstByPage.set(entry.sourcePageIndex, entry.page);
      } else {
        duplicates.push(entry);
      }
    }
    copyAcroFormForPages({
      source: docs[docIndex]!,
      target,
      pageMap: firstByPage,
      allowedPages: new Set(firstByPage.keys()),
      usedNames,
    });
    for (const duplicate of duplicates) {
      copyAcroFormForPages({
        source: docs[docIndex]!,
        target,
        pageMap: new Map([[duplicate.sourcePageIndex, duplicate.page]]),
        allowedPages: new Set([duplicate.sourcePageIndex]),
        usedNames,
      });
    }
  }
}
