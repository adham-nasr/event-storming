export const FLOW_GRAPH: Record<string, readonly string[]> = {
  'actor': ['command'],
  'command': ['aggregate', 'external'],
  'aggregate': ['event'],
  'event': ['readmodel', 'policy'],
  'readmodel': ['ui'],
  'ui': [],
  'policy': ['command'],
  'external': ['event'],
};

export function getAllowedNextTypes(elementType: string): readonly string[] {
  if (!elementType) return [];
  const normalized = elementType.toLowerCase();
  return FLOW_GRAPH[normalized] ?? [];
}
