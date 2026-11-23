import type Canvas from 'diagram-js/lib/core/Canvas';
import type EventBus from 'diagram-js/lib/core/EventBus';
import type CommandStack from 'diagram-js/lib/command/CommandStack';
import type Selection from 'diagram-js/lib/features/selection/Selection';
import { append as svgAppend, attr as svgAttr, create as svgCreate } from 'tiny-svg';
import { LEVEL_STICKY_KINDS } from '@miragon/event-storming-schema-model';
import type { ShapeLike } from 'diagram-js/lib/model/Types';
import type EventStormingRenderer from '../draw/EventStormingRenderer.js';
import type EventStormingViewOptions from '../view-options/EventStormingViewOptions.js';
import type EventStormingModeling from '../modeling/EventStormingModeling.js';
import type EventStormingElementFactory from '../model/EventStormingElementFactory.js';
import type EventStormingReadOnly from '../read-only/EventStormingReadOnly.js';
import type EventStormingLabelEditing from '../label-editing/EventStormingLabelEditing.js';
import { LABEL_EDITING_CLOSED_EVENT } from '../label-editing/index.js';
import { READ_ONLY_CHANGED_EVENT } from '../read-only/index.js';
import { isEditableTarget } from '../keyboard/index.js';
import {
  FONT,
  GHOST_CHIP,
  GHOST_INK,
  GHOST_LAYER_NAME,
  GHOST_OPACITY,
  STICKY_STYLES,
} from '../draw/styles.js';
import { isSticky, type EventStormingShape, type StickyKind } from '../model/di-types.js';
import { getAllowedNextTypes } from './flowGraph.js';
import { findNextStickyPlacement, type Box } from './nextPlacement.js';
import CreateNextStickyHandler, {
  CREATE_NEXT_STICKY,
  type CreateNextStickyContext,
} from './cmd/CreateNextStickyHandler.js';

/** Above the stickies (layer 0 and up), below the drawing handles (1100). */
const GHOST_LAYER_INDEX = 950;
const CHIP_HEIGHT = 20;
const CHIP_GAP = 8;
const CHIP_CHAR_WIDTH = 7;
const CHIP_PADDING = 16;
const ARROW_HEAD_LENGTH = 10;
const ARROW_HEAD_HALF_WIDTH = 5;

/**
 * Autocomplete for the board: with one sticky selected, a faded ghost of its usual next sticky is
 * drawn to the right, with a dashed arrow. Tab (or Enter) accepts, Up/Down cycle the kinds when
 * several follow, Escape dismisses until the selection changes. The ghost lives on its own canvas
 * layer and never enters the command stack, so it costs no undo step and is not exported.
 */
export default class EventStormingGhostSuggestion {
  static $inject = [
    'eventBus',
    'selection',
    'canvas',
    'commandStack',
    'eventStormingModeling',
    'eventStormingElementFactory',
    'eventStormingViewOptions',
    'eventStormingReadOnly',
    'eventStormingRenderer',
    'eventStormingLabelEditing',
  ];

  private source: EventStormingShape | undefined;
  private offeredKinds: StickyKind[] = [];
  private index = 0;
  private dismissedSourceId: string | undefined;
  /** True from accepting a ghost until its new sticky's label editor closes. */
  private awaitingLabel = false;

  constructor(
    private readonly eventBus: EventBus,
    private readonly selection: Selection,
    private readonly canvas: Canvas,
    private readonly commandStack: CommandStack,
    private readonly modeling: EventStormingModeling,
    private readonly factory: EventStormingElementFactory,
    private readonly viewOptions: EventStormingViewOptions,
    private readonly readOnly: Pick<EventStormingReadOnly, 'isReadOnly'>,
    private readonly renderer: EventStormingRenderer,
    private readonly labelEditing: EventStormingLabelEditing,
  ) {
    commandStack.registerHandler(CREATE_NEXT_STICKY, CreateNextStickyHandler);
    document.addEventListener('keydown', this.onKeydown, true);

    eventBus.on('selection.changed', () => {
      this.dismissedSourceId = undefined;
      this.refresh();
    });
    eventBus.on(
      [
        'commandStack.changed',
        'import.done',
        'diagram.clear',
        'drag.cleanup',
        'create.cleanup',
        READ_ONLY_CHANGED_EVENT,
      ],
      () => this.refresh(),
    );
    eventBus.on(LABEL_EDITING_CLOSED_EVENT, () => {
      this.awaitingLabel = false;
      this.refresh();
    });
    // A drag, a create or an open label editor covers the canvas: no ghost while they run.
    eventBus.on(['drag.init', 'create.start', 'element.dblclick'], () => this.hide());
    eventBus.on('diagram.destroy', () => {
      document.removeEventListener('keydown', this.onKeydown, true);
      this.hide();
    });
  }

  private refresh(): void {
    const candidate = this.candidateSource();
    const kinds = candidate ? this.suggestedKinds(candidate) : [];
    if (!candidate || kinds.length === 0) {
      this.hide();
      return;
    }
    if (candidate !== this.source) this.index = 0;
    this.source = candidate;
    this.offeredKinds = kinds;
    this.index = Math.min(this.index, kinds.length - 1);
    this.draw();
  }

  private candidateSource(): EventStormingShape | undefined {
    if (this.awaitingLabel || this.labelEditing.isEditing()) return undefined;
    if (this.readOnly.isReadOnly() || !this.viewOptions.useRules()) return undefined;
    const selected = this.selection.get();
    if (selected.length !== 1 || !isSticky(selected[0])) return undefined;
    if (selected[0].id === this.dismissedSourceId) return undefined;
    return selected[0];
  }

  private suggestedKinds(source: EventStormingShape): StickyKind[] {
    const allowedAtLevel = LEVEL_STICKY_KINDS[this.modeling.getLevel()];
    return [...getAllowedNextTypes(source.eventStormingType as StickyKind)].filter((kind) =>
      allowedAtLevel.includes(kind),
    );
  }

  private hide(): void {
    this.source = undefined;
    this.offeredKinds = [];
    this.index = 0;
    const layer = this.canvas.getLayer(GHOST_LAYER_NAME, GHOST_LAYER_INDEX);
    while (layer.firstChild) layer.removeChild(layer.firstChild);
  }

  private draw(): void {
    const source = this.source;
    const kind = this.offeredKinds[this.index];
    if (!source || !kind) return;

    const placement = this.placementFor(source, kind);
    if (!placement) return;
    const { topLeft } = placement;
    const style = STICKY_STYLES[kind];

    const layer = this.canvas.getLayer(GHOST_LAYER_NAME, GHOST_LAYER_INDEX);
    while (layer.firstChild) layer.removeChild(layer.firstChild);

    const ghost = svgAttr(svgCreate('g'), { opacity: GHOST_OPACITY, 'pointer-events': 'none' });
    const stickyGroup = svgAttr(svgCreate('g'), {
      transform: `translate(${topLeft.x} ${topLeft.y})`,
    });
    const preview = this.factory.createNew(kind, style.label) as unknown as ShapeLike;
    this.renderer.drawShape(stickyGroup, preview);
    svgAppend(ghost, stickyGroup);
    svgAppend(ghost, this.arrowTo(source, topLeft, style.height));
    svgAppend(layer, ghost);

    svgAppend(layer, this.hintChip(topLeft, style.height));
  }

  private arrowTo(
    source: EventStormingShape,
    topLeft: { x: number; y: number },
    targetHeight: number,
  ): SVGElement {
    const from = { x: source.x + source.width, y: source.y + source.height / 2 };
    const to = { x: topLeft.x, y: topLeft.y + targetHeight / 2 };
    const group = svgCreate('g');
    svgAppend(
      group,
      svgAttr(svgCreate('polyline'), {
        points: `${from.x},${from.y} ${to.x},${to.y}`,
        fill: 'none',
        stroke: GHOST_INK,
        'stroke-width': 1.5,
        'stroke-dasharray': '6 5',
      }),
    );
    svgAppend(
      group,
      svgAttr(svgCreate('polygon'), {
        points: [
          `${to.x},${to.y}`,
          `${to.x - ARROW_HEAD_LENGTH},${to.y - ARROW_HEAD_HALF_WIDTH}`,
          `${to.x - ARROW_HEAD_LENGTH},${to.y + ARROW_HEAD_HALF_WIDTH}`,
        ].join(' '),
        fill: GHOST_INK,
      }),
    );
    return group;
  }

  /** Under the ghost: which key accepts it, and which of the kinds it shows when several follow. */
  private hintChip(topLeft: { x: number; y: number }, targetHeight: number): SVGElement {
    const cycling =
      this.offeredKinds.length > 1 ? `  ↑↓ ${this.index + 1}/${this.offeredKinds.length}` : '';
    const text = `Tab${cycling}`;
    const width = text.length * CHIP_CHAR_WIDTH + CHIP_PADDING;
    const x = topLeft.x;
    const y = topLeft.y + targetHeight + CHIP_GAP;

    const group = svgCreate('g');
    svgAppend(
      group,
      svgAttr(svgCreate('rect'), {
        x,
        y,
        width,
        height: CHIP_HEIGHT,
        rx: 4,
        fill: GHOST_CHIP.fill,
        stroke: GHOST_CHIP.stroke,
        'stroke-width': 1,
      }),
    );
    const caption = svgAttr(svgCreate('text'), {
      x: x + width / 2,
      y: y + CHIP_HEIGHT / 2,
      'text-anchor': 'middle',
      'dominant-baseline': 'central',
      'font-size': 11,
      'font-family': FONT.family,
      fill: GHOST_CHIP.text,
    });
    caption.textContent = text;
    svgAppend(group, caption);
    return group;
  }

  /** Where the next sticky goes and the parent it belongs to, or undefined without a parent. */
  private placementFor(
    source: EventStormingShape,
    kind: StickyKind,
  ):
    | { topLeft: { x: number; y: number }; parent: NonNullable<EventStormingShape['parent']> }
    | undefined {
    const parent = source.parent;
    if (!parent) return undefined;
    const { width, height } = STICKY_STYLES[kind];
    const sourceBox: Box = { x: source.x, y: source.y, width: source.width, height: source.height };
    const children: unknown[] = parent.children;
    const siblings = children.filter(
      (child): child is Box => typeof (child as Partial<Box>).width === 'number',
    );
    return {
      topLeft: findNextStickyPlacement(sourceBox, { width, height }, siblings),
      parent,
    };
  }

  private accept(): void {
    const source = this.source;
    const kind = this.offeredKinds[this.index];
    if (!source || !kind) return;
    const placement = this.placementFor(source, kind);
    if (!placement) return;

    this.hide();
    this.awaitingLabel = true;
    const context: CreateNextStickyContext = {
      source,
      kind,
      topLeft: placement.topLeft,
      parent: placement.parent,
    };
    this.commandStack.execute(CREATE_NEXT_STICKY, context);

    // Deferred like the append flow: the editor positions itself only after the create rendered.
    setTimeout(() => {
      if (context.shape) this.labelEditing.activate(context.shape);
      if (!this.labelEditing.isEditing()) {
        this.awaitingLabel = false;
        this.refresh();
      }
    }, 0);
  }

  private cycle(step: number): void {
    const count = this.offeredKinds.length;
    this.index = (this.index + step + count) % count;
    this.draw();
  }

  private dismiss(): void {
    this.dismissedSourceId = this.source?.id;
    this.hide();
  }

  private onKeydown = (event: KeyboardEvent): void => {
    if (!this.source) return;
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (isEditableTarget(event.target) || isInsideOverlay(event.target)) return;

    const cyclable = this.offeredKinds.length > 1;
    switch (event.key) {
      case 'Tab':
        if (event.shiftKey) return;
        this.accept();
        break;
      case 'Enter':
        this.accept();
        break;
      case 'ArrowDown':
        if (!cyclable) return;
        this.cycle(1);
        break;
      case 'ArrowUp':
        if (!cyclable) return;
        this.cycle(-1);
        break;
      case 'Escape':
        this.dismiss();
        break;
      default:
        return;
    }
    event.preventDefault();
    event.stopPropagation();
  };
}

/**
 * Keys typed into a menu, dialog or list belong to that widget: the ghost must not take Tab or
 * Enter from it, so the browser keeps them there.
 */
function isInsideOverlay(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    target.closest('dialog, [role="dialog"], [role="menu"], [role="listbox"]') !== null
  );
}
