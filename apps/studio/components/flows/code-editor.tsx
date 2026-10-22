'use client';
import { json } from '@codemirror/lang-json';
import { expressionAst } from '@/lib/authoring/expressions';
import { useEffect, useRef } from 'react';
import { EditorView, lineNumbers, highlightActiveLine, keymap } from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import { javascript } from '@codemirror/lang-javascript';
import { autocompletion } from '@codemirror/autocomplete';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { syntaxHighlighting, defaultHighlightStyle, syntaxTree } from '@codemirror/language';
import { linter, lintGutter } from '@codemirror/lint';
export function CodeEditor({
  value,
  onChange,
  language,
  readOnly = false,
  expression = false,
  ariaLabel = 'Code source',
  completions = [],
  completionsOnly = false,
}: {
  value: string;
  onChange: (value: string) => void;
  language: 'javascript' | 'typescript' | 'json' | 'text';
  completionsOnly?: boolean;
  readOnly?: boolean;
  expression?: boolean;
  ariaLabel?: string;
  completions?: { label: string; displayLabel?: string; info?: string }[];
}) {
  const element = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const options = useRef(completions);
  options.current = completions;
  const callback = useRef(onChange);
  callback.current = onChange;
  useEffect(() => {
    if (!element.current) return;
    const editor = new EditorView({
      parent: element.current,
      state: EditorState.create({
        doc: value,
        extensions: [
          lineNumbers(),
          highlightActiveLine(),
          history(),
          keymap.of([...defaultKeymap, ...historyKeymap]),
          language === 'text'
            ? []
            : language === 'json'
              ? json()
              : javascript({ typescript: language === 'typescript' }),
          syntaxHighlighting(defaultHighlightStyle),
          EditorState.readOnly.of(readOnly),
          EditorView.editable.of(!readOnly),
          EditorView.contentAttributes.of({ 'aria-label': ariaLabel }),
          autocompletion({
            override: [
              (ctx) => {
                const word = ctx.matchBefore(/[$\w.\[\]"\'-]*/);
                if (!word || (!word.text && !ctx.explicit)) return null;
                return {
                  from: word.from,
                  options:
                    expression || completionsOnly
                      ? options.current
                      : [
                          ...options.current,
                          { label: 'input', type: 'variable', info: 'Configured JSON input' },
                          {
                            label: 'variables',
                            type: 'variable',
                            info: 'Visible scope values; guest changes do not update workflow state',
                          },
                          { label: 'console.log', type: 'function' },
                          { label: 'console.warn', type: 'function' },
                          { label: 'return', type: 'keyword' },
                        ],
                };
              },
            ],
          }),
          lintGutter(),
          linter((v) => {
            if (language === 'text') return [];
            const issues: { from: number; to: number; severity: 'error'; message: string }[] = [];
            if (expression) {
              try {
                expressionAst(v.state.doc.toString());
                return [];
              } catch (err) {
                return [
                  {
                    from: 0,
                    to: v.state.doc.length,
                    severity: 'error' as const,
                    message: err instanceof Error ? err.message : 'Invalid expression',
                  },
                ];
              }
            }
            syntaxTree(v.state).iterate({
              enter: (n) => {
                if (n.type.isError)
                  issues.push({
                    from: n.from,
                    to: Math.max(n.from, n.to),
                    severity: 'error',
                    message: 'Check source syntax here.',
                  });
              },
            });
            return issues;
          }),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) callback.current(update.state.doc.toString());
          }),
        ],
      }),
    });
    view.current = editor;
    return () => {
      editor.destroy();
      view.current = null;
    };
  }, [language, readOnly, expression, ariaLabel, completionsOnly]);
  useEffect(() => {
    const editor = view.current;
    if (editor && editor.state.doc.toString() !== value)
      editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: value } });
  }, [value]);
  return <div className={`nc-code-editor${expression ? ' nc-expression-editor' : ''}`} ref={element} />;
}
