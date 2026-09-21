import test from 'node:test';
import assert from 'node:assert/strict';
import { getPaymentProvider, PaymentProviderError } from '../src/services/payment-provider.js';

const configured = {
  PAYMENT_PROVIDER: 'hyperpay',
  HYPERPAY_ENABLED: 'true',
  HYPERPAY_ACCESS_TOKEN: 'sandbox-token',
  HYPERPAY_ENTITY_ID: 'sandbox-entity',
  HYPERPAY_BASE_URL: 'https://eu-test.oppwa.com',
};

const operations = [
  provider => provider.createPayment({ amount: 10, currency: 'ILS', merchantTransactionId: 'order-1' }),
  provider => provider.verifyPayment({ checkoutId: 'checkout-12345678' }),
  provider => provider.refundPayment({ paymentId: 'payment-12345678', amount: 10, currency: 'ILS' }),
];

test('HyperPay whitespace-only credentials fail closed before network access across all payment operations', async () => {
  for (const env of [
    { ...configured, HYPERPAY_ACCESS_TOKEN: '   \t  ' },
    { ...configured, HYPERPAY_ENTITY_ID: '   \n  ' },
  ]) {
    let networkCalled = false;
    const provider = getPaymentProvider(env, async () => {
      networkCalled = true;
      throw new Error('network must not be called');
    });

    assert.equal(provider.ready, false);
    for (const operation of operations) {
      await assert.rejects(
        () => operation(provider),
        error => error instanceof PaymentProviderError && error.code === 'HYPERPAY_NOT_CONFIGURED',
      );
    }
    assert.equal(networkCalled, false);
  }
});
