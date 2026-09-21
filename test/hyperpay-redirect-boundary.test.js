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

test('HyperPay sandbox requests refuse redirects for checkout, verification, and refunds', async () => {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    const isCheckoutCreate = String(url).endsWith('/v1/checkouts');
    return new Response(JSON.stringify(isCheckoutCreate
      ? { id: 'checkout_12345678', result: { code: '000.200.100' } }
      : { id: 'payment_12345678', result: { code: '999.999.999' } }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  const provider = getPaymentProvider(configured, fetchImpl);
  await provider.createPayment({ amount: 10, currency: 'ILS', merchantTransactionId: 'order-1' });
  await provider.verifyPayment({ checkoutId: 'checkout_12345678' });
  await provider.refundPayment({ paymentId: 'payment_12345678', amount: 10, currency: 'ILS' });

  assert.equal(calls.length, 3);
  for (const call of calls) {
    assert.equal(call.options.redirect, 'error');
    assert.ok(call.url.startsWith('https://eu-test.oppwa.com/'));
  }
});
