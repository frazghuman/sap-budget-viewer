import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

/**
 * `[value]` on a <select> is applied before `@for` has created the options, so
 * the browser has nothing to select and falls back to the first entry. Every
 * select in this app whose options are generated must therefore mark the
 * chosen <option> itself. These two components pin that behaviour down.
 */

@Component({
  standalone: true,
  template: `
    <select [value]="chosen()">
      @for (o of options; track o.id) {
        <option [value]="o.id">{{ o.name }}</option>
      }
    </select>
  `,
})
class ValueOnlyComponent {
  readonly options = [
    { id: 'r-admin', name: 'Budget Admin' },
    { id: 'r-viewer', name: 'Budget Viewer' },
  ];
  readonly chosen = signal('r-viewer');
}

@Component({
  standalone: true,
  template: `
    <select [value]="chosen()">
      @for (o of options; track o.id) {
        <option [value]="o.id" [selected]="o.id === chosen()">{{ o.name }}</option>
      }
    </select>
  `,
})
class SelectedOnOptionComponent {
  readonly options = [
    { id: 'r-admin', name: 'Budget Admin' },
    { id: 'r-viewer', name: 'Budget Viewer' },
  ];
  readonly chosen = signal('r-viewer');
}

function renderedValue<T>(type: new () => T): string {
  const fixture = TestBed.createComponent(type);
  fixture.detectChanges();
  return (fixture.nativeElement.querySelector('select') as HTMLSelectElement).value;
}

describe('select bound to generated options', () => {
  it('shows the wrong option with [value] alone — the bug this guards against', () => {
    // Documents the failure: asked for the viewer role, the browser shows admin.
    expect(renderedValue(ValueOnlyComponent)).toBe('r-admin');
  });

  it('shows the chosen option when the option marks itself selected', () => {
    expect(renderedValue(SelectedOnOptionComponent)).toBe('r-viewer');
  });
});
