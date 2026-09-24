import type { ToasterProps } from 'react-hot-toast';

/** react-hot-toast look (passed to <Toaster toastOptions> in main.tsx). Durations unchanged. */
export const TOAST_OPTIONS: ToasterProps['toastOptions'] = {
  duration: 4000,
  className: 'text-sm',
  style: {
    background: '#ffffff',
    color: '#0f1b3d',
    border: '1px solid #e6e8f0',
    borderRadius: '0.75rem',
    boxShadow: '0 16px 40px -8px rgb(15 27 61 / 0.18)',
    padding: '10px 14px',
    fontFamily: 'inherit',
  },
  success: { iconTheme: { primary: '#047857', secondary: '#ffffff' } },
  // Errors interrupt the screen reader; success and info toasts stay polite (role="status").
  error: {
    iconTheme: { primary: '#be123c', secondary: '#ffffff' },
    ariaProps: { role: 'alert', 'aria-live': 'assertive' },
  },
};
