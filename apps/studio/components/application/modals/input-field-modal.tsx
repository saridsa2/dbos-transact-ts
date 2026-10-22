'use client';

// Adapted from Untitled UI's installed input-field-modal pattern for a controlled file form.
import { Heading } from 'react-aria-components';
import { FilePlus01 } from '@untitledui/icons';
import { Dialog, Modal, ModalOverlay } from '@/components/application/modals/modal';
import { Button } from '@/components/base/buttons/button';
import { CloseButton } from '@/components/base/buttons/close-button';
import { Input } from '@/components/base/input/input';
import { FeaturedIcon } from '@/components/foundations/featured-icon/featured-icon';

export function InputFieldModal({
  value,
  onChange,
  error,
  onCreate,
  onClose,
}: {
  value: string;
  onChange: (value: string) => void;
  error: string;
  onCreate: () => void;
  onClose: () => void;
}) {
  return (
    <ModalOverlay
      isOpen
      isDismissable
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      className="cp-modal-backdrop"
    >
      <Modal className="cp-modal-container tool-new-file-modal">
        <Dialog aria-describedby="new-file-description">
          <CloseButton label="Close new file" slot={null} onPress={onClose} className="tool-new-file-close" />
          <form
            onSubmit={(event) => {
              event.preventDefault();
              onCreate();
            }}
          >
            <header className="tool-new-file-header">
              <FeaturedIcon
                icon={FilePlus01}
                color="gray"
                theme="modern"
                size="lg"
                className="tool-new-file-featured"
              />
              <Heading slot="title">New file</Heading>
              <p id="new-file-description">Add a source, schema or test file to this tool draft.</p>
            </header>
            <div className="tool-new-file-body">
              <Input
                autoFocus
                label="File path"
                value={value}
                onChange={onChange}
                placeholder="src/helpers.ts"
                isRequired
                hideRequiredIndicator
                isInvalid={!!error}
                hint={
                  error ? (
                    <span role="alert">{error}</span>
                  ) : (
                    'Use src/ for code, schemas/ for JSON schemas, or tests/ for fixtures.'
                  )
                }
              />
            </div>
            <footer className="tool-new-file-footer">
              <Button color="secondary" type="button" onPress={onClose}>
                Cancel
              </Button>
              <Button color="primary" className="cp-primary" type="submit" isDisabled={!value.trim()}>
                Create file
              </Button>
            </footer>
          </form>
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}
