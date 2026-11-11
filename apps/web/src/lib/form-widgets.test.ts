import { describe, expect, it } from 'vitest';
import { isFormWidgetChecked } from './form-widgets';

describe('form widget display state', () => {
  it('uses the document boolean to show the selected radio before it is edited', () => {
    expect(isFormWidgetChecked({ type: 'radio', option: 'red' }, true)).toBe(true);
    expect(isFormWidgetChecked({ type: 'radio', option: 'blue' }, false)).toBe(false);
  });

  it('uses the overlay option string after the user changes the radio group', () => {
    expect(isFormWidgetChecked({ type: 'radio', option: 'blue' }, 'blue')).toBe(true);
    expect(isFormWidgetChecked({ type: 'radio', option: 'red' }, 'blue')).toBe(false);
  });

  it('keeps checkbox and text-ish values boolean', () => {
    expect(isFormWidgetChecked({ type: 'checkbox' }, true)).toBe(true);
    expect(isFormWidgetChecked({ type: 'checkbox' }, false)).toBe(false);
    expect(isFormWidgetChecked({ type: 'checkbox' }, undefined)).toBe(false);
  });
});
