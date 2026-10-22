import { describe, expect, it } from 'vitest';
import { remarkToolReferences } from './tool-references';
import { builtinToolDescriptions, builtinToolHref } from './tool-catalog';
import { toolNames } from './contracts';

describe('tool references', () => {
  it('links exact tool names in prose and inline code while retaining punctuation', () => {
    const tree = {
      type: 'root',
      children: [
        {
          type: 'paragraph',
          children: [
            { type: 'text', value: 'Use artifact_read_v1, then ' },
            { type: 'inlineCode', value: 'ask_user_v2' },
            { type: 'text', value: '. Unknown fake_tool_v1 stays text.' },
          ],
        },
      ],
    };
    remarkToolReferences()(tree);
    expect(tree.children[0].children).toEqual([
      { type: 'text', value: 'Use ' },
      {
        type: 'link',
        url: '/tools?capability=artifact_read_v1',
        children: [{ type: 'text', value: 'artifact_read_v1' }],
      },
      { type: 'text', value: ', then ' },
      { type: 'link', url: '/tools?capability=ask_user_v2', children: [{ type: 'text', value: 'ask_user_v2' }] },
      { type: 'text', value: '. Unknown fake_tool_v1 stays text.' },
    ]);
  });
  it('does not rewrite code blocks, existing links or partial identifiers', () => {
    const tree = {
      type: 'root',
      children: [
        { type: 'code', value: 'artifact_read_v1' },
        { type: 'link', url: 'https://example.com', children: [{ type: 'text', value: 'artifact_read_v1' }] },
        { type: 'text', value: 'artifact_read_v1_suffix fake_tool_v1' },
      ],
    };
    const before = structuredClone(tree);
    remarkToolReferences()(tree);
    expect(tree).toEqual(before);
  });
  it('provides inspection destinations for the canonical built-in registry only', () => {
    for (const name of toolNames) {
      expect(builtinToolDescriptions[name]).toBeTruthy();
      expect(builtinToolHref(name)).toBe(`/tools?capability=${name}`);
    }
    expect(builtinToolHref('toString')).toBeUndefined();
    expect(builtinToolHref('missing_v1')).toBeUndefined();
  });
});
