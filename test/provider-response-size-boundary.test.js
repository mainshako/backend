import test from 'node:test';
import assert from 'node:assert/strict';
import { getPaymentProvider, PaymentProviderError } from '../src/services/payment-provider.js';

const env = {
  PAYMENT_PROVIDER: 'hyperpay',
  HYPERPAY_ENABLED: 'true',
  HYPERPAY_BASE_URL: 'https://eu-test.oppwa.com',
  HYPERPAY_ACCESS_TOKEN: 'sandbox-test-token',
  HYPERPAY_ENTITY_ID: 'sandbox-test-entity'
};

const oversizedLength = String(256 * 1024 + 1);
const oversizedBody = JSON.stringify({
  id: 'provider_reference_12345678',
  result: { code: '000.000.000', description: 'success' },
  padding: 'x'.repeat(256 * 1024)
});

for (const [name, invoke] of [
  ['create', provider => provider.createPayment({ amount: 10, currency: 'ILS', merchantTransactionId: 'order_12345678' })],
  ['verify', provider => provider.verifyPayment({ checkoutId: 'checkout_12345678' })],
  ['refund', provider => provider.refundPayment({ paymentId: 'payment_12345678', amount: 10, currency: 'ILS' })]
]) {
  test(`${name} fails closed on oversized provider response before reading body`, async () => {
    let bodyReads = 0;
    const provider = getPaymentProvider(env, async () => ({
      ok: true,
      headers: { get: key => key.toLowerCase() === 'content-length' ? oversizedLength : null },
      text: async () => {
        bodyReads += 1;
        throw new Error('oversized body must not be read');
      }
    }));

    await assert.rejects(
      invoke(provider),
      error => error instanceof PaymentProviderError && error.code === 'HYPERPAY_RESPONSE_TOO_LARGE' && error.statusCode === 502
    );
    assert.equal(bodyReads, 0);
  });

  test(`${name} fails closed on oversized provider response without content-length`, async () => {
    let bodyReads = 0;
    const provider = getPaymentProvider(env, async () => ({
      ok: true,
      headers: { get: () => null },
      text: async () => {
        bodyReads += 1;
        return oversizedBody;
      }
    }));

    await assert.rejects(
      invoke(provider),
      error => error instanceof PaymentProviderError && error.code === 'HYPERPAY_RESPONSE_TOO_LARGE' && error.statusCode === 502
    );
    assert.equal(bodyReads, 1);
  });
}
