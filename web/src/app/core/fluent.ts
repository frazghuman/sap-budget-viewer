/**
 * Fluent 2 web component registration. Each `define.js` entry point registers
 * its element against `FluentDesignSystem.registry` on import, so this module
 * must be imported once, before bootstrap.
 */
import '@fluentui/web-components/badge.js';
import '@fluentui/web-components/button.js';
import '@fluentui/web-components/divider.js';
import '@fluentui/web-components/dropdown.js';
import '@fluentui/web-components/field.js';
import '@fluentui/web-components/label.js';
import '@fluentui/web-components/listbox.js';
import '@fluentui/web-components/message-bar.js';
import '@fluentui/web-components/option.js';
import '@fluentui/web-components/progress-bar.js';
import '@fluentui/web-components/spinner.js';
import '@fluentui/web-components/switch.js';
import '@fluentui/web-components/text-input.js';
import '@fluentui/web-components/tooltip.js';

export function registerFluentComponents(): void {
  /* Registration happens through the side-effect imports above; calling this
     from main.ts keeps the import from being tree-shaken. */
}
