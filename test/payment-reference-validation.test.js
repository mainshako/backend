import test from 'node:test';
import assert from 'node:assert/strict';
import { getPaymentProvider, PaymentProviderError } from '../src/services/payment-provider.js';

const env = {
  PAYMENT_PROVIDER: 'hyperpay',
  HYPERPAY_ENABLED: 'true',
  HYPERPAY_ACCESS_TOKEN: 'sandbox-token',
  HYPERPAY_ENTITY_ID: 'sandbox-entity',
};

const malformedReferences = [
  '',
  'short',
  '../checkout',
  'checkout?id=fake',
  'checkout/../../paid',
  'a'.repeat(201),
];

test('malformed checkout references fail closed before any provider request', async () => {
  let networkCalls = 0;
  const provider = getPaymentProvider(env, async () => {
    networkCalls += 1;
    throw new Error('network must not be called');
  });

  for (const checkoutId of malformedReferences) {
    await assert.rejects(
      () => provider.verifyPayment({ checkoutId }),
      error => error instanceof PaymentProviderError && error.code === 'INVALID_CHECKOUT_ID' && error.statusCode === 400,
    );
  }
  assert.equal(networkCalls, 0);
});

test('malformed refund payment references fail closed before any provider request', async () => {
  let networkCalls = 0;
  const provider = getPaymentProvider(env, async () => {
    networkCalls += 1;
    throw new Error('network must not be called');
  });

  for (const paymentId of malformedReferences) {
    await assert.rejects(
      () => provider.refundPayment({ paymentId, amount: 10, currency: 'ILS' }),
      error => error instanceof PaymentProviderError && error.code === 'INVALID_PAYMENT_ID' && error.statusCode === 400,
    );
  }
  assert.equal(networkCalls, 0);
});
