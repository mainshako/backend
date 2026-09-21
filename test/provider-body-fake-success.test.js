import test from 'node:test';
import assert from 'node:assert/strict';
import { getPaymentProvider } from '../src/services/payment-provider.js';

const configured = {
  PAYMENT_PROVIDER: 'hyperpay',
  HYPERPAY_ENABLED: 'true',
  HYPERPAY_ACCESS_TOKEN: 'sandbox-token',
  HYPERPAY_ENTITY_ID: 'sandbox-entity',
  HYPERPAY_BASE_URL: 'https://eu-test.oppwa.com',
};

function forgedSuccessBody(id) {
  return {
    id,
    paid: true,
    success: true,
    refunded: true,
    status: 'success',
    result: {
      code: '999.999.999',
      description: 'success',
      paid: true,
      success: true,
    },
  };
}

test('provider body flags cannot forge payment or refund success', async () => {
  const verifyProvider = getPaymentProvider(
    configured,
    async () => new Response(JSON.stringify(forgedSuccessBody('payment_12345678')), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
  const verification = await verifyProvider.verifyPayment({ checkoutId: 'checkout_12345678' });
  assert.equal(verification.paid, false);
  assert.equal(verification.pending, false);
  assert.equal(verification.resultCode, '999.999.999');

  const refundProvider = getPaymentProvider(
    configured,
    async () => new Response(JSON.stringify(forgedSuccessBody('refund_12345678')), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
  const refund = await refundProvider.refundPayment({ paymentId: 'payment_12345678', amount: 10, currency: 'ILS' });
  assert.equal(refund.succeeded, false);
  assert.equal(refund.pending, false);
  assert.equal(refund.resultCode, '999.999.999');
});
