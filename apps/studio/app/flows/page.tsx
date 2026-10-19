'use client';
import { useControl } from '@/components/control/access';
import { FlowBuilder } from '@/components/flows/flow-builder';
import { createStarterFlow } from '@/lib/flows/templates';
export default function FlowsPage() {
  const { session } = useControl();
  return (
    <FlowBuilder
      initialFlow={createStarterFlow()}
      backHref="/"
      signerName={session.user?.displayName ?? 'Workspace user'}
    />
  );
}
