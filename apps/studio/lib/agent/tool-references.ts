import { builtinToolHref } from './tool-catalog';

type Node = { type: string; value?: string; url?: string; children?: Node[] };

/** Turn exact registered names into links, leaving existing links and code blocks untouched. */
export function remarkToolReferences() {
  return (tree: Node) => {
    function visit(parent: Node) {
      if (!parent.children || ['link', 'linkReference', 'code', 'html'].includes(parent.type)) return;
      parent.children = parent.children.flatMap((node): Node[] => {
        if (node.type === 'inlineCode') {
          const href = builtinToolHref(node.value ?? '');
          return href ? [{ type: 'link', url: href, children: [{ type: 'text', value: node.value }] }] : [node];
        }
        if (node.type !== 'text') {
          visit(node);
          return [node];
        }
        const value = node.value ?? '';
        const result: Node[] = [];
        let offset = 0;
        for (const match of value.matchAll(/\b[a-z][a-z0-9_]*_v\d+\b/g)) {
          const href = builtinToolHref(match[0]);
          if (!href) continue;
          if (match.index! > offset) result.push({ type: 'text', value: value.slice(offset, match.index) });
          result.push({ type: 'link', url: href, children: [{ type: 'text', value: match[0] }] });
          offset = match.index! + match[0].length;
        }
        if (offset < value.length) result.push({ type: 'text', value: value.slice(offset) });
        return result.length ? result : [node];
      });
    }
    visit(tree);
  };
}
