// Loaded before any test file (node --require). It points the app at the TEST
// database and switches off every real external service, so tests are fast,
// deterministic and can never message a real customer.
//
// This must run before src/config/env.ts is imported: env.ts reads
// process.env once at import time, and dotenv never overrides a variable that
// is already set, so these values win over anything in your .env file.
if (!process.env.TEST_DATABASE_URL) {
  console.error('TEST_DATABASE_URL is not set. Point it at a throwaway database, e.g.');
  console.error('  postgresql://postgres:postgres@localhost:5432/razor_recover_test');
  process.exit(1);
}

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.NODE_ENV = 'test';                         // classifier skips Groq; no TRAI quiet hours
process.env.GROQ_API_KEY = '';                         // copy falls back to the built-in template
process.env.OPENAI_API_KEY = '';
process.env.RAZORPAY_KEY_ID = 'rzp_test_placeholder';  // payment links are mocked
process.env.RAZORPAY_KEY_SECRET = 'rzp_secret_placeholder';
process.env.RAZORPAY_WEBHOOK_SECRET = 'test_webhook_secret_12345';
process.env.TWILIO_ACCOUNT_SID = '';
process.env.TWILIO_AUTH_TOKEN = '';