import type Canvas from 'diagram-js/lib/core/Canvas';
import type EventBus from 'diagram-js/lib/core/EventBus';
import type CommandStack from 'diagram-js/lib/command/CommandStack';
import type PopupMenu from 'diagram-js/lib/features/popup-menu/PopupMenu';
import type { PopupMenuEntries } from 'diagram-js/lib/features/popup-menu/PopupMenuProvider';
import type Selection from 'diagram-js/lib/features/selection/Selection';
import { LEVEL_STICKY_KINDS } from '@miragon/event-storming-schema-model';
import type EventStormingViewOptions from '../view-options/EventStormingViewOptions.js';
import type EventStormingModeling from '../modeling/EventStormingModeling.js';
import type EventStormingReadOnly from '../read-only/EventStormingReadOnly.js';
import { STICKY_STYLES } from '../draw/styles.js';
import { kindSquare } from '../draw/palette-icons.js';
import { isEditableTarget } from '../keyboard/index.js';
import { isSticky, type EventStormingShape, type StickyKind } from '../model/di-types.js';
import { getAllowedNextTypes } from './flowGraph.js';
import { findNextStickyPlacement, type Box } from './nextPlacement.js';
import CreateNextStickyHandler, {
  CREATE_NEXT_STICKY,
  type CreateNextStickyContext,
} from './cmd/CreateNextStickyHandler.js';

export const NEXT_KIND_POPUP_ID = 'event-storming-next-kind';

/** Gap (px) between the selected sticky's bottom edge and the suggestion list. */
const CHOOSER_GAP = 6;

/**
 * Space must not create a sticky while a menu, dialog or list has the keys. Focus may sit on a
 * shell button after a click, which is fine: the press then suggests instead of activating it.
 */
function isInsideOverlay(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    target.closest('dialog, [role="dialog"], [role="menu"], [role="listbox"]') !== null
  );
}

/**
 * Space on a selected sticky suggests the usual next kind. One valid kind is created at once;
 * several open a small list next to the sticky (Arrow keys, Enter, Escape or a click). The
 * suggestion list only exists while it is open, so Space never races a list it cannot see.
 */
export default class EventStormingAutoFlowBehavior {
  static $inject = [
    'eventBus',
    'selection',
    'canvas',
    'commandStack',
    'popupMenu',
    'eventStormingModeling',
    'eventStormingViewOptions',
    'eventStormingReadOnly',
  ];

  private offeredKinds: StickyKind[] = [];
  private offeringSource: EventStormingShape | undefined;
  private highlightedIndex = 0;

  constructor(
    eventBus: EventBus,
    private readonly selection: Selection,
    private readonly canvas: Canvas,
    private readonly commandStack: CommandStack,
    private readonly popupMenu: PopupMenu,
    private readonly modeling: EventStormingModeling,
    private readonly viewOptions: EventStormingViewOptions,
    private readonly readOnly: Pick<EventStormingReadOnly, 'isReadOnly'>,
  ) {
    commandStack.registerHandler(CREATE_NEXT_STICKY, CreateNextStickyHandler);
    popupMenu.registerProvider(NEXT_KIND_POPUP_ID, {
      getPopupMenuEntries: () => this.suggestionEntries(),
    });

    document.addEventListener('keydown', this.onKeydown, true);
    eventBus.on('diagram.destroy', () => {
      document.removeEventListener('keydown', this.onKeydown, true);
    });
  }

  private onKeydown = (event: KeyboardEvent): void => {
    if (this.isChooserOpen()) {
      this.handleChooserKey(event);
      return;
    }
    if (event.key !== ' ' && event.code !== 'Space') return;
    if (event.repeat) return;
    if (!this.viewOptions.useRules() || this.readOnly.isReadOnly()) return;
    if (isEditableTarget(event.target) || isInsideOverlay(event.target)) return;

    const selected = this.selection.get();
    if (selected.length !== 1 || !isSticky(selected[0])) return;

    const source = selected[0];
    const kinds = this.suggestedKinds(source);
    if (kinds.length === 0) return;

    event.preventDefault();
    event.stopPropagation();

    if (kinds.length === 1) {
      this.createNext(source, kinds[0]!);
      return;
    }
    this.openChooser(source, kinds);
  };

  private suggestedKinds(source: EventStormingShape): StickyKind[] {
    const allowedAtLevel = LEVEL_STICKY_KINDS[this.modeling.getLevel()];
    return [...getAllowedNextTypes(source.eventStormingType as StickyKind)].filter((kind) =>
      allowedAtLevel.includes(kind),
    );
  }

  private openChooser(source: EventStormingShape, kinds: StickyKind[]): void {
    this.offeringSource = source;
    this.offeredKinds = kinds;
    this.highlightedIndex = 0;

    const bounds = this.canvas.getAbsoluteBBox(source);
    const container = this.canvas.getContainer().getBoundingClientRect();
    this.popupMenu.open(source, NEXT_KIND_POPUP_ID, {
      x: container.left + bounds.x,
      y: container.top + bounds.y + bounds.height + CHOOSER_GAP,
    });
    if (!this.popupMenu.isOpen()) {
      this.resetChooser();
      return;
    }
    this.paintHighlight();
  }

  private isChooserOpen(): boolean {
    return this.offeringSource !== undefined && this.popupMenu.isOpen();
  }

  private handleChooserKey(event: KeyboardEvent): void {
    switch (event.key) {
      case 'ArrowDown':
        this.moveHighlight(1);
        break;
      case 'ArrowUp':
        this.moveHighlight(-1);
        break;
      case 'Tab':
        this.moveHighlight(event.shiftKey ? -1 : 1);
        break;
      case 'Enter':
        this.chooseHighlighted();
        break;
      case 'Escape':
        this.closeChooser();
        break;
      default:
        return;
    }
    // Keeps the canvas keyboard (arrow nudge of the selection) from reacting to list navigation.
    event.preventDefault();
    event.stopPropagation();
  }

  private moveHighlight(step: number): void {
    const count = this.offeredKinds.length;
    this.highlightedIndex = (this.highlightedIndex + step + count) % count;
    this.paintHighlight();
  }

  private chooseHighlighted(): void {
    const source = this.offeringSource;
    const kind = this.offeredKinds[this.highlightedIndex];
    this.closeChooser();
    if (source && kind) this.createNext(source, kind);
  }

  private closeChooser(): void {
    this.popupMenu.close();
    this.resetChooser();
  }

  private resetChooser(): void {
    this.offeringSource = undefined;
    this.offeredKinds = [];
    this.highlightedIndex = 0;
  }

  private suggestionEntries(): PopupMenuEntries {
    const entries: PopupMenuEntries = {};
    for (const kind of this.offeredKinds) {
      const style = STICKY_STYLES[kind];
      entries[`next-${kind}`] = {
        label: style.label,
        imageHtml: kindSquare(style.fill, style.stroke),
        action: () => {
          const source = this.offeringSource;
          this.closeChooser();
          if (source) this.createNext(source, kind);
        },
      };
    }
    return entries;
  }

  private paintHighlight(): void {
    const rendered = document.querySelectorAll<HTMLElement>(
      `[data-popup="${NEXT_KIND_POPUP_ID}"] .entry`,
    );
    rendered.forEach((entry, index) => {
      entry.classList.toggle('selected', index === this.highlightedIndex);
    });
  }

  private createNext(source: EventStormingShape, kind: StickyKind): void {
    const { width, height } = STICKY_STYLES[kind];
    const sourceBox: Box = {
      x: source.x,
      y: source.y,
      width: source.width,
      height: source.height,
    };
    const parent = source.parent;
    if (!parent) return;
    const children: unknown[] = parent.children;
    const siblings = children.filter(
      (child): child is Box => typeof (child as Partial<Box>).width === 'number',
    );
    const topLeft = findNextStickyPlacement(sourceBox, { width, height }, siblings);

    const context: CreateNextStickyContext = { source, kind, topLeft, parent };
    this.commandStack.execute(CREATE_NEXT_STICKY, context);
  }
}
