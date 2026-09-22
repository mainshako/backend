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

for (const amount of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, 'not-a-number', '0.004']) {
  test(`invalid refund amount ${String(amount)} fails closed before provider network`, async () => {
    let networkCalls = 0;
    const provider = getPaymentProvider(env, async () => {
      networkCalls += 1;
      throw new Error('network must not be reached');
    });

    await assert.rejects(
      provider.refundPayment({ paymentId: 'payment_12345678', amount, currency: 'ILS' }),
      error => error instanceof PaymentProviderError && error.code === 'INVALID_REFUND_AMOUNT' && error.statusCode === 400
    );
    assert.equal(networkCalls, 0);
  });
}
