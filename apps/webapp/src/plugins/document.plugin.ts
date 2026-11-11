import { createEmptyBoard } from '@miragon/event-storming-schema-model';
import type { ToastHandle } from '@miragon/modeler-shell';
import { EXAMPLE_BOARD } from '../example.js';
import { readBoardFile, importBoardFile } from '../io.js';
import { openErrorText } from '../open-error.js';
import type { Kernel, Plugin } from '../kernel.js';
import { ProblemsPlugin } from './problems.plugin.js';
import type { ImportWarning } from '@miragon/event-storming-renderer';

const APP_NAME = 'Event Storming Modeler';
const NEW_BOARD_TITLE = 'New board';
const BOARD_FILE_TYPES = ['.storm', '.json', '.txt', 'application/json', 'text/plain'];

export class DocumentPlugin implements Plugin {
  readonly id = 'document';
  private replaceUndo?: { readonly toast: ToastHandle; run(): void };
  private fileInput?: HTMLInputElement;

  install(kernel: Kernel): void {
    const { shell, modeler } = kernel;

    kernel.registerHandler('document:pickFile', () => this.pickFile());
    kernel.registerHandler('document:openDSL', async (dsl: string) => {
      await this.openDocument(kernel, async () => (await modeler.importDSL(dsl)).warnings, true);
    });

    this.fileInput = document.createElement('input');
    this.fileInput.type = 'file';
    this.fileInput.accept = BOARD_FILE_TYPES.join(',');
    this.fileInput.hidden = true;
    document.body.append(this.fileInput);
    this.fileInput.addEventListener('change', () => {
      const file = this.fileInput?.files?.[0];
      if (this.fileInput) this.fileInput.value = '';
      if (file) void this.openBoardFile(kernel, file);
    });

    if (typeof (shell as any).config === 'function') {
      (shell as any).config({
        menu: {
          newBoard: { onSelect: () => void this.newBoard(kernel, true) },
          openFile: { onSelect: () => this.pickFile() },
        },
        emptyState: {
          onNewBoard: () => void this.newBoard(kernel, false),
          onOpenFile: () => this.pickFile(),
          onInsertExample: () => void this.insertExample(kernel),
        },
      });
    }

    modeler.on('element.changed', () => this.updateDocumentTitle(shell, modeler));
    modeler.on('commandStack.changed', () => this.updateDocumentTitle(shell, modeler));
  }

  destroy(): void {
    this.fileInput?.remove();
    this.replaceUndo?.toast.dismiss();
  }

  pickFile(): void {
    this.fileInput?.click();
  }

  async openDocument(
    kernel: Kernel,
    importAction: () => Promise<ImportWarning[]>,
    announceWarnings: boolean,
  ): Promise<void> {
    const { shell, modeler } = kernel;
    shell.setEmptyState?.(false);
    this.replaceUndo?.toast.dismiss();
    this.replaceUndo = undefined;

    const warnings = await importAction();
    modeler.get<any>('viewport').afterImport();
    shell.menu?.refresh?.();
    this.updateDocumentTitle(shell, modeler);

    if (warnings.length > 0) {
      const problemsPlugin = (kernel as any).plugins?.get('problems') as ProblemsPlugin | undefined;
      problemsPlugin?.report(kernel, warnings, announceWarnings);
    }
  }

  async openBoardFile(kernel: Kernel, file: File): Promise<void> {
    const { shell, modeler } = kernel;
    const previousDsl = modeler.exportDSL();
    const previousMap = modeler.exportMap();
    try {
      const boardFile = await readBoardFile(file);
      await this.openDocument(
        kernel,
        async () => importBoardFile(boardFile, modeler),
        true,
      );
      shell.toast({ status: 'success', text: `Opened “${file.name}”.` });

      const undo = this.replaceUndo;
      this.replaceUndo = {
        toast: shell.toast({
          status: 'info',
          text: `Opened “${file.name}”.`,
          action: {
            label: 'Revert',
            onSelect: async () => {
              undo?.toast.dismiss();
              this.replaceUndo = undefined;
              if (boardFile.kind === 'board') await modeler.importMap(previousMap);
              else await modeler.importDSL(previousDsl);
              modeler.get<any>('viewport').afterImport();
              shell.menu?.refresh?.();
              this.updateDocumentTitle(shell, modeler);
              shell.toast({ status: 'info', text: 'Reverted to previous board.' });
            },
          },
        }),
      };
    } catch (error) {
      console.error('[event-storming-open]', error);
      shell.toast({ status: 'danger', text: openErrorText(file.name, error) });
    }
  }

  async newBoard(kernel: Kernel, confirmIfDirty: boolean): Promise<void> {
    const { shell, modeler } = kernel;
    if (confirmIfDirty && !this.boardIsEmpty(modeler)) {
      // Simple confirmation or reset
    }
    await modeler.importMap(createEmptyBoard(NEW_BOARD_TITLE));
    modeler.get<any>('viewport').afterImport();
    shell.setEmptyState?.(true);
    shell.menu?.refresh?.();
    this.updateDocumentTitle(shell, modeler);
  }

  async insertExample(kernel: Kernel): Promise<void> {
    const { shell, modeler } = kernel;
    await modeler.importDSL(EXAMPLE_BOARD);
    modeler.get<any>('viewport').afterImport();
    shell.setEmptyState?.(false);
    shell.menu?.refresh?.();
    this.updateDocumentTitle(shell, modeler);
  }

  private boardIsEmpty(modeler: any): boolean {
    const board = modeler.exportMap();
    return board.elements.length === 0 && board.edges.length === 0;
  }

  private updateDocumentTitle(shell: any, modeler: any): void {
    const title = modeler.exportMap().config.title?.trim();
    const docTitle = title && title.toLowerCase() !== 'new board' ? `${title} – ${APP_NAME}` : APP_NAME;
    document.title = docTitle;
    if (typeof shell.setSubheading === 'function') {
      shell.setSubheading(title || NEW_BOARD_TITLE);
    }
  }
}
