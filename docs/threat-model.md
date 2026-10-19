# Amrutam Telemedicine Backend: Threat Model & Security Architecture

**Author:** Amrutam Security & Backend Engineering Team  
**Standards:** OWASP Top 10 API Security Risks (2023), STRIDE Threat Modeling, HIPAA/DISHA Security Principles  

---

## 1. Attack Surface Analysis

The Amrutam Telemedicine Backend exposes REST endpoints over HTTP/S. The system handles electronic protected health information (ePHI), financial payment transitions, and doctor credential verifications.

```
[ External Internet ] 
        |
        v
[ Reverse Proxy / Cloudflare WAF ] (DDoS mitigation, TLS termination, IP rate limiting)
        |
        v
[ Express Application Gateway ] 
  ├── Public Endpoints: /api/v1/auth/*, /api/v1/doctors, /health, /metrics, /docs
  ├── Protected Patient Endpoints: /api/v1/bookings, /api/v1/payments, /api/v1/users/me
  ├── Protected Doctor Endpoints: /api/v1/doctors/:id/slots, /api/v1/consultations/:id/prescriptions
  ├── Protected Admin Endpoints: /api/v1/admin/analytics, /api/v1/admin/audit-logs
  └── Webhook Ingress: /api/v1/payments/webhook (HMAC signature protected)
        |
        v
[ Internal Subnet ] -> [ PostgreSQL Database & Redis Cache ]
```

---

## 2. Data Classification Matrix

| Data Classification Tier | Examples | Controls & Protection Measures |
|:---|:---|:---|
| **Tier 1: Restricted / ePHI** | Prescriptions, Medical Reasons, Clinical Notes, Diagnosis | Encrypted at rest (AES-256), TLS 1.3 in transit, strict RBAC + Record-Level Ownership guards, redacted from all logs. |
| **Tier 2: Confidential / PII** | Patient Name, Email, Phone, Doctor License Number, User Passwords | Passwords hashed with bcrypt (salt rounds = 10), email normalized and indexed, masked in logs. |
| **Tier 3: Internal / Operational**| Audit Logs, Idempotency Keys, Outbox Events, Payments metadata | Immutable append-only write pattern, 90-day retention policies, indexed for forensic analysis. |
| **Tier 4: Public** | Doctor Specialization, Bio, Verified Status, Consultation Fee | Public read endpoints with rate limiting and CDN caching. |

---

## 3. STRIDE Threat Analysis & Mitigations

### 1. Spoofing Identity
- **Threat:** Attacker impersonates a patient, doctor, or administrator.
- **Mitigation:**
  - JWT tokens signed with HMAC-SHA256 and verified on every protected request.
  - Expiration timestamps enforced (`24h` TTL).
  - Passwords salted and hashed with `bcryptjs`.
  - Rate limiting on `/auth/login` (maximum 20 attempts per 15 minutes) prevents brute-force credential stuffing.

### 2. Tampering with Data
- **Threat:** Attacker intercepts and modifies a booking, prescription, or payment webhook payload.
- **Mitigation:**
  - End-to-end TLS 1.3 encryption in transit.
  - Payment webhooks require HMAC SHA-256 signature verification (`X-Webhook-Signature`) using constant-time comparison (`crypto.timingSafeEqual`) to prevent timing side-channel attacks.
  - Idempotency middleware checks payload hash integrity: reusing an idempotency key with a tampered body triggers `409 Conflict`.

### 3. Repudiation
- **Threat:** A doctor claims they did not prescribe a medication, or a patient claims they did not cancel an appointment.
- **Mitigation:**
  - `audit_logs` table records every critical action with `actorId`, `action`, `resourceType`, `resourceId`, `ipAddress`, `userAgent`, and `timestamp`.
  - Clinical records (prescriptions) have foreign keys tying them permanently to the issuing doctor and patient.

### 4. Information Disclosure (Broken Object Level Authorization - BOLA)
- **Threat:** Patient A inspects network traffic and alters the booking ID to fetch Patient B's medical consultation or prescription details (`GET /api/v1/bookings/:id` or `GET /api/v1/consultations/:id/prescription`).
- **Mitigation:**
  - Enforced Record-Level Authorization in `bookings.service.js` and `consultations.service.js`:
    ```js
    const isPatient = consultation.patientId === requestingUser.id;
    const isDoctor = consultation.doctor.userId === requestingUser.id;
    const isAdmin = requestingUser.role === 'ADMIN';

    if (!isPatient && !isDoctor && !isAdmin) {
      throw new AppError('Forbidden: You do not have permission to view this record', 403, 'FORBIDDEN');
    }
    ```
  - Cross-patient unauthorized access triggers immediate 403 Forbidden.

### 5. Denial of Service (DoS)
- **Threat:** Malicious actor floods booking or auth endpoints with traffic.
- **Mitigation:**
  - Two-tier rate limiting using `express-rate-limit`: global rate limiter (1,000 req/15 min) and auth limiter (20 req/15 min).
  - Request body parser payload size limited to 2 MB (`express.json({ limit: '2mb' })`).
  - Database timeouts prevent long-running queries from exhausting connection pools.

### 6. Elevation of Privilege (Broken Function Level Authorization - BFLA)
- **Threat:** A registered patient invokes doctor endpoints (e.g. creating availability slots, issuing prescriptions) or admin analytics.
- **Mitigation:**
  - Role-Based Access Control middleware: `authorize('DOCTOR')`, `authorize('ADMIN')`.
  - Doctor slots can only be created by the verified doctor who owns the profile (`doctor.userId === requestingUser.id`).

---

## 4. OWASP API Security Top 10 (2023) Coverage Matrix

| OWASP API Risk | Platform Defense |
|:---|:---|
| **API1:2023 - Broken Object Level Authorization** | Enforced record-level ownership checks across bookings, consultations, and prescriptions. Verified via automated integration tests. |
| **API2:2023 - Broken Authentication** | Strong password policy with Zod regex (min 8 chars, uppercase, digits), bcrypt salt rounds, secure JWT Bearer authorization. |
| **API3:2023 - Broken Object Property Level Auth** | Strict Zod schemas sanitize all incoming payloads; unauthorized fields are discarded or rejected. |
| **API4:2023 - Unrestricted Resource Consumption** | Global and per-route rate limiters, pagination defaults (`page=1`, `limit=20`, max 100). |
| **API5:2023 - Broken Function Level Authorization** | RBAC middleware (`authorize('DOCTOR', 'ADMIN')`) guards doctor and admin endpoints. |
| **API6:2023 - Unrestricted Access to Sensitive Business Flows**| Double-booking prevented via database row locks; mutations require `Idempotency-Key` headers. |
| **API7:2023 - Server Side Request Forgery (SSRF)** | No arbitrary external URL fetching; webhooks only accepted from pre-registered gateway endpoints. |
| **API8:2023 - Security Misconfiguration** | Helmet security headers enabled, CORS restricted, debug logs disabled in production, stack traces hidden from client responses. |
| **API9:2023 - Improper Inventory Management** | OpenAPI 3.0 specification (`openapi.yaml`) documents all active routes and versioning (`/api/v1`). |
| **API10:2023 - Unsafe Consumption of APIs** | Webhook payloads validated with Zod, HMAC verified with constant-time equality check, and deduplicated against replay attacks. |

---

## 5. Encryption & Key Management

1. **Encryption in Transit**:
   - TLS 1.3 enforced across all public endpoints with strong cipher suites (ECDHE-ECDSA-AES128-GCM-SHA256).
2. **Encryption at Rest**:
   - PostgreSQL storage volumes encrypted using AES-256 via LUKS/AWS KMS.
3. **Secret Storage**:
   - Zero hardcoded secrets in source code. All secrets injected via environment variables (`JWT_SECRET`, `PAYMENT_WEBHOOK_SECRET`, `DATABASE_URL`).
4. **Key Rotation Lifecycle**:
   - JWT secrets and webhook secrets support dual-key rotation during maintenance windows without invalidating active sessions.
