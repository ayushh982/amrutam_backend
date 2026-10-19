# Amrutam Telemedicine Backend: Security Checklist & RBAC Matrix

---

## 1. Security Controls Verification Checklist

- [x] **Password Security**: Passwords hashed using `bcrypt` (10 salt rounds). Minimum 8 characters with at least one uppercase letter and one numeric character. Plaintext passwords never stored or logged.
- [x] **Authentication**: Stateless JWT Bearer tokens signed with HMAC-SHA256. Expiration enforced (`24h`).
- [x] **Role-Based Access Control (RBAC)**: Enforced via `authorize(...allowedRoles)` middleware with roles: `PATIENT`, `DOCTOR`, `ADMIN`.
- [x] **Record-Level Ownership (BOLA Prevention)**: Consultations and prescriptions verify that the requesting user is either the assigned doctor, the patient owner, or an administrator.
- [x] **Input Validation**: All query parameters, route parameters, and request bodies validated using strict `Zod` schemas.
- [x] **Security Headers**: `Helmet` enabled for MIME sniffing prevention, XSS filtering, HSTS, and frameguard protection.
- [x] **Rate Limiting**: Tiered rate limiting with `express-rate-limit` (1,000 req/15 min global; 20 req/15 min auth).
- [x] **Idempotency Protection**: Mutating operations (`POST /bookings`, `POST /payments`) require `Idempotency-Key` headers to prevent duplicate executions.
- [x] **Webhook Security**: Payment webhooks validated using HMAC SHA-256 signatures with constant-time equality check (`crypto.timingSafeEqual`) and deduplicated via `webhook_events` table.
- [x] **Audit Logging**: Sensitive operations recorded in `audit_logs` with actor ID, IP address, user agent, action, and outcome.
- [x] **Safe Error Responses**: Internal stack traces and database error codes suppressed in non-development environments.
- [x] **Log Redaction**: Pino configured to automatically redact passwords, tokens, authorization headers, and medical notes.

---

## 2. Role-Based Access Control (RBAC) Matrix

| Endpoint | HTTP Method | Public | PATIENT | DOCTOR | ADMIN | Authorization Rule |
|:---|:---:|:---:|:---:|:---:|:---:|:---|
| `/api/v1/auth/register` | POST | Yes | Yes | Yes | Yes | Open registration for patients and doctors. |
| `/api/v1/auth/login` | POST | Yes | Yes | Yes | Yes | Open login with credentials. |
| `/api/v1/users/me` | GET | No | Yes | Yes | Yes | Authenticated user retrieves own profile. |
| `/api/v1/doctors` | GET | Yes | Yes | Yes | Yes | Search & filter verified doctor directory. |
| `/api/v1/doctors/:id` | GET | Yes | Yes | Yes | Yes | View public doctor profile and slots. |
| `/api/v1/doctors/profile` | PATCH | No | No | Yes | Yes | Doctor updates their own clinical profile. |
| `/api/v1/doctors/:id/slots` | GET | Yes | Yes | Yes | Yes | View doctor's open availability slots. |
| `/api/v1/doctors/:id/slots` | POST | No | No | Yes | Yes | Doctor creates availability slots (own profile only). |
| `/api/v1/doctors/:id/slots/:slotId` | DELETE | No | No | Yes | Yes | Doctor deletes unbooked availability slot. |
| `/api/v1/bookings` | POST | No | Yes | No | Yes | Patient books consultation slot (requires Idempotency-Key). |
| `/api/v1/bookings` | GET | No | Yes | Yes | Yes | List user's bookings (patient sees own; doctor sees assigned). |
| `/api/v1/bookings/:id` | GET | No | Yes* | Yes* | Yes | Patient owner or assigned doctor only. |
| `/api/v1/bookings/:id/cancel` | PATCH | No | Yes* | Yes* | Yes | Cancel booking; releases slot to AVAILABLE. |
| `/api/v1/consultations/:id` | GET | No | Yes* | Yes* | Yes | View consultation details and notes. |
| `/api/v1/consultations/:id/status`| PATCH | No | No | Yes* | Yes | Doctor updates lifecycle (BOOKED -> IN_PROGRESS -> COMPLETED). |
| `/api/v1/consultations/:id/prescriptions` | POST | No | No | Yes* | Yes | Assigned doctor creates digital prescription. |
| `/api/v1/consultations/:id/prescription` | GET | No | Yes* | Yes* | Yes | Patient owner or assigned doctor retrieves prescription. |
| `/api/v1/payments` | POST | No | Yes* | No | Yes | Patient initiates payment for booked consultation. |
| `/api/v1/payments/webhook` | POST | Yes* | - | - | - | Gateway webhook endpoint; HMAC signature required. |
| `/api/v1/admin/analytics` | GET | No | No | No | Yes | Admin view platform metrics and revenue. |
| `/api/v1/admin/audit-logs` | GET | No | No | No | Yes | Admin view security and clinical audit trails. |
| `/api/v1/admin/doctors/:id/verify`| PATCH | No | No | No | Yes | Admin verifies doctor credentials. |

*\* Indicates record-level ownership check enforced in addition to role.*

---

## 3. Audit Log Specifications

The `audit_logs` table stores an immutable log of critical operations:

```sql
CREATE TABLE audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_id UUID REFERENCES users(id) ON DELETE SET NULL,
    action VARCHAR(100) NOT NULL,
    resource_type VARCHAR(50) NOT NULL,
    resource_id VARCHAR(100),
    outcome VARCHAR(20) NOT NULL, -- 'SUCCESS' | 'FAILURE'
    ip_address VARCHAR(45),
    user_agent VARCHAR(255),
    details JSONB,
    timestamp TIMESTAMPTZ DEFAULT NOW() NOT NULL
);
```

### Audited Actions Catalog:
- `USER_REGISTERED`
- `USER_LOGIN_SUCCESS` / `USER_LOGIN_FAILED`
- `BOOKING_CREATED`
- `BOOKING_CANCELLED`
- `CONSULTATION_STATUS_IN_PROGRESS` / `CONSULTATION_STATUS_COMPLETED`
- `PRESCRIPTION_CREATED`
- `PAYMENT_INITIATED`
- `PAYMENT_WEBHOOK_PROCESSED` / `PAYMENT_WEBHOOK_VERIFICATION_FAILED`
- `DOCTOR_VERIFICATION_VERIFIED` / `DOCTOR_VERIFICATION_REJECTED`
