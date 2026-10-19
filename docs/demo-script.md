# Five-Minute Video Demo Script: Amrutam Telemedicine Backend

This script is structured exactly to meet the minute-by-minute breakdown required by the assignment deliverables. Use this guide while recording your screen.

---

### [0:00 – 0:30] Segment 1: Project Overview & Objectives
- **Visual:** Terminal showing project directory, `npm start`, and `http://localhost:3000`.
- **Spoken Script:**
  > "Hello everyone. Today I'm presenting the production-grade backend for Amrutam's Telemedicine Platform. Our goal was to design and build a highly reliable, observable, and secure backend engineered to handle 100,000 daily consultations with sub-200ms read latencies and sub-500ms write latencies. Built with JavaScript ES Modules on Node.js, Express, PostgreSQL, Prisma, Zod, and Docker, our backend enforces strict concurrency locks to completely eliminate double bookings, provides distributed idempotency for network retries, and maintains comprehensive audit trails for sensitive clinical data."

---

### [0:30 – 1:15] Segment 2: Architecture & Database Design
- **Visual:** Display `docs/architecture.md` diagram and `docs/er-diagram.md` in browser or editor.
- **Spoken Script:**
  > "Let's review the system architecture. We selected a modular monolith architecture. This guarantees domain isolation while avoiding the distributed transaction overhead and network latency of separate microservices.
  > Looking at our database schema, PostgreSQL 16 is the single source of truth. We have 12 core tables: Users, Profiles, Doctors, Availability Slots, Consultations, Prescriptions, Prescription Items, Payments, Audit Logs, and Idempotency Keys.
  > Notice three crucial architectural decisions:
  > First, money is strictly stored in minor integer units like paise to prevent floating-point rounding errors.
  > Second, `consultations.slot_id` has a strict unique foreign key constraint, enforcing that no two consultations can ever point to the same availability slot.
  > Third, we implement the Transactional Outbox pattern so post-commit notifications never desynchronize from database state."

---

### [1:15 – 2:00] Segment 3: Authentication & Role-Based Access Control
- **Visual:** Swagger UI (`http://localhost:3000/docs`) showing `/api/v1/auth/register`, `/api/v1/auth/login`, and `/api/v1/users/me`.
- **Spoken Script:**
  > "Next, authentication and RBAC. We implement bcrypt hashing with 10 salt rounds and stateless JWT Bearer authorization.
  > When a patient registers, they receive a JWT. When a doctor registers, our Zod schema strictly validates medical credentials, including their license number and specialization.
  > Our RBAC middleware differentiates between `PATIENT`, `DOCTOR`, and `ADMIN` roles. Crucially, we also enforce record-level ownership checks (preventing BOLA). For example, Patient A cannot view Patient B's medical consultation or prescription, returning an immediate 403 Forbidden."

---

### [2:00 – 3:00] Segment 4: Doctor Search, Availability & Booking Flow
- **Visual:** Swagger UI or Postman executing:
  1. `GET /api/v1/doctors?specialization=Ayurveda`
  2. `POST /api/v1/doctors/:id/slots`
  3. `POST /api/v1/bookings` with `Idempotency-Key` header
- **Spoken Script:**
  > "Now let's demonstrate the booking lifecycle.
  > First, patients search for verified doctors. Our search endpoint supports specialization, fee range filtering, and pagination, backed by composite B-tree indexes.
  > A verified doctor defines their availability by posting time slots. The system validates that end times are in the future and prevents overlapping slot creation.
  > Now, when a patient books a slot, they send a POST request with an `Idempotency-Key` header. In a single atomic PostgreSQL transaction, the slot is reserved, the consultation is created, and an outbox event is queued."

---

### [3:00 – 4:00] Segment 5: Concurrency, Idempotency & Automated Tests
- **Visual:** Terminal running `npm test tests/integration/bookings-concurrency.test.js` and `npm test`.
- **Spoken Script:**
  > "Now for our most critical feature: concurrency and race condition protection. Let's run our automated test suite in the terminal.
  > Watch the simultaneous booking test: we simulate two patients submitting booking requests for the exact same slot at the exact same millisecond. Using atomic conditional updates (`UPDATE availability_slots SET status='BOOKED' WHERE id=$slotId AND status='AVAILABLE'`), PostgreSQL acquires a row-level lock. Exactly ONE patient succeeds with 201 Created; the competing request receives 409 Conflict with code `SLOT_ALREADY_BOOKED`.
  > Furthermore, our idempotency middleware guarantees that if a patient retries the request with the same `Idempotency-Key`, the API returns the cached response with `X-Cache-Lookup: HIT-IDEMPOTENT` without creating any duplicate records.
  > As you can see, all 38 automated tests across all 6 test suites pass cleanly."

---

### [4:00 – 4:40] Segment 6: Prescriptions, Payments, Audit & Swagger UI
- **Visual:** Swagger UI showing `/api/v1/consultations/:id/status`, `/prescriptions`, `/payments/webhook`, and `/admin/analytics`.
- **Spoken Script:**
  > "Once booked, the consultation enters a strict state machine: `BOOKED` transitions to `IN_PROGRESS`, and finally to `COMPLETED`.
  > Only the assigned doctor can issue a digital prescription, containing medications, dosages, and instructions.
  > Payments support mock gateway integration and verified webhooks protected by HMAC-SHA256 signatures with constant-time equality checks and duplicate replay protection.
  > Every single administrative and medical action is recorded in `audit_logs` with actor ID, IP address, and timestamp. Admins can view analytics on revenue and cancellation rates."

---

### [4:40 – 5:00] Segment 7: CI/CD, Observability & Limitations
- **Visual:** Show `.github/workflows/ci.yml`, `http://localhost:3000/metrics`, and `docker-compose.yml`.
- **Spoken Script:**
  > "Finally, production readiness:
  > We have automated CI pipelines in GitHub Actions running linting, tests, and Docker container builds.
  > For observability, Pino provides structured JSON logging with redaction for medical privacy, while Prometheus exposes latency histograms on `/metrics` to track p95 targets.
  > For full transparency regarding limitations: real SMS/email notifications and external payment gateways currently use mock adapters with transactional outbox patterns.
  > Thank you for your time, and we invite you to review our repository and comprehensive documentation."
