# Amrutam Telemedicine Booking Sequence Diagrams

This document details the exact sequence of interactions for critical workflows in the Amrutam Telemedicine platform, demonstrating race condition handling, idempotency deduplication, and payment webhook verification.

## 1. Concurrent Booking Flow (Simultaneous Attempts)

The diagram below shows how the platform prevents double bookings when two patients attempt to book the same slot at the exact same millisecond.

```mermaid
sequenceDiagram
    autonumber
    actor PatientA as Patient A
    actor PatientB as Patient B
    participant API as Express API Gateway
    participant Idemp as Idempotency Engine
    participant DB as PostgreSQL Transaction Engine

    Note over PatientA, PatientB: Both patients hit POST /api/v1/bookings simultaneously with identical slotId

    PatientA->>API: POST /bookings (Slot X, Idemp-Key A)
    PatientB->>API: POST /bookings (Slot X, Idemp-Key B)

    API->>Idemp: Reserve Idemp-Key A
    API->>Idemp: Reserve Idemp-Key B
    Idemp-->>API: Key A Reserved (PENDING)
    Idemp-->>API: Key B Reserved (PENDING)

    par Transaction A (Acquires Row Lock First)
        API->>DB: BEGIN TX
        API->>DB: UPDATE availability_slots SET status='BOOKED'<br/>WHERE id='Slot X' AND status='AVAILABLE'
        Note right of DB: Status is AVAILABLE -> Updated 1 row.<br/>Slot X locked by TX A.
        API->>DB: INSERT INTO consultations (patient_id, slot_id='Slot X', status='BOOKED')
        API->>DB: INSERT INTO outbox_events (BOOKING_CREATED)
        API->>DB: COMMIT TX
        DB-->>API: Commit OK (Consultation C1 created)
        API->>Idemp: Store Response (201 Created)
        API-->>PatientA: 201 Created (Consultation C1 Confirmed)
    and Transaction B (Evaluates After Row Lock Released)
        API->>DB: BEGIN TX
        API->>DB: UPDATE availability_slots SET status='BOOKED'<br/>WHERE id='Slot X' AND status='AVAILABLE'
        Note right of DB: Status is now BOOKED -> Updated 0 rows!<br/>Atomic check detects conflict.
        API->>DB: ROLLBACK TX
        DB-->>API: Rollback OK
        API->>API: Increment booking_conflicts_total metric
        API->>Idemp: Clear Pending Key B
        API-->>PatientB: 409 Conflict ("SLOT_ALREADY_BOOKED")
    end
```

---

## 2. Idempotency Flow (Network Retries & Cached Responses)

This diagram details the client retry flow where network timeouts or duplicate submissions occur.

```mermaid
sequenceDiagram
    autonumber
    actor Client
    participant API as Express Router
    participant Idemp as Idempotency Store
    participant Service as Booking Service
    participant DB as PostgreSQL

    Client->>API: POST /api/v1/bookings<br/>Header: Idempotency-Key: "uuid-abc-123"<br/>Body: { slotId, reason }
    
    API->>Idemp: Check "uuid-abc-123"
    alt Key not in store (First request)
        Idemp-->>API: Miss
        API->>Idemp: Record key with request hash & 24h TTL
        API->>Service: Execute booking creation
        Service->>DB: Atomic transaction
        DB-->>Service: Created consultation
        Service-->>API: Return Consultation Data
        API->>Idemp: Update key with status=201, cached body
        API-->>Client: 201 Created (Consultation Data)
    else Key exists with same hash & response cached (Safe Retry)
        Idemp-->>API: HIT (responseStatus=201, cachedBody)
        API->>API: Increment amrutam_idempotency_hits_total
        API-->>Client: 201 Created (Header: X-Cache-Lookup: HIT-IDEMPOTENT)
        Note over Client, DB: Zero database write operations executed on retry!
    else Key exists with DIFFERENT payload (Conflicting Reuse)
        Idemp-->>API: Payload mismatch
        API-->>Client: 409 Conflict ("IDEMPOTENCY_KEY_PAYLOAD_MISMATCH")
    end
```

---

## 3. Verified Payment Webhook Flow

```mermaid
sequenceDiagram
    autonumber
    participant Gateway as Mock Payment Provider
    participant API as /api/v1/payments/webhook
    participant Crypto as HMAC Verification
    participant DB as PostgreSQL

    Gateway->>API: POST /webhook<br/>Header: X-Webhook-Signature: "hex_sig"<br/>Body: { eventId: "evt_99", eventType: "payment.succeeded", data }

    API->>Crypto: timingSafeEqual(HMAC_SHA256(rawBody, secret), hex_sig)
    alt Signature Invalid
        Crypto-->>API: Invalid
        API-->>Gateway: 401 Unauthorized ("INVALID_WEBHOOK_SIGNATURE")
    else Signature Valid
        Crypto-->>API: Valid
        API->>DB: Check webhook_events for eventId="evt_99"
        alt Event already exists (Duplicate webhook delivery)
            DB-->>API: Found existing event (PROCESSED)
            API-->>Gateway: 200 OK ({ duplicate: true, received: true })
        else Event is new
            DB-->>API: Not found
            API->>DB: BEGIN TX
            API->>DB: INSERT INTO webhook_events (eventId="evt_99", status="RECEIVED")
            API->>DB: UPDATE payments SET status="COMPLETED" WHERE id=paymentId
            API->>DB: UPDATE webhook_events SET status="PROCESSED"
            API->>DB: INSERT INTO outbox_events (PAYMENT_COMPLETED)
            API->>DB: COMMIT TX
            API-->>Gateway: 200 OK ({ duplicate: false, paymentStatus: "COMPLETED" })
        end
    end
```
