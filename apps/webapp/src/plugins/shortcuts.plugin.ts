import { TEXT_FIELD_SELECTOR } from '@miragon/modeler-shell';
import type { Kernel, Plugin } from '../kernel.js';

export class ShortcutsPlugin implements Plugin {
  readonly id = 'shortcuts';
  private boundAppKey = (e: KeyboardEvent) => this.onAppKey(e);
  private kernel?: Kernel;

  install(kernel: Kernel): void {
    this.kernel = kernel;
    const { shell } = kernel;

    if (typeof (shell as any).config === 'function') {
      (shell as any).config({
        menu: {
          showKeyboardShortcuts: () => {},
        },
      });
    }

    window.addEventListener('keydown', this.boundAppKey);
  }

  destroy(): void {
    window.removeEventListener('keydown', this.boundAppKey);
  }

  private isInTextField(target: EventTarget | null): boolean {
    return target instanceof HTMLElement && (target.matches(TEXT_FIELD_SELECTOR) || target.isContentEditable);
  }

  private modalOpen(): boolean {
    return document.querySelector('dialog:modal') !== null;
  }

  private onAppKey(event: KeyboardEvent): void {
    if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
    if (event.shiftKey) return;
    const key = event.key.toLowerCase();
    if ((key !== 'o' && key !== 's') || event.isComposing) return;
    event.preventDefault();
    if (event.repeat || this.modalOpen()) return;

    if (key === 'o') {
      void this.kernel?.request('document:pickFile');
      return;
    }
    if ((this.kernel?.shell as any).isEmptyStateShown?.()) return;
    const active = document.activeElement;
    if (active instanceof HTMLElement && this.isInTextField(active)) active.blur();
    if (this.kernel) {
      void this.kernel.request('share:exportStorm');
    }
  }
}
