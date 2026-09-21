import test from 'node:test';
import assert from 'node:assert/strict';
import { getPaymentProvider, PaymentProviderError } from '../src/services/payment-provider.js';

test('disabled payment provider fails closed for create, verify, and refund', async () => {
  const provider = getPaymentProvider({ PAYMENT_PROVIDER: 'disabled' }, async () => {
    throw new Error('network must not be called');
  });

  assert.equal(provider.ready, false);
  assert.equal(provider.name, 'disabled');

  const operations = [
    () => provider.createPayment({ amount: 10, currency: 'ILS', merchantTransactionId: 'order-1' }),
    () => provider.verifyPayment({ checkoutId: 'checkout_12345678' }),
    () => provider.refundPayment({ paymentId: 'payment_12345678', amount: 10, currency: 'ILS' }),
  ];

  for (const operation of operations) {
    await assert.rejects(
      operation,
      error => error instanceof PaymentProviderError
        && error.code === 'PAYMENT_PROVIDER_DISABLED'
        && error.statusCode === 503,
    );
  }
});
