'use client';
import type { ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { useControl } from '@/components/control/access';
import { StackProcLogo } from '@/components/control/stackproc-logo';
import { ControlButton } from '@/components/control/controls';
/** Shared frame only: fetching, permissions, mutations and editor state stay with the host. */
export function FullscreenWorkbench({
  title,
  description,
  actions,
  status,
  children,
  backHref = '/',
  onBack,
  leading,
  showBrand = true,
  showBack = true,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  status?: ReactNode;
  children: ReactNode;
  backHref?: string;
  onBack?: () => void;
  leading?: ReactNode;
  showBrand?: boolean;
  showBack?: boolean;
}) {
  const { session } = useControl(),
    router = useRouter();
  return (
    <main className="sp-fullscreen-workbench">
      <header className="sp-workbench-header">
        {leading}
        {showBrand && (
          <a href="/control" aria-label="Procczar workspace" className="sp-workbench-brand">
            <StackProcLogo />
          </a>
        )}
        <div className="sp-workbench-title">
          <div className="sp-workbench-name">
            <h1 title={title}>{title}</h1>
            <span>{session.workspace?.name ?? 'Workspace'}</span>
          </div>
          {description && <p>{description}</p>}
        </div>
        <div className="sp-workbench-actions">
          {actions}
          {showBack && <ControlButton onPress={onBack ?? (() => router.push(backHref))}>Back</ControlButton>}
        </div>
      </header>
      {status && <div className="sp-workbench-status">{status}</div>}
      <div className="sp-workbench-content">{children}</div>
    </main>
  );
}
