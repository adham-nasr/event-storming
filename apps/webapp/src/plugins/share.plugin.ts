import { boardFileName, type DownloadKind } from '../file-names.js';
import { svgToPng, downloadBlob, downloadText } from '../io.js';
import { copyTextWhenReady } from '../clipboard.js';
import { shareUrl, writeHashMap, readHashMap } from '../share.js';
import type { Kernel, Plugin } from '../kernel.js';
import { commandKeyLabel, defaultMessages, detectPlatform } from '@miragon/modeler-shell';

export class SharePlugin implements Plugin {
  readonly id = 'share';
  private urlTimer?: ReturnType<typeof setTimeout>;
  private ignoreHashChange = false;
  private kernel?: Kernel;

  install(kernel: Kernel): void {
    this.kernel = kernel;
    const { shell, modeler } = kernel;
    const saveKey = commandKeyLabel('S', detectPlatform(navigator), defaultMessages.keyNames);

    kernel.registerHandler('share:shareLink', () => {
      this.share(modeler, shell);
    });
    kernel.registerHandler('share:exportStorm', () => {
      this.exportBoardText(modeler, shell, 'storm');
    });
    kernel.registerHandler('share:exportJson', () => {
      this.exportBoardText(modeler, shell, 'json');
    });
    kernel.registerHandler('share:exportPicture', (kind: 'png' | 'png-transparent' | 'svg') => {
      void this.exportPicture(modeler, shell, kind);
    });

    if (typeof (shell as any).config === 'function') {
      (shell as any).config({
        primary: { onSelect: () => this.share(modeler, shell) },
        menu: {
          exports: {
            png: { onSelect: () => void this.exportPicture(modeler, shell, 'png') },
            svg: { onSelect: () => void this.exportPicture(modeler, shell, 'svg') },
            transparentPng: { onSelect: () => void this.exportPicture(modeler, shell, 'png-transparent') },
            json: { onSelect: () => void this.exportBoardText(modeler, shell, 'json') },
            storm: { shortcut: saveKey, onSelect: () => void this.exportBoardText(modeler, shell, 'storm') },
          },
        },
      });
    }

    modeler.on('import.done', () => this.onModelChanged(modeler));
    modeler.on<{ trigger?: string }>('commandStack.changed', (event) => {
      if (event.trigger !== 'clear') {
        shell.setEmptyState?.(false);
      }
      shell.menu?.refresh?.();
      this.onModelChanged(modeler);
    });

    window.addEventListener('hashchange', this.onHashChange);
    window.addEventListener('beforeunload', () => this.flushUrl(modeler));
    window.addEventListener('pagehide', () => this.flushUrl(modeler));
  }

  destroy(): void {
    clearTimeout(this.urlTimer);
    window.removeEventListener('hashchange', this.onHashChange);
    window.removeEventListener('beforeunload', () => {});
    window.removeEventListener('pagehide', () => {});
  }

  private boardIsEmpty(modeler: any): boolean {
    const board = modeler.exportMap();
    return board.elements.length === 0 && board.edges.length === 0;
  }

  private syncUrlNow(modeler: any): void {
    clearTimeout(this.urlTimer);
    this.urlTimer = undefined;
    if (this.boardIsEmpty(modeler)) history.replaceState(null, '', location.pathname + location.search);
    else {
      this.ignoreHashChange = true;
      void writeHashMap(modeler.exportDSL()).finally(() => {
        this.ignoreHashChange = false;
      });
    }
  }

  private onModelChanged(modeler: any, debounce = false): void {
    clearTimeout(this.urlTimer);
    if (debounce) this.urlTimer = setTimeout(() => this.syncUrlNow(modeler), 350);
    else this.syncUrlNow(modeler);
  }

  private flushUrl = (modeler: any): void => {
    if (this.urlTimer !== undefined) {
      this.syncUrlNow(modeler);
    }
  };

  private onHashChange = async (): Promise<void> => {
    if (this.ignoreHashChange) return;
    const linked = await readHashMap();
    if (linked !== null && this.kernel) {
      await this.kernel.request('document:openDSL', linked);
    }
  };

  private share(modeler: any, shell: any): void {
    const dsl = modeler.exportDSL();
    const copied = copyTextWhenReady(shareUrl(dsl));
    void (async () => {
      try {
        await writeHashMap(dsl);
        await copied;
        shell.toast({ status: 'success', text: 'Link copied' });
      } catch (error) {
        console.error('[event-storming-share]', error);
        shell.toast({ status: 'danger', text: "Couldn't copy the link. Copy it from the address bar instead." });
      }
    })();
  }

  async exportPicture(modeler: any, shell: any, kind: Extract<DownloadKind, 'png' | 'png-transparent' | 'svg'>): Promise<void> {
    const title = modeler.exportMap().config.title;
    const fileName = boardFileName(title, kind);
    try {
      const selected = modeler.get('selection').get();
      modeler.get('selection').select(null);
      let svg: string;
      try {
        const res = await modeler.saveSVG();
        svg = res.svg;
      } finally {
        if (selected.length > 0) modeler.get('selection').select(selected);
      }

      if (kind === 'svg') downloadText(svg, fileName, 'image/svg+xml');
      else {
        const options = kind === 'png' ? {} : { scale: 4, transparent: true };
        downloadBlob(await svgToPng(svg, options), fileName);
      }
      shell.toast({ status: 'success', text: `Exported ${fileName}.` });
    } catch (error) {
      console.error('[event-storming-export]', error);
      shell.toast({ status: 'danger', text: "Couldn't export the board. Try again." });
    }
  }

  exportBoardText(modeler: any, shell: any, kind: Extract<DownloadKind, 'json' | 'storm'>): void {
    const title = modeler.exportMap().config.title;
    const fileName = boardFileName(title, kind);
    try {
      if (kind === 'json') {
        downloadText(JSON.stringify(modeler.exportMap(), null, 2), fileName, 'application/json');
      } else {
        downloadText(modeler.exportDSL(), fileName, 'text/plain;charset=utf-8');
      }
      shell.toast({ status: 'success', text: `Exported ${fileName}.` });
    } catch (error) {
      console.error('[event-storming-export]', error);
      shell.toast({ status: 'danger', text: `Couldn't export ${fileName}. Try again.` });
    }
  }
}
