import type { StickyKind } from '../model/di-types.js';

/**
 * Usual successors per sticky kind. Feeds the Space suggestion only: manual arrows stay
 * unrestricted, because real boards also link event to event, and hotspots sit outside the flow.
 */
export const FLOW_GRAPH: Readonly<Record<StickyKind, readonly StickyKind[]>> = {
  actor: ['command'],
  command: ['aggregate', 'external'],
  aggregate: ['event'],
  event: ['readmodel', 'policy'],
  readmodel: [],
  policy: ['command'],
  external: ['event'],
  hotspot: [],
};

export function getAllowedNextTypes(kind: StickyKind): readonly StickyKind[] {
  return FLOW_GRAPH[kind];
}
