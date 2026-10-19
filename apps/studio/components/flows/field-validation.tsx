'use client';
import { createContext, useContext, useId, useEffect, useRef, type ReactNode } from 'react';
export const FieldIssues = createContext<string[]>([]);
export function useFieldIssues(path: string) {
  return useContext(FieldIssues).filter(
    (issue) =>
      issue.startsWith(path + ':') ||
      issue.startsWith(path + '.') ||
      issue.startsWith(path.replace('config.operation.', 'config.parameters.') + ':') ||
      issue.startsWith(path.replace('config.operation.', 'config.parameters.') + '.'),
  );
}
export function ErrorMark() {
  return (
    <span className="nc-error-mark" aria-hidden="true">
      !
    </span>
  );
}
export function FieldValidation({ path, label, children }: { path: string; label?: string; children: ReactNode }) {
  const issues = useFieldIssues(path);
  const id = useId();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    for (const input of ref.current?.querySelectorAll('input,select,textarea,[contenteditable]') ?? []) {
      if (input.closest('.nc-validated') !== ref.current) continue;
      if (issues.length) {
        input.setAttribute('aria-invalid', 'true');
        input.setAttribute('aria-describedby', id);
      } else {
        input.removeAttribute('aria-invalid');
        if (input.getAttribute('aria-describedby') === id) input.removeAttribute('aria-describedby');
      }
    }
  });
  return (
    <div
      ref={ref}
      className={`nc-validated${issues.length ? ' nc-invalid' : ''}`}
      data-field-path={path}
      role="group"
      aria-invalid={issues.length > 0 || undefined}
      aria-describedby={issues.length ? id : undefined}
    >
      {label && (
        <div className="nc-field-label">
          {issues.length > 0 && <ErrorMark />}
          {label}
        </div>
      )}
      {children}
      {issues.length > 0 && (
        <div id={id} className="nc-field-errors">
          {!label && <ErrorMark />}
          {issues.map((e, i) => (
            <p key={i}>{e.slice(e.indexOf(':') + 1).trim()}</p>
          ))}
        </div>
      )}
    </div>
  );
}
