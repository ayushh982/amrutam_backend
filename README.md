# Amrutam Telemedicine Backend

[![CI/CD Pipeline](https://github.com/amrutam/telemedicine-backend/actions/workflows/ci.yml/badge.svg)](https://github.com/amrutam/telemedicine-backend/actions)
[![Node.js](https://img.shields.io/badge/Node.js-v22-green.svg)](https://nodejs.org/)
[![Database](https://img.shields.io/badge/PostgreSQL-16-blue.svg)](https://www.postgresql.org/)
[![Prisma](https://img.shields.io/badge/Prisma-ORM-5A67D8.svg)](https://www.prisma.io/)
[![License](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

A production-grade, highly reliable, and observable backend for **Amrutam's Telemedicine Platform**. Built with JavaScript (ES Modules), Express.js, PostgreSQL 16, and Prisma, engineered to handle **100,000 daily consultations** with sub-200ms read latencies, sub-500ms write latencies, and 99.95% target availability.

---

## 🌟 Key Features

1. **Strict Concurrency Protection & Zero Double Bookings**:
   - Atomic row-level status locking (`UPDATE availability_slots SET status = 'BOOKED' WHERE id = :id AND status = 'AVAILABLE'`) ensures that when multiple patients attempt to book the same slot simultaneously, exactly one succeeds and competing requests fail with `409 Conflict`.
   - Backed by an immutable database unique constraint on `consultations.slot_id`.
2. **Distributed Idempotency Engine**:
   - `Idempotency-Key` header enforcement for mutating write operations (`POST /bookings`, `POST /payments`).
   - Replaying identical requests returns cached responses with `X-Cache-Lookup: HIT-IDEMPOTENT` without triggering duplicate database transactions. Conflicting payload reuses are detected and rejected.
3. **Role-Based Access Control (RBAC) & Object-Level Isolation**:
   - Strict roles: `PATIENT`, `DOCTOR`, `ADMIN`.
   - Broken Object Level Authorization (BOLA) mitigation: Patients can only view their own bookings, consultations, and prescriptions. Cross-patient data snooping yields `403 Forbidden`.
4. **Consultation Lifecycle & Digital Prescriptions**:
   - Strict state machine: `BOOKED` ➔ `IN_PROGRESS` ➔ `COMPLETED`.
   - Assigned doctor can issue multi-item digital prescriptions with medication, dosage, and duration.
5. **Verified Payment Webhooks**:
   - HMAC SHA-256 signature verification with constant-time equality check (`crypto.timingSafeEqual`).
   - Duplicate webhook replay protection using the `webhook_events` registry.
6. **Enterprise Observability**:
   - Structured JSON logging with **Pino**, including automated redaction of passwords, tokens, and clinical notes.
   - High-resolution Prometheus metrics on `/metrics` with custom latency histograms for p50, p95, and p99 tracking.
   - Liveness (`/health`) and Readiness (`/ready`) probes.
7. **Interactive OpenAPI 3.0 & Swagger UI**:
   - Comprehensive interactive API documentation hosted live at `/docs`.

---

## 🏗️ Architecture & Request Flow

The backend follows a **Modular Monolith** architecture:

```
[ Client / Swagger UI / Mobile ]
               │
               ▼
    [ Express API Gateway ]
       ├── Helmet Security Headers
       ├── Monotonic Request IDs (x-request-id)
       ├── Global & Auth Rate Limiting (express-rate-limit)
       ├── Prometheus Latency Instrumentation (prom-client)
       ├── Idempotency Verification (idempotency_keys)
       ├── JWT Authentication & RBAC Filter
       └── Zod Request Body Validation
               │
               ▼
    [ Modular Domain Controllers ]
       ├── Auth & Profiles (/api/v1/auth, /api/v1/users)
       ├── Doctor Management & Discovery (/api/v1/doctors)
       ├── Availability & Bookings (/api/v1/bookings)
       ├── Consultations & Prescriptions (/api/v1/consultations)
       ├── Payments & Webhooks (/api/v1/payments)
       └── Admin Analytics & Audit Trails (/api/v1/admin)
               │
               ▼
    [ Service Layer & Prisma ORM ]
       ├── Row-Level Locks & Atomic Transactions ($transaction)
       ├── Transactional Outbox Pattern (outbox_events)
       └── Audit Trail Dispatcher (audit_logs)
               │
               ▼
    [ PostgreSQL 16 Single Source of Truth ]
```

---

## 📂 Project Repository Structure

```
├── .github/workflows/
│   └── ci.yml                     # GitHub Actions CI automated test & build workflow
├── docs/
│   ├── architecture.md            # In-depth system design & scalability document
│   ├── er-diagram.md              # Database schema & Mermaid ER diagram
│   ├── booking-sequence.md        # Concurrency & idempotency sequence diagrams
│   ├── threat-model.md            # STRIDE threat model & OWASP Top 10 mitigations
│   ├── security-checklist.md      # RBAC matrix & security controls checklist
│   ├── disaster-recovery.md       # Backup strategy, RPO/RTO & PITR procedures
│   └── demo-script.md             # 5-minute video presentation script
├── load-tests/
│   └── k6-load-test.js            # k6 load testing script for 100k daily consultations
├── prisma/
│   └── schema.prisma              # Production Prisma schema with indexes & constraints
├── src/
│   ├── config/                    # Validated environment configuration (Zod)
│   ├── database/                  # Prisma client connection manager & test harness
│   ├── middleware/                # Auth, RBAC, error handler, rate limiter, idempotency
│   ├── modules/                   # Isolated domain modules (routes, controllers, services)
│   │   ├── auth/
│   │   ├── users/
│   │   ├── doctors/
│   │   ├── bookings/
│   │   ├── consultations/
│   │   ├── payments/
│   │   └── admin/
│   ├── observability/             # Pino logger & Prometheus metrics registry
│   ├── app.js                     # Express app instance & route assembly
│   └── server.js                  # HTTP server & graceful shutdown hooks
├── tests/
│   ├── helpers/                   # In-memory relational test store & setup
│   ├── unit/                      # Password hashing, JWT, and Zod unit tests
│   └── integration/               # Auth, Concurrency, Prescriptions, Webhooks tests
├── Dockerfile                     # Multi-stage production container
├── docker-compose.yml             # App, PostgreSQL 16, Redis 7 stack
├── openapi.yaml                   # Complete OpenAPI 3.0.3 specification
├── package.json
└── README.md
```

---

## 🚀 Getting Started

### Prerequisites
- **Node.js**: v20 or v22+
- **npm**: v10+
- **Docker & Docker Compose** (optional for containerized deployment)

### 1. Installation
Clone the repository and install dependencies:
```bash
git clone https://github.com/amrutam/telemedicine-backend.git
cd telemedicine-backend
npm install
```

### 2. Environment Configuration
Copy `.env.example` to `.env`:
```bash
cp .env.example .env
```

| Variable | Description | Default |
|:---|:---|:---|
| `NODE_ENV` | Environment mode (`development`, `test`, `production`) | `development` |
| `PORT` | HTTP server port | `3000` |
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://postgres:postgres@localhost:5432/amrutam_db?schema=public` |
| `JWT_SECRET` | Secret key for JWT signing (min 32 chars) | Required |
| `JWT_EXPIRES_IN`| JWT expiration duration | `24h` |
| `RATE_LIMIT_WINDOW_MS` | Rate limit window in milliseconds | `900000` (15m) |
| `RATE_LIMIT_MAX`| Max requests per window | `1000` |
| `PAYMENT_WEBHOOK_SECRET` | HMAC secret for payment webhooks | Required |
| `LOG_LEVEL` | Pino log level (`info`, `debug`, `error`) | `info` |

### 3. Database Setup & Migrations
```bash
# Generate Prisma Client
npm run prisma:generate

# Apply migrations
npm run prisma:migrate
```

### 4. Running the Application
```bash
# Development mode with hot-reloading
npm run dev

# Production mode
npm start
```

### 5. Running with Docker Compose
To spin up the complete containerized stack (Node API, PostgreSQL 16, Redis 7):
```bash
docker compose up -d --build
```

---

## 🧪 Automated Testing Suite

The repository includes comprehensive unit and integration tests covering booking concurrency, distributed idempotency, role-based authorization, state machine transitions, and payment webhooks:

```bash
# Run all automated tests
npm test
```

### Test Suite Summary:
- `tests/unit/auth.test.js`: Password hashing, JWT token verification, and Zod validation schemas.
- `tests/integration/health.test.js`: Liveness (`/health`), metrics (`/metrics`), and 404 error routing.
- `tests/integration/auth-rbac.test.js`: Registration, login, profile retrieval, and RBAC authorization rules.
- `tests/integration/bookings-concurrency.test.js`:
  - **Simultaneous Booking Concurrency**: Two patients booking the exact same slot concurrently: exactly one gets `201 Created` and the other gets `409 Conflict`.
  - **Idempotency Caching**: Repeated requests with identical idempotency keys return cached responses with zero duplicate DB rows.
  - **Payload Mismatch Detection**: Reusing an idempotency key with conflicting payload returns `409 Conflict`.
  - **Cross-Patient Isolation**: Patient B cannot view Patient A's bookings (`403 Forbidden`).
  - **Booking Cancellation**: Cancelling releases slot back to `AVAILABLE`.
- `tests/integration/consultations-prescriptions.test.js`: Consultation state machine transitions and digital prescription issuance rules.
- `tests/integration/payments-webhook.test.js`: HMAC signature verification and duplicate webhook deduplication.

---

## 📖 API Documentation & Endpoints

Interactive Swagger UI is available at **`http://localhost:3000/docs`**.

### Core API Routes (`/api/v1`):

| Resource | Method | Endpoint | Description | Auth Required |
|:---|:---:|:---|:---|:---:|
| **Auth** | `POST` | `/api/v1/auth/register` | Register new patient or doctor | No |
| **Auth** | `POST` | `/api/v1/auth/login` | Login and receive JWT Bearer token | No |
| **Users** | `GET` | `/api/v1/users/me` | Retrieve authenticated user profile | Bearer Token |
| **Doctors** | `GET` | `/api/v1/doctors` | Search & filter doctors (specialization, fee) | No |
| **Doctors** | `GET` | `/api/v1/doctors/:id` | View doctor profile & available slots | No |
| **Doctors** | `PATCH` | `/api/v1/doctors/profile` | Doctor updates their own bio and fee | DOCTOR |
| **Availability**| `POST` | `/api/v1/doctors/:id/slots` | Doctor creates availability time slots | DOCTOR |
| **Availability**| `GET` | `/api/v1/doctors/:id/slots` | List doctor availability slots | No |
| **Bookings** | `POST` | `/api/v1/bookings` | Book consultation (Idempotency-Key required) | PATIENT |
| **Bookings** | `GET` | `/api/v1/bookings` | List user's bookings | Bearer Token |
| **Bookings** | `GET` | `/api/v1/bookings/:id` | Get booking details (Ownership enforced) | PATIENT/DOCTOR |
| **Bookings** | `PATCH` | `/api/v1/bookings/:id/cancel` | Cancel booking & release slot to AVAILABLE | PATIENT/DOCTOR |
| **Consultations**| `GET` | `/api/v1/consultations/:id` | View consultation record & notes | PATIENT/DOCTOR |
| **Consultations**| `PATCH`| `/api/v1/consultations/:id/status`| Transition status (BOOKED ➔ IN_PROGRESS ➔ COMPLETED) | DOCTOR |
| **Prescriptions**| `POST` | `/api/v1/consultations/:id/prescriptions` | Issue digital prescription with medications | DOCTOR |
| **Prescriptions**| `GET` | `/api/v1/consultations/:id/prescription` | View prescription (Ownership enforced) | PATIENT/DOCTOR |
| **Payments** | `POST` | `/api/v1/payments` | Initiate consultation payment | PATIENT |
| **Payments** | `POST` | `/api/v1/payments/webhook` | Webhook endpoint (HMAC signature protected) | Webhook Sig |
| **Admin** | `GET` | `/api/v1/admin/analytics` | View platform revenue & consultation metrics | ADMIN |
| **Admin** | `GET` | `/api/v1/admin/audit-logs` | Query security & clinical audit trail | ADMIN |
| **Admin** | `PATCH` | `/api/v1/admin/doctors/:id/verify` | Verify or reject doctor credentials | ADMIN |

---

## 📊 Observability & Metrics

- **Liveness Probe**: `GET /health` returns JSON health status, uptime, and service name.
- **Readiness Probe**: `GET /ready` checks active PostgreSQL database connectivity.
- **Prometheus Metrics**: `GET /metrics` exposes default runtime metrics and custom business metrics:
  - `amrutam_http_request_duration_seconds`: Histogram tracking request latency across routes and status codes.
  - `amrutam_http_requests_total`: Counter tracking total requests.
  - `amrutam_booking_conflicts_total`: Counter tracking prevented concurrent booking collisions.
  - `amrutam_idempotency_hits_total`: Counter tracking duplicate requests served from cache.

---

## ⚖️ Limitations & Honest Operational Assessment

In alignment with production engineering standards:
1. **Target SLA Evidence**: The 100,000 daily consultations target, p95 read < 200ms, and p95 write < 500ms are validated via our k6 load testing scenarios (`load-tests/k6-load-test.js`). 99.95% availability is an architecture design objective that requires multi-region infrastructure and ongoing operational monitoring to claim as historical fact.
2. **Third-Party Integrations**: Real SMS/Email notifications and payment gateways use mock adapters with the **Transactional Outbox Pattern** (`outbox_events` table) to maintain high reliability without hard dependencies on sandbox credentials.
3. **MFA for Admins**: Core RBAC and session checks are enforced; TOTP-based Multi-Factor Authentication is architecturally scoped for the next sprint.

---

## 📄 License
This project is licensed under the MIT License.
