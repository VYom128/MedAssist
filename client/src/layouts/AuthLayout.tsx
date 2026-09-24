import { Link, Outlet } from 'react-router-dom';
import { usePageTransition } from './usePageTransition';
import Wordmark from './Wordmark';

/** Decorative shapes for the side panel (original, abstract; hidden from assistive tech). */
function PanelShapes() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 600 800"
      preserveAspectRatio="xMidYMid slice"
      className="absolute inset-0 h-full w-full"
    >
      <circle cx="520" cy="110" r="190" className="fill-primary-100" />
      <circle cx="90" cy="690" r="230" className="fill-primary-100/70" />
      <rect
        x="330"
        y="420"
        width="220"
        height="220"
        rx="56"
        className="fill-primary-200/60"
        transform="rotate(12 440 530)"
      />
      <rect
        x="90"
        y="190"
        width="150"
        height="150"
        rx="40"
        className="fill-surface/70"
        transform="rotate(-10 165 265)"
      />
      <circle cx="455" cy="330" r="16" className="fill-warning-500/40" />
      <circle cx="175" cy="480" r="10" className="fill-danger-500/35" />
      <circle cx="300" cy="120" r="7" className="fill-primary-400/60" />
      <path
        d="M150 260v34M133 277h34"
        stroke="currentColor"
        strokeWidth="9"
        strokeLinecap="round"
        className="text-primary-400"
      />
    </svg>
  );
}

/**
 * Public pages (login, register, password reset, status): the form on the left and, from
 * 1024 px, a soft primary panel on the right.
 */
export default function AuthLayout() {
  const pageRef = usePageTransition<HTMLElement>();
  return (
    <div className="min-h-screen bg-canvas lg:grid lg:grid-cols-2 xl:grid-cols-[minmax(0,5fr)_minmax(0,4fr)]">
      <div className="flex min-h-screen flex-col">
        <header className="px-4 py-5 sm:px-8">
          <Wordmark to="/login" />
        </header>
        <main
          ref={pageRef}
          className="flex flex-1 items-start justify-center px-4 pt-2 pb-12 sm:px-8 sm:pt-[6vh] lg:pt-[10vh]"
        >
          <Outlet />
        </main>
        <footer className="px-4 py-4 text-center text-xs text-muted sm:px-8 lg:text-left">
          <Link
            to="/status"
            className="rounded hover:text-ink hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600"
          >
            System status
          </Link>
        </footer>
      </div>

      <div className="relative hidden overflow-hidden bg-primary-50 lg:sticky lg:top-0 lg:block lg:h-screen">
        <PanelShapes />
        <div className="relative flex h-full flex-col justify-end p-12 xl:p-16">
          <p className="text-caption text-primary-800 uppercase">
            Clinic operations &amp; patient care
          </p>
          <p className="mt-3 max-w-md text-3xl leading-tight font-bold tracking-tight text-ink">
            Calm, connected care for your whole clinic.
          </p>
          <p className="mt-3 max-w-md text-sm text-body">
            Appointments, patient records and the day&apos;s work for every role, in one place.
          </p>
        </div>
      </div>
    </div>
  );
}
