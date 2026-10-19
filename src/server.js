import app from './app.js';
import { env } from './config/env.js';
import { logger } from './observability/logger.js';
import { prisma } from './database/prisma.js';

const PORT = env.PORT || 3000;

const server = app.listen(PORT, () => {
  logger.info(`Amrutam Telemedicine Backend running on port ${PORT} [${env.NODE_ENV}]`);
  logger.info(`Swagger UI Docs available at http://localhost:${PORT}/docs`);
  logger.info(`Prometheus Metrics available at http://localhost:${PORT}/metrics`);
});

// Graceful Shutdown
const handleShutdown = async (signal) => {
  logger.info(`Received ${signal}, initiating graceful shutdown...`);

  server.close(async () => {
    logger.info('HTTP server closed.');
    try {
      await prisma.$disconnect();
      logger.info('Database connection closed.');
      process.exit(0);
    } catch (err) {
      logger.error({ error: err.message }, 'Error during database disconnect.');
      process.exit(1);
    }
  });

  // Force close after 10s timeout
  setTimeout(() => {
    logger.error('Forced shutdown due to timeout.');
    process.exit(1);
  }, 10000).unref();
};

process.on('SIGTERM', () => handleShutdown('SIGTERM'));
process.on('SIGINT', () => handleShutdown('SIGINT'));
