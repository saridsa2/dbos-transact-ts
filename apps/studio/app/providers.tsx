'use client';
import { UnsavedChangesProvider, useUnsavedNavigation } from '@/components/control/unsaved-changes';
import { RouterProvider } from 'react-aria-components';
import { useRouter } from 'next/navigation';
import { Toaster } from 'sonner';
import type { ReactNode } from 'react';
export function Providers({ children }: { children: ReactNode }) {
  return (
    <UnsavedChangesProvider>
      <ApplicationProviders>{children}</ApplicationProviders>
    </UnsavedChangesProvider>
  );
}
function ApplicationProviders({ children }: { children: ReactNode }) {
  const router = useRouter();
  const navigate = useUnsavedNavigation();
  return (
    <RouterProvider navigate={(path) => navigate(() => router.push(path))}>
      {children}
      <Toaster richColors closeButton />
    </RouterProvider>
  );
}
