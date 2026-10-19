# Amrutam Telemedicine Backend: Architecture & System Design Document

**Document Version:** 1.0.0  
**Target Workload:** 100,000 Daily Consultations  
**Latency Targets:** p95 Read < 200 ms | p95 Write < 500 ms  
**Availability Target:** 99.95%  
**Architecture Style:** Modular Monolith with Transactional Outbox  

---

## 1. Executive Summary & Design Philosophy

Amrutam’s telemedicine platform provides remote Ayurvedic medical consultations, digital prescription fulfillment, and payment workflows. The backend is designed as a **Modular Monolith** in JavaScript (Node.js ES Modules) backed by PostgreSQL 16.

A modular monolith architecture was chosen over microservices to eliminate distributed transaction failures, network latency hops, and deployment overhead while retaining domain boundary isolation. PostgreSQL serves as the absolute single source of truth for all bookings, clinical records, transactions, and audit logs.

```
+-----------------------------------------------------------------------------------+
|                                  CLIENT LAYER                                     |
|           [ Mobile App / Web Frontend / Postman / Swagger UI Docs ]              |
+-----------------------------------------+-----------------------------------------+
                                          | HTTPS / REST (JSON)
+-----------------------------------------v-----------------------------------------+
|                                EXPRESS API GATEWAY                                |
|  - Helmet Security Headers                 - Distributed Request ID (UUID v4)     |
|  - Global & Auth Rate Limiting             - Prometheus Metrics Middleware        |
|  - Centralized Error Handler               - Idempotency Middleware               |
|  - JWT Authentication & RBAC Filter        - Zod Request Schema Validation        |
+-----------------------------------------+-----------------------------------------+
                                          |
        +---------------------------------+---------------------------------+
        |                                 |                                 |
+-------v---------+             +---------v---------+             +---------v-------+
|  Auth & Users   |             | Doctor Management |             | Bookings & Core |
| - Registration  |             | - Verification    |             | - Atomic Slot   |
| - Password Hash |             | - Availability    |             |   Locking       |
| - JWT & Profile |             | - Search/Filter   |             | - Idempotency   |
+-------+---------+             +---------+---------+             +---------+-------+
        |                                 |                                 |
+-------v---------+             +---------v---------+             +---------v-------+
|  Consultations  |             | Digital Prescribe |             | Payments & Admin|
| - State Machine |             | - Med Items       |             | - HMAC Webhook  |
| - RBAC Guard    |             | - Patient Guard   |             | - Audit Logs    |
+-------+---------+             +---------+---------+             +---------+-------+
        |                                 |                                 |
+-------v---------------------------------v---------------------------------v-------+
|                                  DATABASE LAYER                                   |
|                              PostgreSQL 16 Engine                                 |
|  - Core Tables (Users, Profiles, Doctors, AvailabilitySlots, Consultations)      |
|  - Clinical Tables (Prescriptions, PrescriptionItems)                             |
|  - Financial & Resiliency (Payments, IdempotencyKeys, OutboxEvents, AuditLogs)    |
|  - Foreign Key Constraints & Row-Level Locks                                      |
+-----------------------------------------------------------------------------------+
```

---

## 2. Request Lifecycle & Modular Monolith Organization

Every inbound request traverses standard validation and security layers before reaching application domain logic:

1. **Ingress & Security Header Processing**: `helmet` applies CSP, HSTS, frameguard, and MIME sniffing protection. `cors` restricts origins.
2. **Correlation & Distributed Tracing**: `requestIdMiddleware` extracts `x-request-id` or issues a fresh UUID v4, assigning it to `req.id` and the `X-Request-Id` response header.
3. **Observability Tracking**: `metricsMiddleware` measures execution duration using high-resolution monotonic clocks (`process.hrtime()`), observing Prometheus histogram `amrutam_http_request_duration_seconds`.
4. **Rate Limiting**: `express-rate-limit` enforces IP-level throttling (1,000 requests / 15 minutes globally; 20 attempts / 15 minutes for auth endpoints).
5. **Idempotency Guard**: Mutating endpoints (`/bookings`, `/payments`) execute `idempotencyMiddleware`. Repeated requests with identical keys are served directly from cache without hitting downstream databases.
6. **Authentication & RBAC**: JWT Bearer tokens are validated. User identity and roles (`PATIENT`, `DOCTOR`, `ADMIN`) are attached to `req.user`.
7. **Input Validation**: Request parameters, queries, and bodies are validated against strict Zod schemas. Malformed inputs immediately fail with 400 Bad Request and detailed field issues.
8. **Service Layer & Database Transactions**: Controllers delegate to isolated services where business logic and Prisma transactions execute.
9. **Centralized Error Handling**: Unhandled exceptions, unique constraint violations (P2002), and authorization failures are captured and converted into standardized JSON errors.

---

## 3. Concurrency & Race Condition Prevention

### The Double-Booking Problem
In a telemedicine system processing 100,000 daily consultations, peak booking periods generate hundreds of simultaneous booking attempts for popular doctor availability slots. Without strict concurrency controls, two patients could book the same doctor slot, leading to double-booked appointments.

### Multi-Layered Protection Architecture
Amrutam implements a three-tier defense:

1. **Pessimistic Row-Level Locking via Atomic Conditional Updates**:
   When booking slot `S`, the transaction executes:
   ```sql
   UPDATE availability_slots
   SET status = 'BOOKED', updated_at = NOW()
   WHERE id = $slotId AND status = 'AVAILABLE';
   ```
   PostgreSQL places an exclusive write lock on that specific row. If two concurrent transactions execute simultaneously:
   - Transaction 1 evaluates `status = 'AVAILABLE'`, locks the row, changes status to `'BOOKED'`, and returns `count = 1`.
   - Transaction 2 blocks until Transaction 1 commits. Upon acquiring the row lock, it re-evaluates the `WHERE status = 'AVAILABLE'` clause. Because the status is now `'BOOKED'`, the update matches 0 rows (`count = 0`).
   - The application detects `count === 0`, increments the `amrutam_booking_conflicts_total` Prometheus counter, rolls back the transaction, and returns `409 Conflict` (`SLOT_ALREADY_BOOKED`).

2. **Database Unique Constraints**:
   `consultations.slot_id` has a strict `@unique` database constraint:
   ```prisma
   model Consultation {
     slotId String @unique @map("slot_id")
   }
   ```
   Even if an application thread bypassed the service check, PostgreSQL will abort the transaction with error `P2002` (unique constraint violation), which the error handler translates to `409 Conflict`.

3. **Client-Side Distributed Idempotency**:
   Every booking submission requires the `Idempotency-Key` header. If a user double-clicks the "Confirm Booking" button, the second HTTP request hits the idempotency layer, returning the cached 201 response with header `X-Cache-Lookup: HIT-IDEMPOTENT` without executing a second database write.

---

## 4. Idempotency Architecture

To prevent duplicate operations during network failures and client retries:

1. The client supplies an `Idempotency-Key` header (UUID v4).
2. The middleware hashes the request body, method, and route using SHA-256 (`requestHash`).
3. The system queries `idempotency_keys` table:
   - **Key Not Found**: An in-flight record is created with a 24-hour expiration (`expiresAt`). The request proceeds. When the response finishes with status < 500, status code and response payload are written to `idempotency_keys`.
   - **Key Found with Same Hash & Completed Status**: The saved status and body are immediately returned with `X-Cache-Lookup: HIT-IDEMPOTENT`.
   - **Key Found with Different Hash**: The client reused an idempotency key with conflicting data; the middleware aborts with `409 Conflict` (`IDEMPOTENCY_KEY_PAYLOAD_MISMATCH`).
   - **Key Found with Null Status**: A concurrent request with the same key is currently running; returns `409 Conflict` (`IDEMPOTENCY_CONCURRENT_REQUEST`).

---

## 5. Scaling Strategy for 100,000 Daily Consultations

### Workload & Throughput Calculation
- **100,000 Daily Consultations**:
  - Over a 14-hour active operational window: ~2 bookings / second steady state.
  - Peak burst ratio (8x): **16–25 bookings / second**.
  - Read-to-write ratio for doctor search & discovery: 15:1.
  - Search/read query rate: **250–400 requests / second**.

### Latency Budget & SLA Validation
- **Read Latency Target**: p95 < 200 ms.
- **Write Latency Target**: p95 < 500 ms.
- **Availability Target**: 99.95% (maximum downtime: 43.8 seconds / day).

### Performance Optimizations
1. **Targeted Database Indexing**:
   - `doctors(specialization, verification_status)`: Compound B-tree index for instantaneous doctor search filtering.
   - `availability_slots(doctor_id, status, start_at)`: Composite index for doctor availability calendar lookups.
   - `consultations(patient_id, status, created_at)`: Speeds up patient dashboard queries.
   - `idempotency_keys(key, expires_at)`: Instant index lookup for write deduplication.
2. **Connection Pooling**:
   Prisma connection pool tuned for 25–50 connections per instance, managed behind PgBouncer in multi-replica deployments.
3. **Data Partitioning Roadmap**:
   - `audit_logs`: Generates ~500,000 events daily. Documented time-based range partitioning by `timestamp` (monthly partitions) prevents B-tree index bloat.
   - `outbox_events`: Hot table pruned by a background worker once events are marked `PROCESSED`.

---

## 6. Resilience, Retries & Transactional Outbox Pattern

### Transactional Outbox Pattern
When a mutation occurs (e.g. `BOOKING_CREATED`, `PRESCRIPTION_ISSUED`, `PAYMENT_COMPLETED`), external systems (SMS gateways, email, message brokers) must be notified. To avoid dual-write distributed transaction bugs:
1. Within the **same PostgreSQL transaction** that creates the `Consultation`, an entry is inserted into `outbox_events`:
   ```js
   await tx.outboxEvent.create({
     data: {
       eventType: 'BOOKING_CREATED',
       aggregateType: 'Consultation',
       aggregateId: newConsultation.id,
       payload: { ... }
     }
   });
   ```
2. If the transaction fails, both the booking and outbox event roll back together.
3. A background worker reads `PENDING` outbox events, dispatches notifications, and marks them `PROCESSED`.

### Retry & Exponential Backoff Strategy
For transient external dependencies (payment providers, notification gateways):
```
Wait Time = min(MaxInterval, BaseInterval * 2^attempt + jitter)
```
- **BaseInterval**: 100 ms
- **MaxInterval**: 5,000 ms
- **MaxRetries**: 3 attempts
- **Jitter**: Full random jitter prevents "thundering herd" spikes against external providers.

---

## 7. Caching Strategy & Redis Integration

1. **Public Doctor Search & Catalog**:
   - Key format: `cache:doctors:spec:<spec>:fee:<fee>:page:<p>`
   - TTL: 300 seconds (5 minutes).
   - Invalidation: Cache tag invalidation triggered when an admin verifies or updates doctor details.
2. **Doctor Availability**:
   - Slots are queried with direct database index lookup (`status = 'AVAILABLE'`) to avoid serving stale availability data.

---

## 8. Backup & Disaster Recovery Architecture

- **RPO (Recovery Point Objective)**: < 5 minutes.
- **RTO (Recovery Time Objective)**: < 15 minutes.
- **Continuous Archiving & PITR**: PostgreSQL Write-Ahead Logs (WAL) continuously streamed to geo-redundant S3/GCS buckets via WAL-G/pgBackRest.
- **Automated Restore Validation**: Daily staging restore jobs verify backup integrity automatically.
