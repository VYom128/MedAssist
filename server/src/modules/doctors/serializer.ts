import type { Types } from 'mongoose';
import type { DoctorProfileDoc } from './model.js';

interface DepartmentRef {
  _id: Types.ObjectId;
  name: string;
  code: string;
}

interface UserRef {
  _id: Types.ObjectId;
  firstName: string;
  lastName: string;
  email: string;
  phone?: string | null;
  isActive: boolean;
}

/** A profile with `user` and `department` populated. */
export type DoctorLike = Omit<DoctorProfileDoc, 'user' | 'department'> & {
  _id: Types.ObjectId;
  user: UserRef;
  department: DepartmentRef | null;
  createdAt?: Date;
  updatedAt?: Date;
};

/** Anyone (spec §7.6 GET is public). `id` is the doctor's **User id**. */
export function toPublicView(d: DoctorLike) {
  return {
    id: d.user._id.toString(),
    firstName: d.user.firstName,
    lastName: d.user.lastName,
    name: `${d.user.firstName} ${d.user.lastName}`,
    department: d.department
      ? { id: d.department._id.toString(), name: d.department.name, code: d.department.code }
      : null,
    specialization: d.specialization,
    qualifications: [...d.qualifications],
    experienceYears: d.experienceYears ?? null,
    consultationFeePaise: d.consultationFeePaise ?? null,
    languages: [...d.languages],
    bio: d.bio ?? null,
    isAcceptingAppointments: d.isAcceptingAppointments,
  };
}

/** Admin (and the doctor reading their own profile): contact, registration and status fields. */
export function toAdminView(d: DoctorLike) {
  return {
    ...toPublicView(d),
    email: d.user.email,
    phone: d.user.phone ?? null,
    registrationNumber: d.registrationNumber,
    roomNumber: d.roomNumber ?? null,
    slotMinutes: d.slotMinutes ?? null,
    isActive: d.user.isActive,
    createdAt: d.createdAt ?? null,
    updatedAt: d.updatedAt ?? null,
  };
}
