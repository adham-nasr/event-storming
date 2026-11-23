import type CommandHandler from 'diagram-js/lib/command/CommandHandler';
import type Modeling from 'diagram-js/lib/features/modeling/Modeling';
import type Selection from 'diagram-js/lib/features/selection/Selection';
import type { Parent } from 'diagram-js/lib/model/Types';
import type EventStormingElementFactory from '../../model/EventStormingElementFactory.js';
import type { EventStormingShape, StickyKind } from '../../model/di-types.js';
import { STICKY_STYLES } from '../../draw/styles.js';

export const CREATE_NEXT_STICKY = 'eventStorming.createNextSticky';

export interface CreateNextStickyContext {
  source: EventStormingShape;
  kind: StickyKind;
  topLeft: { x: number; y: number };
  parent: Parent;
  /** Set in preExecute; redo reuses the same shape so the arrow keeps pointing at it. */
  shape?: EventStormingShape;
}

/**
 * Creates the suggested sticky and its arrow from the source. diagram-js only allows nested
 * commands in preExecute/postExecute, so both are created there; a single undo then removes the
 * arrow together with the sticky.
 */
export default class CreateNextStickyHandler implements CommandHandler {
  static $inject = ['eventStormingElementFactory', 'modeling', 'selection'];

  constructor(
    private readonly factory: EventStormingElementFactory,
    private readonly modeling: Modeling,
    private readonly selection: Selection,
  ) {}

  preExecute(context: CreateNextStickyContext): void {
    const { source, kind, topLeft, parent } = context;
    const { width, height } = STICKY_STYLES[kind];
    const shape = context.shape ?? this.factory.createNew(kind, STICKY_STYLES[kind].label);
    const center = { x: topLeft.x + width / 2, y: topLeft.y + height / 2 };
    this.modeling.createShape(shape, center, parent);
    this.modeling.connect(source, shape, { type: 'connection', eventStormingType: 'arrow' });
    context.shape = shape;
  }

  execute(context: CreateNextStickyContext): EventStormingShape[] {
    if (!context.shape) return [];
    this.selection.select(context.shape);
    return [context.shape];
  }
}
