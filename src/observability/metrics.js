import client from 'prom-client';

// Collect standard node runtime metrics
const register = new client.Registry();
client.collectDefaultMetrics({ register, prefix: 'amrutam_' });

// HTTP Request Duration Histogram
export const httpRequestDurationSeconds = new client.Histogram({
  name: 'amrutam_http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [0.01, 0.05, 0.1, 0.2, 0.3, 0.5, 1, 2, 5], // 10ms to 5s, covers p95 < 200ms reads and < 500ms writes
  registers: [register],
});

// HTTP Requests Counter
export const httpRequestsTotal = new client.Counter({
  name: 'amrutam_http_requests_total',
  help: 'Total number of HTTP requests made',
  labelNames: ['method', 'route', 'status_code'],
  registers: [register],
});

// Business Metrics: Booking Conflicts (Double booking attempts detected & prevented)
export const bookingConflictsTotal = new client.Counter({
  name: 'amrutam_booking_conflicts_total',
  help: 'Total number of concurrent booking conflicts prevented',
  registers: [register],
});

// Business Metrics: Idempotency hits
export const idempotencyHitsTotal = new client.Counter({
  name: 'amrutam_idempotency_hits_total',
  help: 'Total number of duplicate requests served from idempotency store',
  labelNames: ['endpoint'],
  registers: [register],
});

// Middleware to track HTTP metrics
export const metricsMiddleware = (req, res, next) => {
  const start = process.hrtime();

  res.on('finish', () => {
    const diff = process.hrtime(start);
    const durationInSeconds = diff[0] + diff[1] / 1e9;
    
    // Normalize path to avoid high cardinality route labels
    const route = req.baseUrl || req.path || 'unknown';
    const statusCode = res.statusCode ? res.statusCode.toString() : 'unknown';

    httpRequestDurationSeconds.observe(
      { method: req.method, route, status_code: statusCode },
      durationInSeconds
    );
    httpRequestsTotal.inc({
      method: req.method,
      route,
      status_code: statusCode,
    });
  });

  next();
};

export { register };
