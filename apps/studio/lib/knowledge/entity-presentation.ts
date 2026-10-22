/** Controlled visual vocabulary. Symbols retain compatibility with imported Playground documents;
 * rendering always uses the application's Font Awesome Pro glyphs, never emoji or model SVG. */
export const entityIcons = [
  { id: 'entity', label: 'Entity', symbol: '📦' },
  { id: 'person', label: 'Person', symbol: '👤' },
  { id: 'organization', label: 'Organization', symbol: '🏢' },
  { id: 'document', label: 'Document', symbol: '📋' },
  { id: 'order', label: 'Order', symbol: '🛒' },
  { id: 'payment', label: 'Payment', symbol: '💳' },
  { id: 'invoice', label: 'Invoice', symbol: '🧾' },
  { id: 'shipment', label: 'Shipment', symbol: '🚚' },
  { id: 'product', label: 'Product', symbol: '🏷️' },
  { id: 'location', label: 'Location', symbol: '🌐' },
  { id: 'collection', label: 'Collection', symbol: '📁' },
  { id: 'data', label: 'Data', symbol: '📊' },
  { id: 'metric', label: 'Metric', symbol: '📈' },
  { id: 'event', label: 'Event', symbol: '⚡' },
  { id: 'goal', label: 'Goal', symbol: '🎯' },
  { id: 'note', label: 'Note', symbol: '📝' },
  { id: 'relationship', label: 'Relationship', symbol: '🔗' },
  { id: 'service', label: 'Service', symbol: '🔧' },
  { id: 'coffee', label: 'Coffee', symbol: '☕' },
] as const;
const rules: [string, RegExp][] = [
  ['person', /\b(person|people|user|customer|student|teacher|employee|patient|member|contact|staff|agent)s?\b/i],
  [
    'organization',
    /\b(organization|organisation|company|bank|department|school|hospital|store|branch|supplier|vendor)s?\b/i,
  ],
  ['invoice', /\b(invoice|receipt|bill)s?\b/i],
  ['payment', /\b(payment|transaction|account|card|wallet)s?\b/i],
  ['shipment', /\b(shipment|delivery|vehicle|truck|transport)s?\b/i],
  ['order', /\b(order|purchase|cart)s?\b/i],
  ['product', /\b(product|item|asset|inventory)s?\b/i],
  ['document', /\b(document|contract|policy|report|form|application)s?\b/i],
  ['location', /\b(location|address|country|region|site|city|place)s?\b/i],
  ['event', /\b(event|notification|alert)s?\b/i],
  ['metric', /\b(metric|measure|indicator|score)s?\b/i],
  ['coffee', /\b(coffee|bean|beverage)s?\b/i],
  ['data', /\b(dataset|database|record)s?\b/i],
  ['service', /\b(service|system|integration)s?\b/i],
];
export function entityIconFor(name: string, description = ''): string {
  const spaced = name.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]/g, ' ');
  const match =
    rules.find(([, pattern]) => pattern.test(spaced)) ?? rules.find(([, pattern]) => pattern.test(description));
  return entityIcons.find((icon) => icon.id === match?.[0])?.symbol ?? '📦';
}
export function normalizeEntityIcon(icon: string | undefined, name: string, description = '') {
  return icon && icon !== '📦' && entityIcons.some((entry) => entry.symbol === icon)
    ? icon
    : entityIconFor(name, description);
}
