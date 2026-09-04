import crypto from 'crypto';
import dotenv from 'dotenv';

dotenv.config({ quiet: true }); // suppress dotenv's own promotional console output

const port = process.env.PORT || 4000;
const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET || 'test_webhook_secret_12345';
const webhookUrl = `http://localhost:${port}/webhooks/razorpay`;

async function runTest() {
  console.log('--- Simulating Razorpay payment.failed Webhook ---');
  console.log(`Target URL: ${webhookUrl}`);

  const testPayId = `pay_sim_${Date.now()}`;
  const testOrderId = `order_sim_${Math.floor(100000 + Math.random() * 900000)}`;

  const payload = {
    entity: 'event',
    account_id: 'acc_simulated_merchant',
    event: 'payment.failed',
    contains: ['payment'],
    payload: {
      payment: {
        entity: {
          id: testPayId,
          entity: 'payment',
          amount: 250000, // ₹2,500.00 in paise
          currency: 'INR',
          status: 'failed',
          order_id: testOrderId,
          invoice_id: null,
          international: false,
          method: 'upi',
          amount_refunded: 0,
          refund_status: null,
          captured: false,
          description: 'Payment for Order #' + testOrderId,
          card_id: null,
          bank: null,
          wallet: null,
          vpa: 'customer@upi',
          email: 'sushant.customer@example.com',
          contact: '+919876543210',
          customer_id: 'cust_sim_123',
          token_id: null,
          notes: {
            source: 'checkout_web'
          },
          fee: null,
          tax: null,
          error_code: 'BAD_REQUEST_ERROR',
          error_description: 'Payment failed due to OTP verification timeout by customer',
          error_source: 'customer',
          error_step: 'payment_authentication',
          error_reason: 'payment_authentication_failed',
          created_at: Math.floor(Date.now() / 1000)
        }
      }
    },
    created_at: Math.floor(Date.now() / 1000)
  };

  const rawBody = JSON.stringify(payload);

  // Compute valid HMAC-SHA256 signature
  const signature = crypto
    .createHmac('sha256', webhookSecret)
    .update(rawBody)
    .digest('hex');

  console.log(`Computed HMAC signature: ${signature}`);
  console.log('Sending webhook request...');

  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-razorpay-signature': signature
      },
      body: rawBody
    });

    const data = await response.json();
    console.log(`Response Status: ${response.status} ${response.statusText}`);
    console.log('Response Body:', JSON.stringify(data, null, 2));

    if (response.ok) {
      console.log('Webhook test completed successfully!');
    } else {
      console.error('Webhook returned error status');
    }
  } catch (err: any) {
    console.error('Failed to send webhook request:', err.message);
    console.log('Make sure the server is running on http://localhost:' + port + ' via "npm run dev"');
  }
}

runTest();
