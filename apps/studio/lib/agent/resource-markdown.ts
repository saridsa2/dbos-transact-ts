import type { Root } from 'hast';
import { agentResourceHref, type AgentResource } from './resource-links';
type HtmlNode = {
  type: string;
  tagName?: string;
  value?: string;
  properties?: Record<string, unknown>;
  children?: HtmlNode[];
};
const text = (value: string): HtmlNode => ({ type: 'text', value });
const word = (value: string) => /[\p{L}\p{N}_]/u.test(value);
/** Link verified resource names in prose, never inside existing links or fenced code blocks. */
export function resourceMarkdown(resources: readonly AgentResource[]) {
  const byName = new Map<string, AgentResource[]>();
  for (const ref of resources) {
    const key = ref.name.toLowerCase();
    const values = byName.get(key) ?? [];
    if (!values.some((v) => v.kind === ref.kind && v.id === ref.id)) values.push(ref);
    byName.set(key, values);
  }
  const names = [...byName.keys()]
    .sort((a, b) => b.length - a.length)
    .map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const pattern = names.length ? new RegExp(names.join('|'), 'giu') : null;
  function linked(value: string): HtmlNode[] {
    if (!pattern) return [text(value)];
    pattern.lastIndex = 0;
    const out: HtmlNode[] = [];
    let previous = 0;
    for (const match of value.matchAll(pattern)) {
      const start = match.index!,
        end = start + match[0].length;
      if (
        (start > 0 && word(value[start - 1]) && word(match[0][0])) ||
        (end < value.length && word(value[end]) && word(match[0].at(-1)!))
      )
        continue;
      out.push(text(value.slice(previous, start)));
      const refs = byName.get(match[0].toLowerCase())!;
      const link = (ref: AgentResource, label: string, index?: number): HtmlNode => ({
        type: 'element',
        tagName: 'a',
        properties: {
          href: agentResourceHref(ref),
          'data-resource-kind': ref.kind,
          'aria-label': `Open ${ref.name}${index !== undefined ? ` (${index + 1} of ${refs.length})` : ''}`,
        },
        children: [text(label)],
      });
      if (refs.length === 1) out.push(link(refs[0], match[0]));
      else {
        out.push(text(match[0] + ' '));
        refs.forEach((ref, i) => {
          out.push(link(ref, `[${i + 1}]`, i));
          if (i < refs.length - 1) out.push(text(' '));
        });
      }
      previous = end;
    }
    out.push(text(value.slice(previous)));
    return out;
  }
  function visit(node: HtmlNode) {
    if (!node.children || ['a', 'pre', 'script', 'style'].includes(node.tagName ?? '')) return;
    node.children = node.children.flatMap((child) => {
      if (child.type === 'text') return linked(child.value ?? '');
      if (child.type === 'element') {
        visit(child);
        if (child.tagName === 'code' && child.children?.some((c) => c.tagName === 'a')) {
          child.tagName = 'span';
          child.properties = {};
        }
      }
      return [child];
    });
  }
  return () => (tree: Root) => {
    visit(tree as unknown as HtmlNode);
  };
}
