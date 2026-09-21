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

test('HyperPay whitespace-only credentials fail closed before network access', async () => {
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
    await assert.rejects(
      () => provider.createPayment({ amount: 10, currency: 'ILS', merchantTransactionId: 'order-1' }),
      error => error instanceof PaymentProviderError && error.code === 'HYPERPAY_NOT_CONFIGURED',
    );
    assert.equal(networkCalled, false);
  }
});
