import { Suspense } from 'react';
import type { Metadata } from 'next';
import { ControlAccess } from '@/components/control/access';
import { Providers } from './providers';
import '@fortawesome/fontawesome-svg-core/styles.css';
import './globals.css';
import './control-theme.css';
import './stackproc-shell.css';
import './work-area.css';
import './node-config.css';
export const metadata: Metadata = {
  title: 'Stack Proc',
  description: 'Stack Proc — visual workflows and customer workspaces powered by DBOS.',
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body
        style={
          {
            '--font-geist': 'Geist Variable, sans-serif',
            '--font-geist-mono': 'JetBrains Mono, monospace',
          } as React.CSSProperties
        }
      >
        <Providers>
          <Suspense fallback={<main className="cp-gate">Loading Stack Proc…</main>}>
            <ControlAccess>{children}</ControlAccess>
          </Suspense>
        </Providers>
      </body>
    </html>
  );
}
