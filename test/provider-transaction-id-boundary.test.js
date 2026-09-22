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

test('HyperPay rejects unsafe merchant transaction ids before network access', async () => {
  let networkCalls = 0;
  const provider = getPaymentProvider(configured, async () => {
    networkCalls += 1;
    throw new Error('network must not be called');
  });

  for (const merchantTransactionId of [
    'order/12345678',
    'order?paid=true',
    'order#fragment',
    'order&paymentType=RF',
    'order=12345678',
    'order 12345678',
    'order\n12345678',
    'order\r12345678',
    'x'.repeat(201),
  ]) {
    await assert.rejects(
      () => provider.createPayment({ amount: 10, currency: 'ILS', merchantTransactionId }),
      error => error instanceof PaymentProviderError
        && error.code === 'INVALID_MERCHANT_TRANSACTION_ID'
        && error.statusCode === 400,
    );
  }

  assert.equal(networkCalls, 0);
});
