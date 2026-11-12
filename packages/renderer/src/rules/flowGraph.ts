export const FLOW_GRAPH: Record<string, readonly string[]> = {
  'event-storming.domain-event': ['event-storming.command', 'event-storming.read-model'],
  'event-storming.command': ['event-storming.domain-event'],
  'event-storming.aggregate': ['event-storming.domain-event'],
};

export function getAllowedNextTypes(elementType: string): readonly string[] {
  return FLOW_GRAPH[elementType] ?? [];
}
