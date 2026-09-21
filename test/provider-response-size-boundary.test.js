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

const oversizedBody = JSON.stringify({
  id: 'provider_reference_12345678',
  result: { code: '000.000.000', description: 'success' },
  padding: 'x'.repeat(256 * 1024)
});

function oversizedFetch({ advertised = false } = {}) {
  return async () => ({
    ok: true,
    headers: { get: (name) => advertised && name.toLowerCase() === 'content-length' ? String(Buffer.byteLength(oversizedBody)) : null },
    text: async () => oversizedBody
  });
}

for (const advertised of [true, false]) {
  test(`oversized HyperPay response fails closed (${advertised ? 'content-length' : 'actual body'})`, async () => {
    const provider = getPaymentProvider(env, oversizedFetch({ advertised }));
    await assert.rejects(
      provider.verifyPayment({ checkoutId: 'checkout_reference_12345678' }),
      (error) => error?.code === 'HYPERPAY_RESPONSE_TOO_LARGE' && error?.statusCode === 502
    );
  });
}
