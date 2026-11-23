// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import EventBus from 'diagram-js/lib/core/EventBus';
import type { BoardLevel } from '@miragon/event-storming-schema-model';
import EventStormingAutoFlowBehavior, {
  NEXT_KIND_POPUP_ID,
} from '../src/rules/EventStormingAutoFlowBehavior.js';
import CreateNextStickyHandler, {
  CREATE_NEXT_STICKY,
} from '../src/rules/cmd/CreateNextStickyHandler.js';
import { FLOW_GRAPH, getAllowedNextTypes } from '../src/rules/flowGraph.js';
import { findNextStickyPlacement } from '../src/rules/nextPlacement.js';
import { STICKY_KINDS } from '../src/model/di-types.js';

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

  const parent = { children: [] as unknown[] };
  let selected: unknown[] = [];
  let popupIsOpen = false;
  let popupProvider: { getPopupMenuEntries: () => Record<string, unknown> } | undefined;

  const selection = { get: () => selected };
  const canvas = {
    getContainer: () => container,
    getAbsoluteBBox: () => ({ x: 0, y: 0, width: 130, height: 90 }),
  };
  const commandStack = { registerHandler: vi.fn(), execute: vi.fn() };
  const popupMenu = {
    registerProvider: vi.fn((_id: string, provider: typeof popupProvider) => {
      popupProvider = provider;
    }),
    open: vi.fn(() => {
      popupIsOpen = true;
    }),
    close: vi.fn(() => {
      popupIsOpen = false;
    }),
    isOpen: () => popupIsOpen,
  };
  const modeling = { getLevel: () => options.level ?? 'design' };
  const viewOptions = { useRules: () => options.useRules ?? true };
  const readOnly = { isReadOnly: () => options.readOnly ?? false };

  const eventBus = new EventBus();
  new EventStormingAutoFlowBehavior(
    eventBus as never,
    selection as never,
    canvas as never,
    commandStack as never,
    popupMenu as never,
    modeling as never,
    viewOptions as never,
    readOnly as never,
  );
  cleanups.push(() => eventBus.fire('diagram.destroy'));

  const sticky = (eventStormingType: string) => ({
    id: `${eventStormingType}_source`,
    eventStormingType,
    eventStormingLabel: eventStormingType,
    x: 0,
    y: 0,
    width: 130,
    height: 90,
    parent,
  });

  return {
    commandStack,
    popupMenu,
    sticky,
    select: (...elements: unknown[]) => {
      selected = elements;
    },
    pressKey: (key: string, target: EventTarget = document.body, init: KeyboardEventInit = {}) => {
      const event = new KeyboardEvent('keydown', {
        key,
        bubbles: true,
        cancelable: true,
        ...init,
      });
      target.dispatchEvent(event);
      return event;
    },
    suggestionKinds: () => Object.keys(popupProvider?.getPopupMenuEntries() ?? {}),
  };
}

function executedKind(commandStack: { execute: ReturnType<typeof vi.fn> }) {
  const call = commandStack.execute.mock.calls.at(-1);
  expect(call?.[0]).toBe(CREATE_NEXT_STICKY);
  return (call?.[1] as { kind: string }).kind;
}

describe('Space suggestion', () => {
  it('creates the only usual successor at once, without a list', () => {
    const { commandStack, popupMenu, sticky, select, pressKey } = harness();
    select(sticky('actor'));
    pressKey(' ');
    expect(executedKind(commandStack)).toBe('command');
    expect(popupMenu.open).not.toHaveBeenCalled();
  });

  it('opens a list when several kinds follow, and the list offers exactly those kinds', () => {
    const { commandStack, popupMenu, sticky, select, pressKey, suggestionKinds } = harness();
    select(sticky('command'));
    pressKey(' ');
    expect(commandStack.execute).not.toHaveBeenCalled();
    expect(popupMenu.open).toHaveBeenCalledWith(
      expect.anything(),
      NEXT_KIND_POPUP_ID,
      expect.objectContaining({ x: expect.any(Number), y: expect.any(Number) }),
    );
    expect(suggestionKinds()).toEqual(['next-aggregate', 'next-external']);
  });

  it('creates the highlighted kind on Enter after Arrow navigation', () => {
    const { commandStack, sticky, select, pressKey } = harness();
    select(sticky('command'));
    pressKey(' ');
    pressKey('ArrowDown');
    pressKey('Enter');
    expect(executedKind(commandStack)).toBe('external');
  });

  it('moves through the list with Tab and Shift+Tab, keeping focus in the app', () => {
    const { commandStack, sticky, select, pressKey } = harness();
    select(sticky('command'));
    pressKey(' ');
    const tab = pressKey('Tab');
    expect(tab.defaultPrevented).toBe(true);
    pressKey('Tab', document.body, { shiftKey: true });
    pressKey('Enter');
    expect(executedKind(commandStack)).toBe('aggregate');
  });

  it('closes the list on Escape without creating anything', () => {
    const { commandStack, popupMenu, sticky, select, pressKey } = harness();
    select(sticky('command'));
    pressKey(' ');
    pressKey('Escape');
    expect(commandStack.execute).not.toHaveBeenCalled();
    expect(popupMenu.close).toHaveBeenCalled();
  });

  it('keeps Arrow keys for the list, so the canvas does not nudge the selection', () => {
    const { sticky, select, pressKey } = harness();
    const canvasKeyboard = vi.fn();
    document.addEventListener('keydown', canvasKeyboard);
    cleanupListener(() => document.removeEventListener('keydown', canvasKeyboard));
    select(sticky('command'));
    pressKey(' ');
    pressKey('ArrowDown');
    expect(canvasKeyboard).not.toHaveBeenCalled();
  });

  it('does nothing for a kind with no usual successor', () => {
    const { commandStack, popupMenu, sticky, select, pressKey } = harness();
    for (const kind of ['readmodel', 'hotspot']) {
      select(sticky(kind));
      pressKey(' ');
    }
    expect(commandStack.execute).not.toHaveBeenCalled();
    expect(popupMenu.open).not.toHaveBeenCalled();
  });

  it('does nothing when the selection is not exactly one sticky', () => {
    const { commandStack, sticky, select, pressKey } = harness();
    select(sticky('command'), sticky('actor'));
    pressKey(' ');
    select({ id: 'note_1', eventStormingType: 'note' });
    pressKey(' ');
    expect(commandStack.execute).not.toHaveBeenCalled();
  });

  it('does nothing under the read-only lock or with rules switched off', () => {
    const locked = harness({ readOnly: true });
    locked.select(locked.sticky('actor'));
    locked.pressKey(' ');
    expect(locked.commandStack.execute).not.toHaveBeenCalled();

    const rulesOff = harness({ useRules: false });
    rulesOff.select(rulesOff.sticky('actor'));
    rulesOff.pressKey(' ');
    expect(rulesOff.commandStack.execute).not.toHaveBeenCalled();
  });

  it('offers only the kinds the workshop level allows', () => {
    const { commandStack, sticky, select, pressKey } = harness({ level: 'big-picture' });
    select(sticky('command'));
    pressKey(' ');
    expect(executedKind(commandStack)).toBe('external');
  });

  it('still suggests when a shell button has focus, and keeps the press from clicking it', () => {
    const { commandStack, sticky, select, pressKey } = harness();
    const button = document.createElement('button');
    document.body.append(button);
    select(sticky('actor'));
    const space = pressKey(' ', button);
    expect(executedKind(commandStack)).toBe('command');
    expect(space.defaultPrevented).toBe(true);
  });

  it('ignores Space typed into an editable field', () => {
    const { commandStack, sticky, select, pressKey } = harness();
    const input = document.createElement('input');
    document.body.append(input);
    select(sticky('actor'));
    pressKey(' ', input);
    expect(commandStack.execute).not.toHaveBeenCalled();
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
    ).toEqual({ x: 195, y: 0 });
  });

  it('steps down past taken spots instead of stacking on them', () => {
    const source = { x: 0, y: 0, width: 130, height: 90 };
    const size = { width: 130, height: 90 };
    const first = { x: 195, y: 0, width: 130, height: 90 };
    expect(findNextStickyPlacement(source, size, [first])).toEqual({ x: 195, y: 120 });
    const second = { x: 195, y: 120, width: 130, height: 90 };
    expect(findNextStickyPlacement(source, size, [first, second])).toEqual({ x: 195, y: 240 });
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

    handler.execute({
      source,
      kind: 'command',
      topLeft: { x: 10, y: 20 },
      parent: source.parent,
    } as never);

    expect(factory.createNew).toHaveBeenCalledWith('command', 'Command');
    expect(modeling.createShape).toHaveBeenCalledWith(shape, { x: 75, y: 65 }, source.parent);
    expect(modeling.connect).toHaveBeenCalledWith(source, shape, {
      type: 'connection',
      eventStormingType: 'arrow',
    });
    expect(selection.select).toHaveBeenCalledWith(shape);
  });
});

function cleanupListener(cleanup: () => void) {
  cleanups.push(cleanup);
}
