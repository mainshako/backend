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

function jsonFetch(body) {
  return async () => ({
    ok: true,
    headers: { get: () => null },
    text: async () => JSON.stringify(body)
  });
}

test('HyperPay checkout-created response without a provider reference fails closed', async () => {
  const provider = getPaymentProvider(env, jsonFetch({ result: { code: '000.200.100' } }));
  await assert.rejects(
    provider.createPayment({ amount: 10, currency: 'ILS', merchantTransactionId: 'order_missing_ref_123' }),
    (error) => error?.code === 'HYPERPAY_INVALID_RESPONSE' && error?.statusCode === 502
  );
});

for (const [name, invoke] of [
  ['verify', (provider) => provider.verifyPayment({ checkoutId: 'checkout_missing_ref_123' })],
  ['refund', (provider) => provider.refundPayment({ paymentId: 'payment_missing_ref_123', amount: 10, currency: 'ILS' })]
]) {
  test(`HyperPay ${name} successful result without a provider reference fails closed`, async () => {
    const provider = getPaymentProvider(env, jsonFetch({ result: { code: '000.000.000' } }));
    await assert.rejects(
      invoke(provider),
      (error) => error?.code === 'HYPERPAY_INVALID_RESPONSE' && error?.statusCode === 502
    );
  });
}
