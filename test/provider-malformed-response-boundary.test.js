import test from 'node:test';
import assert from 'node:assert/strict';
import { getPaymentProvider } from '../src/services/payment-provider.js';

const env = {
  PAYMENT_PROVIDER: 'hyperpay',
  HYPERPAY_ENABLED: 'true',
  HYPERPAY_BASE_URL: 'https://eu-test.oppwa.com',
  HYPERPAY_ACCESS_TOKEN: 'sandbox-token',
  HYPERPAY_ENTITY_ID: 'sandbox-entity'
};

function malformedFetch() {
  return async () => ({
    ok: true,
    headers: { get: () => null },
    text: async () => '<html>not-json</html>'
  });
}

const operations = [
  ['create', (provider) => provider.createPayment({ amount: 10, currency: 'ILS', merchantTransactionId: 'order_malformed_123' })],
  ['verify', (provider) => provider.verifyPayment({ checkoutId: 'checkout_malformed_123' })],
  ['refund', (provider) => provider.refundPayment({ paymentId: 'payment_malformed_123', amount: 10, currency: 'ILS' })]
];

for (const [name, invoke] of operations) {
  test(`HyperPay ${name} malformed successful HTTP response fails closed`, async () => {
    const provider = getPaymentProvider(env, malformedFetch());
    await assert.rejects(
      invoke(provider),
      (error) => error?.code === 'HYPERPAY_REQUEST_FAILED' && error?.statusCode === 502
    );
  });
}
