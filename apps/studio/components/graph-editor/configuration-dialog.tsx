'use client';
import type { ReactNode } from 'react';
import { ModalOverlay, Modal, Dialog } from '@/components/application/modals/modal';
/** Shared workflow configuration frame. Fields and draft semantics stay with the domain host. */
export function ConfigurationDialog({
  label,
  onClose,
  children,
}: {
  label: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <ModalOverlay
      isOpen
      isDismissable
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      className="nc-overlay"
    >
      <Modal className="nc-modal">
        <Dialog aria-label={label} className="nc-dialog">
          {children}
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}
