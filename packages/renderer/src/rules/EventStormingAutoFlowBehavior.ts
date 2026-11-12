import type EventBus from 'diagram-js/lib/core/EventBus';
import type ElementRegistry from 'diagram-js/lib/core/ElementRegistry';
import type Canvas from 'diagram-js/lib/core/Canvas';
import type Modeling from 'diagram-js/lib/features/modeling/Modeling';
import type Rules from 'diagram-js/lib/features/rules/Rules';
import EventStormingViewOptions from '../view-options/EventStormingViewOptions.js';
import { getAllowedNextTypes } from './flowGraph.js';

export default class EventStormingAutoFlowBehavior {
  static $inject = ['eventBus', 'elementRegistry', 'canvas', 'modeling', 'rules', 'eventStormingViewOptions'];

  constructor(
    private readonly eventBus: EventBus,
    private readonly elementRegistry: ElementRegistry,
    private readonly canvas: Canvas,
    private readonly modeling: Modeling,
    private readonly rules: Rules,
    private readonly viewOptions: EventStormingViewOptions,
  ) {
    this.eventBus.on('commandStack.shape.create.executed', (event: any) => {
      if (!this.viewOptions.useRules()) return;
      // Auto-flow logic can be safely hooked here using rules and modeling
    });
  }
}
