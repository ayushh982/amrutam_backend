import { v4 as uuidv4 } from 'uuid';

export class InMemoryPrismaClient {
  constructor() {
    this.reset();
  }

  reset() {
    this.users = [];
    this.profiles = [];
    this.doctors = [];
    this.availabilitySlots = [];
    this.consultations = [];
    this.prescriptions = [];
    this.prescriptionItems = [];
    this.payments = [];
    this.auditLogs = [];
    this.idempotencyKeys = [];
    this.outboxEvents = [];
    this.webhookEvents = [];
  }

  get user() {
    return {
      findUnique: async ({ where }) => {
        let u = null;
        if (where.id) u = this.users.find((x) => x.id === where.id);
        if (where.email) u = this.users.find((x) => x.email.toLowerCase() === where.email.toLowerCase());
        if (!u) return null;
        return {
          ...u,
          profile: this.profiles.find((p) => p.userId === u.id) || null,
          doctor: this.doctors.find((d) => d.userId === u.id) || null,
        };
      },
      create: async ({ data, include }) => {
        const id = data.id || uuidv4();
        const user = {
          id,
          email: data.email.toLowerCase(),
          passwordHash: data.passwordHash,
          role: data.role || 'PATIENT',
          status: data.status || 'ACTIVE',
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        this.users.push(user);

        let profile = null;
        if (data.profile?.create) {
          profile = {
            id: uuidv4(),
            userId: id,
            name: data.profile.create.name,
            phone: data.profile.create.phone || null,
            createdAt: new Date(),
            updatedAt: new Date(),
          };
          this.profiles.push(profile);
        }

        let doctor = null;
        if (data.doctor?.create) {
          doctor = {
            id: uuidv4(),
            userId: id,
            specialization: data.doctor.create.specialization,
            licenseNumber: data.doctor.create.licenseNumber,
            consultationFee: data.doctor.create.consultationFee || 50000,
            currency: 'INR',
            bio: data.doctor.create.bio || null,
            experienceYears: data.doctor.create.experienceYears || 0,
            verificationStatus: data.doctor.create.verificationStatus || 'PENDING',
            createdAt: new Date(),
            updatedAt: new Date(),
          };
          this.doctors.push(doctor);
        }

        return {
          ...user,
          profile,
          doctor,
        };
      },
      count: async ({ where = {} } = {}) => {
        return this.users.length;
      },
      groupBy: async ({ by, _count }) => {
        const counts = {};
        for (const u of this.users) {
          counts[u.role] = (counts[u.role] || 0) + 1;
        }
        return Object.entries(counts).map(([role, count]) => ({
          role,
          _count: { id: count },
        }));
      },
    };
  }

  get doctor() {
    return {
      findUnique: async ({ where, include }) => {
        let doc = null;
        if (where.id) doc = this.doctors.find((d) => d.id === where.id);
        if (where.userId) doc = this.doctors.find((d) => d.userId === where.userId);
        if (where.licenseNumber) doc = this.doctors.find((d) => d.licenseNumber === where.licenseNumber);
        if (!doc) return null;

        const user = this.users.find((u) => u.id === doc.userId);
        const profile = user ? this.profiles.find((p) => p.userId === user.id) : null;
        const slots = this.availabilitySlots.filter((s) => s.doctorId === doc.id && s.status === 'AVAILABLE');

        return {
          ...doc,
          user: user ? { ...user, profile } : null,
          slots: include?.slots ? slots : undefined,
        };
      },
      findMany: async ({ where = {}, skip = 0, take = 20 } = {}) => {
        let results = [...this.doctors];
        if (where.verificationStatus) {
          results = results.filter((d) => d.verificationStatus === where.verificationStatus);
        }
        if (where.specialization?.contains) {
          const s = where.specialization.contains.toLowerCase();
          results = results.filter((d) => d.specialization.toLowerCase().includes(s));
        }
        return results.slice(skip, skip + take).map((doc) => {
          const user = this.users.find((u) => u.id === doc.userId);
          const profile = user ? this.profiles.find((p) => p.userId === user.id) : null;
          return {
            ...doc,
            user: { email: user?.email, profile },
          };
        });
      },
      count: async ({ where = {} } = {}) => {
        return this.doctors.length;
      },
      groupBy: async ({ by, _count }) => {
        const counts = {};
        for (const d of this.doctors) {
          counts[d.verificationStatus] = (counts[d.verificationStatus] || 0) + 1;
        }
        return Object.entries(counts).map(([verificationStatus, count]) => ({
          verificationStatus,
          _count: { id: count },
        }));
      },
      update: async ({ where, data }) => {
        const doc = this.doctors.find((d) => d.id === where.id);
        if (!doc) throw new Error('Doctor not found');
        Object.assign(doc, data, { updatedAt: new Date() });
        const user = this.users.find((u) => u.id === doc.userId);
        const profile = user ? this.profiles.find((p) => p.userId === user.id) : null;
        return {
          ...doc,
          user: { email: user?.email, profile },
        };
      },
    };
  }

  get availabilitySlot() {
    return {
      findUnique: async ({ where, include }) => {
        const slot = this.availabilitySlots.find((s) => s.id === where.id);
        if (!slot) return null;
        const doctor = this.doctors.find((d) => d.id === slot.doctorId);
        return {
          ...slot,
          doctor: include?.doctor ? doctor : undefined,
        };
      },
      findFirst: async ({ where }) => {
        return (
          this.availabilitySlots.find((s) => {
            if (s.doctorId !== where.doctorId) return false;
            if (where.status?.not && s.status === where.status.not) return false;
            return true;
          }) || null
        );
      },
      findMany: async ({ where }) => {
        return this.availabilitySlots.filter((s) => {
          if (s.doctorId !== where.doctorId) return false;
          if (where.status && s.status !== where.status) return false;
          return true;
        });
      },
      create: async ({ data }) => {
        const slot = {
          id: data.id || uuidv4(),
          doctorId: data.doctorId,
          startAt: new Date(data.startAt),
          endAt: new Date(data.endAt),
          status: data.status || 'AVAILABLE',
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        this.availabilitySlots.push(slot);
        return slot;
      },
      updateMany: async ({ where, data }) => {
        // ATOMIC ROW LEVEL LOCK SIMULATION
        let updatedCount = 0;
        for (const s of this.availabilitySlots) {
          if (s.id === where.id) {
            if (where.status && s.status !== where.status) {
              continue; // Status doesn't match! (e.g. was already booked concurrently)
            }
            s.status = data.status;
            s.updatedAt = new Date();
            updatedCount++;
          }
        }
        return { count: updatedCount };
      },
      update: async ({ where, data }) => {
        const s = this.availabilitySlots.find((x) => x.id === where.id);
        if (!s) throw new Error('Slot not found');
        Object.assign(s, data, { updatedAt: new Date() });
        return s;
      },
      delete: async ({ where }) => {
        const idx = this.availabilitySlots.findIndex((x) => x.id === where.id);
        if (idx !== -1) {
          const removed = this.availabilitySlots.splice(idx, 1);
          return removed[0];
        }
        return null;
      },
    };
  }

  get consultation() {
    return {
      findUnique: async ({ where, include }) => {
        const c = this.consultations.find((x) => x.id === where.id);
        if (!c) return null;

        const doctor = this.doctors.find((d) => d.id === c.doctorId);
        const doctorUser = doctor ? this.users.find((u) => u.id === doctor.userId) : null;
        const doctorProfile = doctorUser ? this.profiles.find((p) => p.userId === doctorUser.id) : null;

        const patient = this.users.find((u) => u.id === c.patientId);
        const patientProfile = patient ? this.profiles.find((p) => p.userId === patient.id) : null;

        const slot = this.availabilitySlots.find((s) => s.id === c.slotId);
        const prescription = this.prescriptions.find((p) => p.consultationId === c.id);
        const payments = this.payments.filter((p) => p.consultationId === c.id);

        return {
          ...c,
          doctor: {
            ...doctor,
            user: { email: doctorUser?.email, profile: doctorProfile },
          },
          patient: {
            id: patient?.id,
            email: patient?.email,
            profile: patientProfile,
          },
          slot,
          prescription: prescription
            ? {
                ...prescription,
                items: this.prescriptionItems.filter((i) => i.prescriptionId === prescription.id),
              }
            : null,
          payments,
        };
      },
      findMany: async ({ where = {}, skip = 0, take = 20 } = {}) => {
        let results = [...this.consultations];
        if (where.patientId) results = results.filter((c) => c.patientId === where.patientId);
        if (where.doctorId) results = results.filter((c) => c.doctorId === where.doctorId);
        if (where.status) results = results.filter((c) => c.status === where.status);

        return results.slice(skip, skip + take).map((c) => {
          const doctor = this.doctors.find((d) => d.id === c.doctorId);
          const doctorUser = doctor ? this.users.find((u) => u.id === doctor.userId) : null;
          const doctorProfile = doctorUser ? this.profiles.find((p) => p.userId === doctorUser.id) : null;
          const patient = this.users.find((u) => u.id === c.patientId);
          const patientProfile = patient ? this.profiles.find((p) => p.userId === patient.id) : null;
          const slot = this.availabilitySlots.find((s) => s.id === c.slotId);

          return {
            ...c,
            doctor: { user: { profile: doctorProfile } },
            patient: { profile: patientProfile },
            slot,
          };
        });
      },
      create: async ({ data, include }) => {
        // Enforce unique slotId constraint
        if (this.consultations.some((x) => x.slotId === data.slotId)) {
          const err = new Error('Unique constraint failed on the fields: (`slot_id`)');
          err.code = 'P2002';
          err.meta = { target: 'slot_id' };
          throw err;
        }

        const id = data.id || uuidv4();
        const consultation = {
          id,
          patientId: data.patientId,
          doctorId: data.doctorId,
          slotId: data.slotId,
          status: data.status || 'BOOKED',
          reason: data.reason,
          notes: data.notes || null,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        this.consultations.push(consultation);

        const slot = this.availabilitySlots.find((s) => s.id === data.slotId);
        const doctor = this.doctors.find((d) => d.id === data.doctorId);
        const doctorUser = doctor ? this.users.find((u) => u.id === doctor.userId) : null;
        const doctorProfile = doctorUser ? this.profiles.find((p) => p.userId === doctorUser.id) : null;
        const patient = this.users.find((u) => u.id === data.patientId);
        const patientProfile = patient ? this.profiles.find((p) => p.userId === patient.id) : null;

        return {
          ...consultation,
          slot,
          doctor: { ...doctor, user: { email: doctorUser?.email, profile: doctorProfile } },
          patient: { email: patient?.email, profile: patientProfile },
        };
      },
      update: async ({ where, data }) => {
        const c = this.consultations.find((x) => x.id === where.id);
        if (!c) throw new Error('Consultation not found');
        Object.assign(c, data, { updatedAt: new Date() });
        const slot = this.availabilitySlots.find((s) => s.id === c.slotId);
        return { ...c, slot };
      },
      count: async ({ where = {} } = {}) => {
        return this.consultations.length;
      },
      groupBy: async ({ by, _count }) => {
        const counts = {};
        for (const c of this.consultations) {
          counts[c.status] = (counts[c.status] || 0) + 1;
        }
        return Object.entries(counts).map(([status, count]) => ({
          status,
          _count: { id: count },
        }));
      },
    };
  }

  get prescription() {
    return {
      findUnique: async ({ where }) => {
        const p = this.prescriptions.find((x) => x.consultationId === where.consultationId);
        if (!p) return null;
        const items = this.prescriptionItems.filter((i) => i.prescriptionId === p.id);
        const doctor = this.doctors.find((d) => d.id === p.doctorId);
        const doctorUser = doctor ? this.users.find((u) => u.id === doctor.userId) : null;
        const doctorProfile = doctorUser ? this.profiles.find((prof) => prof.userId === doctorUser.id) : null;

        return {
          ...p,
          items,
          doctor: { user: { profile: doctorProfile } },
        };
      },
      create: async ({ data, include }) => {
        const id = data.id || uuidv4();
        const prescription = {
          id,
          consultationId: data.consultationId,
          doctorId: data.doctorId,
          patientId: data.patientId,
          notes: data.notes || null,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        this.prescriptions.push(prescription);

        const items = [];
        if (data.items?.create) {
          for (const item of data.items.create) {
            const createdItem = {
              id: uuidv4(),
              prescriptionId: id,
              medication: item.medication,
              dosage: item.dosage,
              instructions: item.instructions,
              duration: item.duration,
              createdAt: new Date(),
            };
            this.prescriptionItems.push(createdItem);
            items.push(createdItem);
          }
        }

        return {
          ...prescription,
          items,
        };
      },
    };
  }

  get payment() {
    return {
      findUnique: async ({ where }) => {
        return this.payments.find((p) => p.id === where.id) || null;
      },
      create: async ({ data }) => {
        const payment = {
          id: data.id || uuidv4(),
          consultationId: data.consultationId,
          amount: data.amount,
          currency: data.currency || 'INR',
          status: data.status || 'PENDING',
          providerReference: data.providerReference || null,
          idempotencyKey: data.idempotencyKey || null,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        this.payments.push(payment);
        return payment;
      },
      update: async ({ where, data }) => {
        const p = this.payments.find((x) => x.id === where.id);
        if (!p) throw new Error('Payment not found');
        Object.assign(p, data, { updatedAt: new Date() });
        return p;
      },
      aggregate: async () => {
        const completed = this.payments.filter((p) => p.status === 'COMPLETED');
        const sum = completed.reduce((acc, curr) => acc + curr.amount, 0);
        return {
          _sum: { amount: sum },
          _count: { id: completed.length },
        };
      },
    };
  }

  get idempotencyKey() {
    return {
      findUnique: async ({ where }) => {
        return this.idempotencyKeys.find((k) => k.key === where.key) || null;
      },
      create: async ({ data }) => {
        const item = {
          id: uuidv4(),
          key: data.key,
          targetEndpoint: data.targetEndpoint,
          requestHash: data.requestHash,
          responseStatus: data.responseStatus || null,
          responseBody: data.responseBody || null,
          expiresAt: data.expiresAt,
          createdAt: new Date(),
        };
        this.idempotencyKeys.push(item);
        return item;
      },
      update: async ({ where, data }) => {
        const item = this.idempotencyKeys.find((k) => k.key === where.key);
        if (item) {
          Object.assign(item, data);
        }
        return item;
      },
      delete: async ({ where }) => {
        const idx = this.idempotencyKeys.findIndex((k) => k.key === where.key);
        if (idx !== -1) {
          this.idempotencyKeys.splice(idx, 1);
        }
      },
    };
  }

  get webhookEvent() {
    return {
      findUnique: async ({ where }) => {
        return this.webhookEvents.find((e) => e.eventId === where.eventId) || null;
      },
      create: async ({ data }) => {
        const item = {
          id: uuidv4(),
          provider: data.provider,
          eventId: data.eventId,
          eventType: data.eventType,
          payload: data.payload,
          status: data.status || 'RECEIVED',
          processedAt: null,
          createdAt: new Date(),
        };
        this.webhookEvents.push(item);
        return item;
      },
      update: async ({ where, data }) => {
        const item = this.webhookEvents.find((e) => e.id === where.id);
        if (item) {
          Object.assign(item, data);
        }
        return item;
      },
    };
  }

  get outboxEvent() {
    return {
      create: async ({ data }) => {
        const item = {
          id: uuidv4(),
          ...data,
          createdAt: new Date(),
        };
        this.outboxEvents.push(item);
        return item;
      },
    };
  }

  get auditLog() {
    return {
      create: async ({ data }) => {
        const item = {
          id: uuidv4(),
          ...data,
          timestamp: new Date(),
        };
        this.auditLogs.push(item);
        return item;
      },
      count: async () => this.auditLogs.length,
      findMany: async ({ skip = 0, take = 20 } = {}) => {
        return this.auditLogs.slice(skip, skip + take).map((log) => {
          const actor = log.actorId ? this.users.find((u) => u.id === log.actorId) : null;
          return {
            ...log,
            actor: actor ? { id: actor.id, email: actor.email, role: actor.role } : null,
          };
        });
      },
    };
  }

  async $transaction(fn) {
    if (typeof fn === 'function') {
      return fn(this);
    }
    // Array of promises
    return Promise.all(fn);
  }

  async $queryRaw() {
    return [{ 1: 1 }];
  }

  async $disconnect() {
    return true;
  }
}

export const mockPrisma = new InMemoryPrismaClient();
