import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import YAML from 'yaml';
import swaggerUi from 'swagger-ui-express';

import { requestIdMiddleware } from './middleware/request-id.js';
import { globalRateLimiter } from './middleware/rate-limiter.js';
import { errorHandler, AppError } from './middleware/error-handler.js';
import { metricsMiddleware, register } from './observability/metrics.js';
import { prisma } from './database/prisma.js';

import authRoutes from './modules/auth/auth.routes.js';
import usersRoutes from './modules/users/users.routes.js';
import doctorsRoutes from './modules/doctors/doctors.routes.js';
import bookingsRoutes from './modules/bookings/bookings.routes.js';
import consultationsRoutes from './modules/consultations/consultations.routes.js';
import paymentsRoutes from './modules/payments/payments.routes.js';
import adminRoutes from './modules/admin/admin.routes.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// Security Headers & CORS
app.use(
  helmet({
    contentSecurityPolicy: false, // Allows Swagger UI assets
  })
);
app.use(cors());

// Request ID generation & propagation
app.use(requestIdMiddleware);

// Body Parsers (with rawBody capture for webhook signature verification)
app.use(
  express.json({
    limit: '2mb',
    verify: (req, res, buf) => {
      req.rawBody = buf.toString('utf8');
    },
  })
);
app.use(express.urlencoded({ extended: true, limit: '2mb' }));

// Observability & Metrics Middleware
app.use(metricsMiddleware);

// Rate Limiting
app.use(globalRateLimiter);

// Liveness Probe
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'UP',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    version: '1.0.0',
    service: 'amrutam-telemedicine-backend',
  });
});

// Readiness Probe (checks Database connectivity)
app.get('/ready', async (req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.status(200).json({
      status: 'READY',
      database: 'CONNECTED',
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    res.status(503).json({
      status: 'NOT_READY',
      database: 'DISCONNECTED',
      error: error.message,
    });
  }
});

// Prometheus Metrics Endpoint
app.get('/metrics', async (req, res) => {
  try {
    res.setHeader('Content-Type', register.contentType);
    res.send(await register.metrics());
  } catch (err) {
    res.status(500).end(err);
  }
});

// Swagger UI & OpenAPI Specification
try {
  const openapiPath = path.resolve(__dirname, '../openapi.yaml');
  if (fs.existsSync(openapiPath)) {
    const file = fs.readFileSync(openapiPath, 'utf8');
    const swaggerDocument = YAML.parse(file);
    app.use('/docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument));
    app.get('/docs/openapi.yaml', (req, res) => {
      res.setHeader('Content-Type', 'text/yaml');
      res.send(file);
    });
  }
} catch (e) {
  // Swagger load warning
}

// Root Welcome Endpoint
app.get('/', (req, res) => {
  res.status(200).json({
    name: 'Amrutam Telemedicine Backend API',
    version: '1.0.0',
    documentation: '/docs',
    health: '/health',
    metrics: '/metrics',
    apiPrefix: '/api/v1',
  });
});

// API Routes
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/users', usersRoutes);
app.use('/api/v1/doctors', doctorsRoutes);
app.use('/api/v1/bookings', bookingsRoutes);
app.use('/api/v1/consultations', consultationsRoutes);
app.use('/api/v1/payments', paymentsRoutes);
app.use('/api/v1/admin', adminRoutes);

// 404 Route Handler
app.use((req, res, next) => {
  next(new AppError(`Route ${req.method} ${req.originalUrl} not found`, 404, 'ROUTE_NOT_FOUND'));
});

// Centralized Error Handler
app.use(errorHandler);

export default app;
