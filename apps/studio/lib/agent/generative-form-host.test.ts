// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement, act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { DecisionInbox } from '../../vendor/aisdkagents/decision-inbox';
import { GenerativeForm, type GenerativeFormField } from '../../vendor/aisdkagents/generative-form';
let root: Root, container: HTMLDivElement;
beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  window.matchMedia = vi.fn().mockImplementation(() => ({
    matches: false,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() {
      return true;
    },
  }));
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
describe('licensed form host adaptations', () => {
  it('retains a selected evidence checkbox while its resource is filtered out', async () => {
    const submitted = vi.fn();
    const fields: GenerativeFormField[] = [
      { name: 'source_a', label: 'Source A', type: 'boolean' },
      { name: 'source_b', label: 'Source B', type: 'boolean' },
    ];
    await act(async () =>
      root.render(
        createElement(GenerativeForm, { fields, object: { source_a: false, source_b: false }, onSubmit: submitted }),
      ),
    );
    await act(async () => {
      (container.querySelector('input[type=checkbox]') as HTMLInputElement).click();
    });
    await act(async () =>
      root.render(
        createElement(GenerativeForm, {
          fields: [{ ...fields[0], hidden: true }, fields[1]],
          object: { source_a: false, source_b: false },
          onSubmit: submitted,
        }),
      ),
    );
    await act(async () => {
      (container.querySelector('button[type=submit]') as HTMLButtonElement).click();
    });
    expect(submitted).toHaveBeenCalledWith({ source_a: true, source_b: false });
  });
  it('only presents a structured-result schema in structured response mode', async () => {
    const fields: GenerativeFormField[] = [
      { name: 'mode', type: 'select', options: ['interactive', 'structured_output'] },
      {
        name: 'schema',
        label: 'Result schema',
        type: 'longtext',
        visibleWhen: { name: 'mode', value: 'structured_output' },
      },
    ];
    await act(async () =>
      root.render(createElement(GenerativeForm, { fields, object: { mode: 'interactive', schema: '{}' } })),
    );
    expect(container.querySelector('textarea')).toBeNull();
    await act(async () =>
      root.render(createElement(GenerativeForm, { fields, object: { mode: 'structured_output', schema: '{}' } })),
    );
    expect(container.querySelector('textarea')?.value).toBe('{}');
  });
});

describe('licensed suggestion review decisions', () => {
  const item = { id: 'suggestion-1', title: 'Inspect the organization ontology', agent: 'Ontology reviewer' };
  it('requires an explicit approval action before starting an assignment', async () => {
    const decide = vi.fn();
    await act(async () =>
      root.render(
        createElement(DecisionInbox, {
          items: [item],
          onDecide: decide,
          shortcuts: false,
          approveLabel: 'Accept and start activity',
        }),
      ),
    );
    expect(decide).not.toHaveBeenCalled();
    await act(async () => {
      (container.querySelector('[data-slot=decision-inbox-approve]') as HTMLButtonElement).click();
    });
    expect(decide).toHaveBeenCalledWith(item, { approved: true, reason: undefined });
  });
  it('keeps the suggestion available when its server decision fails', async () => {
    const decide = vi.fn().mockRejectedValue(new Error('The saved suggestion changed.'));
    await act(async () =>
      root.render(createElement(DecisionInbox, { items: [item], onDecide: decide, shortcuts: false })),
    );
    await act(async () => {
      (container.querySelector('[data-slot=decision-inbox-approve]') as HTMLButtonElement).click();
    });
    expect(container.textContent).toContain(item.title);
    expect(container.textContent).toContain('That did not send. Try again.');
    expect((container.querySelector('[data-slot=decision-inbox-approve]') as HTMLButtonElement).disabled).toBe(false);
  });
});
