process.env.NODE_ENV = 'test';
process.env.USE_MOCK_DB = 'true';
process.env.JWT_SECRET = 'test-secret-key-for-testing-purpose-only-32';
process.env.PAYMENT_WEBHOOK_SECRET = 'test_webhook_secret_key_12345';
process.env.LOG_LEVEL = 'fatal'; // suppress noisy logs during test run
