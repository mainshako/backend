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

for (const currency of ['', 'IL', 'ILSS', '12S', 'ILS/../USD', null]) {
  test(`invalid payment currency ${String(currency)} fails closed before provider network`, async () => {
    let networkCalls = 0;
    const provider = getPaymentProvider(env, async () => {
      networkCalls += 1;
      throw new Error('network must not be reached');
    });

    await assert.rejects(
      provider.createPayment({ amount: 10, currency, merchantTransactionId: 'order_12345678' }),
      error => error instanceof PaymentProviderError && error.code === 'INVALID_PAYMENT_CURRENCY' && error.statusCode === 400
    );
    assert.equal(networkCalls, 0);
  });

  test(`invalid refund currency ${String(currency)} fails closed before provider network`, async () => {
    let networkCalls = 0;
    const provider = getPaymentProvider(env, async () => {
      networkCalls += 1;
      throw new Error('network must not be reached');
    });

    await assert.rejects(
      provider.refundPayment({ paymentId: 'payment_12345678', amount: 10, currency }),
      error => error instanceof PaymentProviderError && error.code === 'INVALID_PAYMENT_CURRENCY' && error.statusCode === 400
    );
    assert.equal(networkCalls, 0);
  });
}
