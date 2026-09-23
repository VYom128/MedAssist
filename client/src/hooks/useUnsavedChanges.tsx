import { useEffect } from 'react';
import { useBlocker } from 'react-router-dom';
import ConfirmDialog from '../components/ui/ConfirmDialog';

/**
 * Warns before leaving a page with unsaved changes: an in-app dialog for navigation inside the
 * app, and the browser's own prompt for reloads and closing the tab.
 * @returns the dialog element to render.
 */
export function useUnsavedChanges(dirty: boolean) {
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      dirty && currentLocation.pathname !== nextLocation.pathname,
  );

  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  return (
    <ConfirmDialog
      open={blocker.state === 'blocked'}
      title="Leave without saving?"
      confirmLabel="Leave page"
      tone="danger"
      onConfirm={() => blocker.proceed?.()}
      onCancel={() => blocker.reset?.()}
    >
      You have unsaved changes. If you leave now, they will be lost.
    </ConfirmDialog>
  );
}
