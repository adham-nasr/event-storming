// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import EventBus from 'diagram-js/lib/core/EventBus';
import type { BoardLevel } from '@miragon/event-storming-schema-model';
import EventStormingGhostSuggestion from '../src/rules/EventStormingGhostSuggestion.js';
import CreateNextStickyHandler, {
  CREATE_NEXT_STICKY,
} from '../src/rules/cmd/CreateNextStickyHandler.js';
import { FLOW_GRAPH, getAllowedNextTypes } from '../src/rules/flowGraph.js';
import { findNextStickyPlacement } from '../src/rules/nextPlacement.js';
import { STICKY_KINDS } from '../src/model/di-types.js';
import { LABEL_EDITING_CLOSED_EVENT } from '../src/label-editing/index.js';

const cleanups: Array<() => void> = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  document.body.innerHTML = '';
});

interface HarnessOptions {
  level?: BoardLevel;
  readOnly?: boolean;
  useRules?: boolean;
}

function harness(options: HarnessOptions = {}) {
  const container = document.createElement('div');
  document.body.append(container);

  const layer = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  const parent = { children: [] as unknown[] };
  let selected: unknown[] = [];
  let editing = false;

  const eventBus = new EventBus();
  const selection = {
    get: () => selected,
    select: vi.fn((element: unknown) => {
      selected = [element];
    }),
  };
  const canvas = {
    getContainer: () => container,
    getLayer: vi.fn(() => layer),
    getAbsoluteBBox: () => ({ x: 0, y: 0, width: 130, height: 90 }),
  };
  const commandStack = { registerHandler: vi.fn(), execute: vi.fn() };
  const modeling = { getLevel: () => options.level ?? 'design' };
  const factory = { createNew: vi.fn((kind: string, label: string) => ({ kind, label })) };
  const viewOptions = { useRules: () => options.useRules ?? true };
  const readOnly = { isReadOnly: () => options.readOnly ?? false };
  const renderer = { drawShape: vi.fn() };
  const labelEditing = {
    activate: vi.fn(),
    isEditing: () => editing,
  };

  new EventStormingGhostSuggestion(
    eventBus as never,
    selection as never,
    canvas as never,
    commandStack as never,
    modeling as never,
    factory as never,
    viewOptions as never,
    readOnly as never,
    renderer as never,
    labelEditing as never,
  );
  cleanups.push(() => eventBus.fire('diagram.destroy'));

  const sticky = (eventStormingType: string, id = `${eventStormingType}_source`) => ({
    id,
    eventStormingType,
    eventStormingLabel: eventStormingType,
    x: 0,
    y: 0,
    width: 130,
    height: 90,
    parent,
  });

  const select = (...elements: unknown[]) => {
    selected = elements;
    eventBus.fire('selection.changed', { newSelection: elements });
  };

  const pressKey = (
    key: string,
    init: KeyboardEventInit = {},
    target: EventTarget = document.body,
  ) => {
    const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
    target.dispatchEvent(event);
    return event;
  };

  return {
    eventBus,
    layer,
    commandStack,
    labelEditing,
    renderer,
    sticky,
    select,
    pressKey,
    setEditing: (value: boolean) => {
      editing = value;
    },
    ghostVisible: () => layer.childElementCount > 0,
    hintText: () => layer.querySelector('text')?.textContent ?? '',
    executedKind: () => {
      const call = commandStack.execute.mock.calls.at(-1);
      expect(call?.[0]).toBe(CREATE_NEXT_STICKY);
      return (call?.[1] as { kind: string }).kind;
    },
  };
}

describe('ghost suggestion', () => {
  it('shows the usual next sticky for one selected sticky', () => {
    const { select, sticky, ghostVisible, renderer } = harness();
    select(sticky('actor'));
    expect(ghostVisible()).toBe(true);
    expect(renderer.drawShape).toHaveBeenCalledTimes(1);
  });

  it('stays hidden for read-only boards, switched-off rules and kinds without a successor', () => {
    const locked = harness({ readOnly: true });
    locked.select(locked.sticky('actor'));
    expect(locked.ghostVisible()).toBe(false);

    const rulesOff = harness({ useRules: false });
    rulesOff.select(rulesOff.sticky('actor'));
    expect(rulesOff.ghostVisible()).toBe(false);

    const terminal = harness();
    terminal.select(terminal.sticky('readmodel'));
    expect(terminal.ghostVisible()).toBe(false);
  });

  it('stays hidden for multi-select and for notes', () => {
    const { select, sticky, ghostVisible } = harness();
    select(sticky('actor'), sticky('command'));
    expect(ghostVisible()).toBe(false);
    select({ id: 'note_1', eventStormingType: 'note' });
    expect(ghostVisible()).toBe(false);
  });

  it('stays hidden while a label editor is open', () => {
    const { select, sticky, ghostVisible, setEditing } = harness();
    setEditing(true);
    select(sticky('actor'));
    expect(ghostVisible()).toBe(false);
  });

  it('offers only the kinds the workshop level allows', () => {
    const { select, sticky, hintText } = harness({ level: 'big-picture' });
    select(sticky('command'));
    expect(hintText()).toBe('Tab');
  });

  it('shows the cycle position when several kinds follow', () => {
    const { select, sticky, hintText } = harness();
    select(sticky('command'));
    expect(hintText()).toBe('Tab  ↑↓ 1/2');
  });

  it('Tab accepts: creates the first kind and opens its label editor', async () => {
    const { select, sticky, pressKey, executedKind, labelEditing, commandStack } = harness();
    select(sticky('actor'));
    const tab = pressKey('Tab');
    expect(tab.defaultPrevented).toBe(true);
    expect(executedKind()).toBe('command');
    expect(commandStack.execute).toHaveBeenCalledTimes(1);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(labelEditing.activate).toHaveBeenCalledTimes(1);
  });

  it('Enter accepts the same way', () => {
    const { select, sticky, pressKey, executedKind } = harness();
    select(sticky('actor'));
    pressKey('Enter');
    expect(executedKind()).toBe('command');
  });

  it('Up and Down cycle through the kinds and wrap', () => {
    const { select, sticky, pressKey, hintText, executedKind } = harness();
    select(sticky('command'));
    pressKey('ArrowDown');
    expect(hintText()).toBe('Tab  ↑↓ 2/2');
    pressKey('ArrowDown');
    expect(hintText()).toBe('Tab  ↑↓ 1/2');
    pressKey('ArrowUp');
    expect(hintText()).toBe('Tab  ↑↓ 2/2');
    pressKey('Tab');
    expect(executedKind()).toBe('external');
  });

  it('Arrow keys pass through to the canvas when there is only one kind', () => {
    const { select, sticky, pressKey } = harness();
    select(sticky('actor'));
    expect(pressKey('ArrowDown').defaultPrevented).toBe(false);
  });

  it('Escape dismisses until the selection changes', () => {
    const { select, sticky, pressKey, ghostVisible, eventBus } = harness();
    const actor = sticky('actor');
    select(actor);
    pressKey('Escape');
    expect(ghostVisible()).toBe(false);
    eventBus.fire('commandStack.changed', {});
    expect(ghostVisible()).toBe(false);
    select();
    select(actor);
    expect(ghostVisible()).toBe(true);
  });

  it('Shift+Tab and other keys are not consumed', () => {
    const { select, sticky, pressKey, commandStack } = harness();
    select(sticky('actor'));
    expect(pressKey('Tab', { shiftKey: true }).defaultPrevented).toBe(false);
    expect(pressKey('a').defaultPrevented).toBe(false);
    expect(commandStack.execute).not.toHaveBeenCalled();
  });

  it('keys typed into an editable field are not consumed', () => {
    const { select, sticky, pressKey, commandStack } = harness();
    const input = document.createElement('input');
    document.body.append(input);
    select(sticky('actor'));
    expect(pressKey('Tab', {}, input).defaultPrevented).toBe(false);
    expect(commandStack.execute).not.toHaveBeenCalled();
  });

  it('reappears for the new sticky once its label editor closes', () => {
    const { select, sticky, pressKey, labelEditing, eventBus, ghostVisible } = harness();
    select(sticky('actor'));
    pressKey('Tab');
    expect(ghostVisible()).toBe(false);
    const created = sticky('command', 'cmd_new');
    select(created);
    expect(ghostVisible()).toBe(false);
    labelEditing.isEditing = () => false;
    eventBus.fire(LABEL_EDITING_CLOSED_EVENT, { element: created });
    expect(ghostVisible()).toBe(true);
  });

  it('draws into the ghost layer and never touches the command stack', () => {
    const { select, sticky, ghostVisible, commandStack, layer } = harness();
    select(sticky('actor'));
    expect(ghostVisible()).toBe(true);
    expect(commandStack.execute).not.toHaveBeenCalled();
    expect(layer.querySelector('polyline')).not.toBeNull();
  });
});

describe('suggestion placement', () => {
  it('places the next sticky to the right of the source', () => {
    expect(
      findNextStickyPlacement(
        { x: 0, y: 0, width: 130, height: 90 },
        { width: 130, height: 90 },
        [],
      ),
    ).toEqual({ x: 250, y: 0 });
  });

  it('steps down past taken spots instead of stacking on them', () => {
    const source = { x: 0, y: 0, width: 130, height: 90 };
    const size = { width: 130, height: 90 };
    const first = { x: 250, y: 0, width: 130, height: 90 };
    expect(findNextStickyPlacement(source, size, [first])).toEqual({ x: 250, y: 120 });
    const second = { x: 250, y: 120, width: 130, height: 90 };
    expect(findNextStickyPlacement(source, size, [first, second])).toEqual({ x: 250, y: 240 });
  });
});

describe('flow graph', () => {
  it('has an entry for every sticky kind, and only sticky kinds as successors', () => {
    expect(Object.keys(FLOW_GRAPH).sort()).toEqual([...STICKY_KINDS].sort());
    for (const successors of Object.values(FLOW_GRAPH)) {
      for (const kind of successors) expect(STICKY_KINDS).toContain(kind);
    }
  });

  it('lists the usual successors', () => {
    expect(getAllowedNextTypes('command')).toEqual(['aggregate', 'external']);
    expect(getAllowedNextTypes('event')).toEqual(['readmodel', 'policy']);
    expect(getAllowedNextTypes('hotspot')).toEqual([]);
  });
});

describe('CreateNextStickyHandler', () => {
  it('creates the sticky centered on the target spot and connects it with an arrow', () => {
    const shape = { id: 'cmd_new' };
    const factory = { createNew: vi.fn(() => shape) };
    const modeling = { createShape: vi.fn(), connect: vi.fn() };
    const selection = { select: vi.fn() };
    const handler = new CreateNextStickyHandler(
      factory as never,
      modeling as never,
      selection as never,
    );
    const source = { id: 'event_src', parent: { id: 'root' } };
    const context = {
      source,
      kind: 'command',
      topLeft: { x: 10, y: 20 },
      parent: source.parent,
    } as never;

    handler.preExecute(context);
    handler.execute(context);

    expect(factory.createNew).toHaveBeenCalledWith('command', 'Command');
    expect(modeling.createShape).toHaveBeenCalledWith(shape, { x: 75, y: 65 }, source.parent);
    expect(modeling.connect).toHaveBeenCalledWith(source, shape, {
      type: 'connection',
      eventStormingType: 'arrow',
    });
    expect(selection.select).toHaveBeenCalledWith(shape);
  });
});
