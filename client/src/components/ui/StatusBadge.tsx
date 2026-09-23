import Badge from './Badge';

/** Active / Inactive for master data (departments, services, doctors, lab tests). */
export default function StatusBadge({ active }: { active: boolean }) {
  return active ? <Badge tone="success">Active</Badge> : <Badge tone="neutral">Inactive</Badge>;
}
