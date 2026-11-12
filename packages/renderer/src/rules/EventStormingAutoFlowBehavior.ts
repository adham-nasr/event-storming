import type EventBus from 'diagram-js/lib/core/EventBus';
import type Selection from 'diagram-js/lib/features/selection/Selection';
import type Modeling from 'diagram-js/lib/features/modeling/Modeling';
import type Rules from 'diagram-js/lib/features/rules/Rules';
import EventStormingViewOptions from '../view-options/EventStormingViewOptions.js';
import { isSticky } from '../model/di-types.js';
import { getAllowedNextTypes } from './flowGraph.js';

export default class EventStormingAutoFlowBehavior {
  static $inject = ['eventBus', 'selection', 'modeling', 'rules', 'eventStormingViewOptions', 'elementFactory'];

  private boundHandler = (event: KeyboardEvent) => this.onKeydown(event);

  constructor(
    private readonly eventBus: EventBus,
    private readonly selection: Selection,
    private readonly modeling: Modeling,
    private readonly rules: Rules,
    private readonly viewOptions: EventStormingViewOptions,
    private readonly elementFactory: any,
  ) {
    window.addEventListener('keydown', this.boundHandler);
  }

  private onKeydown(originalEvent: KeyboardEvent): void {
    if (!this.viewOptions.useRules()) return;
    if (originalEvent.key !== ' ' && originalEvent.code !== 'Space') return;

    const target = originalEvent.target as HTMLElement | null;
    if (target && (target.matches('input, textarea, [contenteditable="true"]') || target.closest('.djs-direct-editing'))) {
      return;
    }

    const selectedElements = this.selection.get();
    if (selectedElements.length !== 1) return;

    const current = selectedElements[0];
    if (!isSticky(current)) return;

    const currentType = (current as any).eventStormingType;
    const nextTypes = getAllowedNextTypes(currentType);
    if (!nextTypes || nextTypes.length === 0) return;

    originalEvent.preventDefault();
    originalEvent.stopPropagation();

    const nextType = nextTypes[0];
    const normalizedNextType = nextType.toLowerCase() === 'domainevent' ? 'event' : nextType.toLowerCase() === 'externalsystem' ? 'external' : nextType.toLowerCase();

    const position = {
      x: current.x + current.width + 80,
      y: current.y
    };

    const shape = this.elementFactory.create('shape', {
      type: 'eventStorming.shape',
      eventStormingType: normalizedNextType,
      eventStormingLabel: nextType,
      width: 100,
      height: 65
    });

    this.modeling.createShape(shape, position, current.parent);

    const canConnect = this.rules.allowed('connection.create', {
      source: current,
      target: shape
    });

    if (canConnect) {
      this.modeling.connect(current, shape, {
        type: 'connection',
        eventStormingType: 'arrow',
      });
    }

    this.selection.select(shape);
  }

  destroy(): void {
    window.removeEventListener('keydown', this.boundHandler);
  }
}
