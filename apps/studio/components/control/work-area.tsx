'use client';
import type { ReactNode, FC, HTMLAttributes } from 'react';
import { Tabs } from '@/components/application/tabs/tabs';
import { Button } from '@/components/base/buttons/button';
import { Tooltip } from '@/components/base/tooltip/tooltip';

/** The shell bounds this frame; only the content viewport may scroll. */
export function WorkArea({
  title,
  description,
  actions,
  navigation,
  children,
  footer,
  status,
  scroll = false,
  contextKey,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  navigation?: {
    label: string;
    value: string;
    items: { id: string; label: string }[];
    onChange: (id: string) => void;
  };
  children: ReactNode;
  footer?: ReactNode;
  status?: ReactNode;
  scroll?: boolean;
  contextKey?: string;
}) {
  return (
    <main className="sp-work-area">
      <header className="sp-work-header">
        <div className="sp-work-title">
          <h1>{title}</h1>
          {description && <p>{description}</p>}
        </div>
        {actions && <div className="sp-work-actions">{actions}</div>}
      </header>
      {navigation ? (
        <Tabs
          selectedKey={navigation.value}
          onSelectionChange={(key) => navigation.onChange(String(key))}
          className="sp-work-stack"
        >
          <Tabs.List
            aria-label={navigation.label}
            type="underline"
            items={navigation.items}
            className="sp-work-tablist"
          >
            {(item) => <Tabs.Item id={item.id}>{item.label}</Tabs.Item>}
          </Tabs.List>
          {status && <div className="sp-work-status">{status}</div>}
          <Tabs.Panel
            id={navigation.value}
            key={contextKey}
            className={`sp-work-content${scroll ? ' sp-content-scroll' : ''}`}
          >
            {children}
          </Tabs.Panel>
        </Tabs>
      ) : (
        <>
          {status && <div className="sp-work-status">{status}</div>}
          <div key={contextKey} className={`sp-work-content${scroll ? ' sp-content-scroll' : ''}`}>
            {children}
          </div>
        </>
      )}
      {footer && <footer className="sp-work-footer">{footer}</footer>}
    </main>
  );
}

/** Use around the official table; scoped CSS preserves vendor row styles. */
export function TableViewport({ children, label }: { children: ReactNode; label: string }) {
  return (
    <div className="sp-table-viewport" role="region" aria-label={label} tabIndex={0}>
      {children}
    </div>
  );
}

export function RecordAction({
  label,
  icon,
  onPress,
  href,
  disabled,
}: {
  label: string;
  icon: FC<HTMLAttributes<HTMLOrSVGElement>>;
  onPress?: () => void;
  href?: string;
  disabled?: boolean;
}) {
  return (
    <Tooltip title={label}>
      <Button
        {...(href ? { href } : { onPress })}
        color="tertiary"
        size="sm"
        iconLeading={icon}
        aria-label={label}
        isDisabled={disabled}
      />
    </Tooltip>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="sp-empty">
      <h2>{title}</h2>
      {children && <p>{children}</p>}
    </div>
  );
}
