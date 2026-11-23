import { importWarningText, type ImportWarning } from '@miragon/event-storming-renderer';
import { formatNumber } from '@miragon/modeler-shell';
import { importWarningsText, problemItems } from '../problems.js';
import type { Kernel, Plugin } from '../kernel.js';

interface DiagramElement {
  id: string;
  parent?: unknown;
  waypoints?: unknown;
}
interface ElementRegistryLike {
  get(id: string): DiagramElement | undefined;
}
interface SelectionLike {
  select(elements: DiagramElement | null): void;
}
interface CanvasLike {
  scrollToElement(element: DiagramElement): void;
}

export class ProblemsPlugin implements Plugin {
  readonly id = 'problems';

  install(kernel: Kernel): void {
    const { shell, modeler } = kernel;
    const registry = modeler.get<ElementRegistryLike>('elementRegistry');
    const selection = modeler.get<SelectionLike>('selection');
    const canvas = modeler.get<CanvasLike>('canvas');

    if (typeof (shell as any).config === 'function') {
      (shell as any).config({
        problems: {
          onSelectItem: (item: any) => {
            const element = item.elementId ? registry.get(item.elementId) : undefined;
            if (!element) return;
            selection.select(element);
            canvas.scrollToElement(element);
          },
        },
      });
    }
  }

  report(kernel: Kernel, warnings: readonly ImportWarning[], announce: boolean): void {
    const { shell, modeler } = kernel;
    const registry = modeler.get<ElementRegistryLike>('elementRegistry');
    const items = problemItems(warnings, (id) => registry.get(id) !== undefined);
    
    shell.setProblems(shell.problemSummary?.(items) ?? { total: items.length, errors: 0, warnings: items.length });
    for (const warning of warnings) {
      console.warn(`[event-storming-import] ${importWarningText(warning)}`);
    }
    if (!announce || items.length === 0) return;
    const pill = shell.messages.problems(items.length, formatNumber(items.length, shell.lang));
    shell.toast({ status: 'warning', text: importWarningsText(items.length, pill) });
  }
}
