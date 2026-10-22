'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  Group,
  Panel,
  Separator,
  useDefaultLayout,
  usePanelRef,
  type PanelImperativeHandle,
} from 'react-resizable-panels';
import { Button } from '@/components/base/buttons/button';
import { Tooltip } from '@/components/base/tooltip/tooltip';
import { Minus, ExpandIcon } from '@/components/fa-icons';

// Local layout preferences never change a tool draft or its published revision.
const storage = {
  getItem(key: string) {
    try {
      const value = typeof window === 'undefined' ? null : window.localStorage.getItem(key);
      if (value) JSON.parse(value);
      return value;
    } catch {
      return null;
    }
  },
  setItem(key: string, value: string) {
    try {
      window.localStorage.setItem(key, value);
    } catch {
      /* Layout still works without storage. */
    }
  },
};
const horizontalIds = ['tool-files', 'tool-code'];
const verticalIds = ['tool-source', 'tool-results'];

/** Shared state lets the task header control panels without a second editor toolbar. */
export function useToolEditorPanels(testing: boolean) {
  const filesRef = usePanelRef(),
    resultsRef = usePanelRef();
  const [visible, setVisible] = useState({ files: true, results: true });
  const focusRequest = useRef<'files' | 'results' | null>(null);
  const [animating, setAnimating] = useState<'files' | 'results' | null>(null);
  const animationTimer = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (animationTimer.current) window.clearTimeout(animationTimer.current);
    },
    [],
  );
  useEffect(() => {
    if (animating) return;
    const name = focusRequest.current;
    if (!name) return;
    const button = Array.from(
      document.querySelectorAll<HTMLButtonElement>(`#tool-${name} button[data-panel-control="${name}"]`),
    ).find((el) => !el.closest('[hidden]'));
    if (button) {
      button.focus();
      focusRequest.current = null;
    }
  }, [visible, animating]);
  useEffect(() => {
    if (testing) resultsRef.current?.expand();
  }, [testing, resultsRef]);
  function toggle(name: 'files' | 'results', panel: PanelImperativeHandle | null) {
    if (!panel) return;
    focusRequest.current = name;
    if (animationTimer.current) window.clearTimeout(animationTimer.current);
    if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setAnimating(name);
      animationTimer.current = window.setTimeout(() => setAnimating(null), 240);
    }
    if (!panel.isCollapsed()) {
      panel.collapse();
      return;
    }
    panel.expand();
  }
  return { filesRef, resultsRef, visible, setVisible, animating, toggle };
}
type EditorPanels = ReturnType<typeof useToolEditorPanels>;
export function ToolPanelToggle({
  panels,
  name,
  restore = false,
}: {
  panels: EditorPanels;
  name: 'files' | 'results';
  restore?: boolean;
}) {
  const ref = name === 'files' ? panels.filesRef : panels.resultsRef;
  const label = `${restore ? 'Restore' : 'Minimize'} ${name} panel`;
  return (
    <Tooltip title={label}>
      <Button
        color="tertiary"
        size="sm"
        iconLeading={restore ? ExpandIcon : Minus}
        isDisabled={!!panels.animating}
        aria-label={label}
        aria-expanded={!restore}
        aria-controls={`tool-${name}`}
        data-panel-control={name}
        className="tool-panel-icon"
        onPress={() => {
          panels.toggle(name, ref.current);
        }}
      />
    </Tooltip>
  );
}

/** Library-managed splitters; feature state and CodeMirror stay with the tool. */
export function ToolEditorLayout({
  files,
  source,
  results,
  panels,
}: {
  files: ReactNode;
  source: ReactNode;
  results: ReactNode;
  panels: EditorPanels;
}) {
  const { filesRef, resultsRef, visible, setVisible, animating } = panels;
  const horizontal = useDefaultLayout({ id: 'stackproc-tool-editor-columns-v4', panelIds: horizontalIds, storage });
  const vertical = useDefaultLayout({ id: 'stackproc-tool-editor-rows-v2', panelIds: verticalIds, storage });
  useEffect(() => {
    const media = window.matchMedia('(max-width: 760px)');
    const change = () => {
      if (media.matches) {
        filesRef.current?.collapse();
      }
    };
    change();
    media.addEventListener('change', change);
    return () => media.removeEventListener('change', change);
  }, [filesRef]);
  return (
    <div className="tool-editor-frame" data-animating={!!animating}>
      <Group
        className="tool-panels"
        id="tool-columns"
        orientation="horizontal"
        defaultLayout={horizontal.defaultLayout}
        onLayoutChanged={horizontal.onLayoutChanged}
      >
        <Panel
          id="tool-files"
          panelRef={filesRef}
          defaultSize="17%"
          minSize={140}
          maxSize="35%"
          collapsible
          collapsedSize={36}
          onResize={(size) => setVisible((v) => ({ ...v, files: size.inPixels > 36.5 }))}
        >
          {!visible.files && animating !== 'files' && (
            <div className="tool-collapsed-rail">
              <ToolPanelToggle panels={panels} name="files" restore />
            </div>
          )}
          <div className="tool-panel-content" hidden={!visible.files && animating !== 'files'} inert={!visible.files}>
            {files}
          </div>
        </Panel>
        <Separator className="tool-splitter tool-splitter-column" aria-label="Resize files panel" />
        <Panel id="tool-code" defaultSize="83%" minSize="30%">
          <Group
            className="tool-source-panels"
            id="tool-rows"
            orientation="vertical"
            defaultLayout={vertical.defaultLayout}
            onLayoutChanged={vertical.onLayoutChanged}
          >
            <Panel id="tool-source" minSize={100} className="tool-source">
              {source}
            </Panel>
            <Separator className="tool-splitter tool-splitter-row" aria-label="Resize results panel" />
            <Panel
              id="tool-results"
              panelRef={resultsRef}
              defaultSize="30%"
              minSize={110}
              collapsible
              collapsedSize={36}
              onResize={(size) => setVisible((v) => ({ ...v, results: size.inPixels > 36.5 }))}
            >
              {!visible.results && animating !== 'results' && (
                <div className="tool-collapsed-results">
                  <span>Results</span>
                  <ToolPanelToggle panels={panels} name="results" restore />
                </div>
              )}
              <div
                className="tool-panel-content"
                hidden={!visible.results && animating !== 'results'}
                inert={!visible.results}
              >
                {results}
              </div>
            </Panel>
          </Group>
        </Panel>
      </Group>
    </div>
  );
}
