import StatusPill from './StatusPill';

/** Active / Inactive for master data (departments, services, doctors, lab tests). */
export default function StatusBadge({ active }: { active: boolean }) {
  return <StatusPill domain="record" status={active ? 'active' : 'inactive'} />;
}
