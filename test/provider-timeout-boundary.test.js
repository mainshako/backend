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

function timeoutFetch() {
  return async () => {
    const error = new Error('simulated provider timeout');
    error.name = 'TimeoutError';
    throw error;
  };
}

const operations = [
  ['create', (provider) => provider.createPayment({ amount: 10, currency: 'ILS', merchantTransactionId: 'order_timeout_123' })],
  ['verify', (provider) => provider.verifyPayment({ checkoutId: 'checkout_timeout_123' })],
  ['refund', (provider) => provider.refundPayment({ paymentId: 'payment_timeout_123', amount: 10, currency: 'ILS' })]
];

for (const [name, invoke] of operations) {
  test(`HyperPay ${name} timeout fails closed without reporting success`, async () => {
    const provider = getPaymentProvider(env, timeoutFetch());
    await assert.rejects(
      invoke(provider),
      (error) => error?.code === 'HYPERPAY_REQUEST_TIMEOUT' && error?.statusCode === 504
    );
  });
}
