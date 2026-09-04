import { DateTime } from 'luxon';
import { PolicyEngine } from '../src/guardrails/policyEngine';
import { DiagnosticClassifier } from '../src/agent/diagnosticClassifier';
import { RecoveryAgent } from '../src/agent/recoveryAgent';
import { RazorpayLinkService } from '../src/integrations/razorpayLink';
import { WhatsAppService } from '../src/integrations/whatsapp';
import { assignCohort } from '../src/recovery/cohort';

async function runUnitTests() {
  console.log('=====================================================');
  console.log('🧪 RUNNING UNIT & COMPONENT TESTS: razorpay-recover');
  console.log('=====================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, testName: string) {
    if (condition) {
      console.log(`✅ [PASS] ${testName}`);
      passed++;
    } else {
      console.error(`❌ [FAIL] ${testName}`);
      failed++;
    }
  }

  // 1. Policy Engine: Max Attempts
  console.log('--- 1. Testing PolicyEngine: Max Attempts ---');
  const attemptCheck1 = PolicyEngine.evaluate({
    attemptsCount: 3,
    originalAmount: 1000,
    proposedDiscountPercent: 5
  });
  assert(attemptCheck1.allowed === false, 'Attempts >= 3 is disallowed');
  assert(attemptCheck1.status === 'HALTED_EXHAUSTED', 'Status is HALTED_EXHAUSTED');

  // 2. Policy Engine: TRAI Quiet Hours
  console.log('\n--- 2. Testing PolicyEngine: TRAI Quiet Hours (9 PM - 9 AM IST) ---');
  const quietTime = DateTime.fromObject({ hour: 22, minute: 30 }, { zone: 'Asia/Kolkata' });
  const dayTime = DateTime.fromObject({ hour: 14, minute: 0 }, { zone: 'Asia/Kolkata' });

  const quietCheck = PolicyEngine.evaluate({
    attemptsCount: 0,
    originalAmount: 1000,
    proposedDiscountPercent: 5,
    customCheckTimeIST: quietTime
  });
  assert(quietCheck.allowed === false, 'Blocked during 10:30 PM IST');
  assert(quietCheck.status === 'DEFERRED', 'Status is DEFERRED during quiet hours (wake later, do not discard)');
  assert(quietCheck.nextRetryAt instanceof Date, 'Quiet hours include a wake-up timestamp');

  const dayCheck = PolicyEngine.evaluate({
    attemptsCount: 0,
    originalAmount: 1000,
    proposedDiscountPercent: 5,
    customCheckTimeIST: dayTime
  });
  assert(dayCheck.allowed === true, 'Allowed during 2:00 PM IST');
  assert(dayCheck.status === 'INTERVENING', 'Status is INTERVENING during day hours');

  // 3. Policy Engine: Max 5% Discount Cap
  console.log('\n--- 3. Testing PolicyEngine: Max 5% Discount Cap ---');
  const discountCheck = PolicyEngine.evaluate({
    attemptsCount: 0,
    originalAmount: 2000,
    proposedDiscountPercent: 15, // Requested 15%
    customCheckTimeIST: dayTime
  });
  assert(discountCheck.approvedDiscountPercent === 5.0, 'Discount capped at 5%');
  assert(discountCheck.approvedDiscountAmount === 100.0, 'Discount amount capped at ₹100 for ₹2000');

  // 4. Diagnostic Classifier
  console.log('\n--- 4. Testing DiagnosticClassifier ---');
  const bankDiag = await DiagnosticClassifier.classify({
    errorCode: 'GATEWAY_ERROR',
    errorSource: 'bank'
  });
  assert(bankDiag.category === 'BANK_NETWORK_ERROR', 'Bank gateway classified as BANK_NETWORK_ERROR');
  assert(bankDiag.recommendedDiscountPercent === 0, 'Bank error receives 0% discount');

  const custDiag = await DiagnosticClassifier.classify({
    errorCode: 'BAD_REQUEST_ERROR',
    errorDescription: 'Payment cancelled by user',
    errorSource: 'customer'
  });
  assert(custDiag.category === 'CUSTOMER_ERROR', 'User drop classified as CUSTOMER_ERROR');
  assert(custDiag.recommendedDiscountPercent === 5.0, 'Customer drop receives 5% discount recommendation');
  const nsfDiag = await DiagnosticClassifier.classify({
    errorCode: 'INSUFFICIENT_FUNDS',
    errorDescription: 'Not enough balance',
    errorSource: 'customer'
  });
  assert(nsfDiag.strategy === 'INSUFFICIENT_FUNDS_DEFERRED', 'NSF classified as deferred strategy');
  assert(nsfDiag.recommendedDiscountPercent === 0, 'NSF receives 0% discount');

  const fraudDiag = await DiagnosticClassifier.classify({
    errorCode: 'FRAUD_CHECK',
    errorDescription: 'suspicious activity flagged',
    errorSource: 'issuer'
  });
  assert(fraudDiag.strategy === 'FRAUD_DECLINE_NO_RETRY', 'Fraud is a no-retry halt');

  // 5. Razorpay Dynamic Payment Link Service
  console.log('\n--- 5. Testing RazorpayLinkService ---');
  const linkResult = await RazorpayLinkService.createDiscountedLink({
    orderId: 'ord_test_unit_1',
    originalAmount: 1000,
    discountedAmount: 950,
    customerPhone: '+919876543210',
    recoveryTxId: '00000000-0000-0000-0000-000000000001'
  });
  assert(typeof linkResult.shortUrl === 'string' && linkResult.shortUrl.length > 0, 'Payment link generated');
  assert(linkResult.amount === 950, 'Payment link uses discounted amount');

  // 6. Recovery Agent Copy Generation
  console.log('\n--- 6. Testing RecoveryAgent Copy Generation ---');
  const copyResult = await RecoveryAgent.generateCopy({
    customerPhone: '+919876543210',
    originalAmount: 1000,
    discountedAmount: 950,
    discountPercent: 5,
    failureCategory: 'CUSTOMER_ERROR',
    failureReason: 'payment_cancelled',
    paymentLink: linkResult.shortUrl,
    orderId: 'ord_test_unit_1',
    strategy: 'CUSTOMER_DROP_INCENTIVE_5_PERCENT',
    lossMode: 'PAYMENT_FAILED'
  });
  assert(copyResult.message.includes('₹950') || copyResult.message.includes('5%'), 'Copy mentions discount details');
  assert(copyResult.message.includes(linkResult.shortUrl), 'Copy includes CTA link');

  // 7. WhatsApp Service Nudge Dispatch
  console.log('\n--- 7. Testing WhatsAppService Nudge Dispatch ---');
  const whatsappResult = await WhatsAppService.sendNudge({
    toPhone: '+919876543210',
    message: copyResult.message
  });
  assert(whatsappResult.success === true, 'WhatsApp nudge dispatch executed successfully');
  assert(whatsappResult.recipient === 'whatsapp:+919876543210', 'WhatsApp recipient formatted correctly');

  // 8. Holdout assignment
  console.log('\n--- 8. Testing holdout cohort assignment ---');
  assert(assignCohort('pay_x', 'holdout') === 'holdout', 'Forced holdout is respected');
  assert(assignCohort('pay_x', 'treated') === 'treated', 'Forced treated is respected');
  assert(assignCohort('pay_stable_id') === assignCohort('pay_stable_id'), 'Hash cohort is deterministic');

  console.log('\n=====================================================');
  console.log(`Test Summary: Passed: ${passed}, Failed: ${failed}`);
  console.log('=====================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

runUnitTests().catch((err) => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
