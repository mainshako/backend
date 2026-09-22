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

test('pending HyperPay verification never reports paid and preserves a valid provider reference', async () => {
  const provider = getPaymentProvider(env, jsonFetch({
    id: 'payment_pending_123',
    result: { code: '000.200.000', description: 'pending' }
  }));
  const result = await provider.verifyPayment({ checkoutId: 'checkout_pending_123' });
  assert.equal(result.paid, false);
  assert.equal(result.pending, true);
  assert.equal(result.providerReference, 'payment_pending_123');
});

test('pending HyperPay refund never reports succeeded and preserves a valid provider reference', async () => {
  const provider = getPaymentProvider(env, jsonFetch({
    id: 'refund_pending_123',
    result: { code: '000.200.000', description: 'pending' }
  }));
  const result = await provider.refundPayment({ paymentId: 'payment_original_123', amount: 10, currency: 'ILS' });
  assert.equal(result.succeeded, false);
  assert.equal(result.pending, true);
  assert.equal(result.providerReference, 'refund_pending_123');
});

test('pending HyperPay responses with malformed provider references fail closed', async () => {
  for (const id of ['bad ref', '../payment', 'short']) {
    const verifyProvider = getPaymentProvider(env, jsonFetch({
      id,
      result: { code: '000.200.000', description: 'pending' }
    }));
    await assert.rejects(
      verifyProvider.verifyPayment({ checkoutId: 'checkout_pending_123' }),
      (error) => error?.code === 'HYPERPAY_INVALID_RESPONSE' && error?.statusCode === 502
    );

    const refundProvider = getPaymentProvider(env, jsonFetch({
      id,
      result: { code: '000.200.000', description: 'pending' }
    }));
    await assert.rejects(
      refundProvider.refundPayment({ paymentId: 'payment_original_123', amount: 10, currency: 'ILS' }),
      (error) => error?.code === 'HYPERPAY_INVALID_RESPONSE' && error?.statusCode === 502
    );
  }
});

test('rejected HyperPay results never report payment or refund success', async () => {
  const rejected = {
    id: 'provider_rejected_123',
    result: { code: '800.100.100', description: 'transaction declined' }
  };

  const verifyProvider = getPaymentProvider(env, jsonFetch(rejected));
  const verification = await verifyProvider.verifyPayment({ checkoutId: 'checkout_rejected_123' });
  assert.equal(verification.paid, false);
  assert.equal(verification.pending, false);
  assert.equal(verification.resultCode, '800.100.100');
  assert.equal(verification.providerReference, 'provider_rejected_123');

  const refundProvider = getPaymentProvider(env, jsonFetch(rejected));
  const refund = await refundProvider.refundPayment({ paymentId: 'payment_original_123', amount: 10, currency: 'ILS' });
  assert.equal(refund.succeeded, false);
  assert.equal(refund.pending, false);
  assert.equal(refund.resultCode, '800.100.100');
  assert.equal(refund.providerReference, 'provider_rejected_123');
});
