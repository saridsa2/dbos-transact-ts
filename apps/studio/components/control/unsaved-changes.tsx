'use client';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Heading } from 'react-aria-components';
import { useRouter } from 'next/navigation';
import { ControlButton, ControlModal } from './controls';

type Guard = { register: (key: symbol, dirty: boolean) => void; run: (action: () => void) => void };
const UnsavedContext = createContext<Guard | null>(null);

/** Shared navigation policy; the dialog composes the installed Untitled UI modal and buttons. */
export function UnsavedChangesProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const dirtyEditors = useRef(new Set<symbol>());
  const [pending, setPending] = useState<(() => void) | null>(null);
  const register = useCallback((key: symbol, dirty: boolean) => {
    if (dirty) dirtyEditors.current.add(key);
    else dirtyEditors.current.delete(key);
  }, []);
  const run = useCallback((action: () => void) => {
    if (dirtyEditors.current.size) setPending(() => action);
    else action();
  }, []);
  useEffect(() => {
    // Full document unload dialogs are browser-owned and cannot use custom HTML.
    const unload = (event: BeforeUnloadEvent) => {
      if (dirtyEditors.current.size) event.preventDefault();
    };
    const click = (event: MouseEvent) => {
      if (
        !dirtyEditors.current.size ||
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      )
        return;
      const link = event.target instanceof Element ? event.target.closest('a[href]') : null;
      if (!(link instanceof HTMLAnchorElement) || link.target === '_blank' || link.hasAttribute('download')) return;
      const next = new URL(link.href, location.href);
      if (next.href === location.href || (next.pathname === location.pathname && next.search === location.search))
        return;
      event.preventDefault();
      event.stopPropagation();
      run(() => {
        if (next.origin === location.origin) router.push(next.pathname + next.search + next.hash);
        else location.assign(next.href);
      });
    };
    window.addEventListener('beforeunload', unload);
    document.addEventListener('click', click, true);
    return () => {
      window.removeEventListener('beforeunload', unload);
      document.removeEventListener('click', click, true);
    };
  }, [router, run]);
  return (
    <UnsavedContext.Provider value={{ register, run }}>
      {children}
      {pending && (
        <ControlModal label="Discard unsaved changes?" onClose={() => setPending(null)}>
          <div className="cp-modal">
            <header className="sp-dialog-header">
              <Heading slot="title">Discard unsaved changes?</Heading>
              <p>Your latest edits have not been saved. Stay here to save them, or discard them and leave.</p>
            </header>
            <footer className="cp-actions">
              <ControlButton autoFocus onPress={() => setPending(null)}>
                Keep editing
              </ControlButton>
              <ControlButton
                className="cp-primary"
                onPress={() => {
                  const action = pending;
                  dirtyEditors.current.clear();
                  setPending(null);
                  action();
                }}
              >
                Discard and leave
              </ControlButton>
            </footer>
          </div>
        </ControlModal>
      )}
    </UnsavedContext.Provider>
  );
}
export function useUnsavedNavigation() {
  const guard = useContext(UnsavedContext);
  if (!guard) throw new Error('UnsavedChangesProvider is unavailable.');
  return guard.run;
}
export function useUnsavedChanges(dirty: boolean) {
  const guard = useContext(UnsavedContext);
  const key = useRef(Symbol('editor'));
  if (!guard) throw new Error('UnsavedChangesProvider is unavailable.');
  const register = guard.register;
  useEffect(() => {
    register(key.current, dirty);
    return () => register(key.current, false);
  }, [dirty, register]);
  return guard.run;
}
