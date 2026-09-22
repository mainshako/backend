import test from 'node:test';
import assert from 'node:assert/strict';
import { assertValidProviderReference, getPaymentProvider, PaymentProviderError } from '../src/services/payment-provider.js';

const configured = {
  PAYMENT_PROVIDER: 'hyperpay',
  HYPERPAY_ENABLED: 'true',
  HYPERPAY_ACCESS_TOKEN: 'sandbox-token',
  HYPERPAY_ENTITY_ID: 'sandbox-entity',
  HYPERPAY_BASE_URL: 'https://eu-test.oppwa.com',
};

test('shared provider reference boundary accepts only opaque safe identifiers', () => {
  for (const value of ['checkout_12345678', '8ac7a4a091234567', 'payment.ref-123']) {
    assert.equal(assertValidProviderReference(value), value);
  }

  for (const value of ['', 'short', '../checkout', 'checkout?id=fake', 'checkout/child', ' checkout_12345678 ', 'https://evil.example/id']) {
    assert.throws(
      () => assertValidProviderReference(value),
      error => error instanceof PaymentProviderError && error.code === 'INVALID_CHECKOUT_ID' && error.statusCode === 400,
    );
  }
});

test('shared provider reference boundary preserves refund-specific error semantics', () => {
  assert.throws(
    () => assertValidProviderReference('../payment', 'INVALID_PAYMENT_ID', 'مرجع عملية الدفع غير صالح.'),
    error => error instanceof PaymentProviderError && error.code === 'INVALID_PAYMENT_ID' && error.statusCode === 400,
  );
});

test('HyperPay rejects unsafe checkout and payment references before network access', async () => {
  let networkCalls = 0;
  const provider = getPaymentProvider(configured, async () => {
    networkCalls += 1;
    throw new Error('network must not be called');
  });

  const unsafeReferences = [
    '',
    'short',
    'payment/12345678',
    'payment?paid=true',
    'payment#fragment',
    'payment&paymentType=RF',
    'payment=12345678',
    'payment 12345678',
    'payment\n12345678',
    'payment\r12345678',
    'x'.repeat(201),
  ];

  for (const reference of unsafeReferences) {
    await assert.rejects(
      () => provider.verifyPayment({ checkoutId: reference }),
      error => error instanceof PaymentProviderError
        && error.code === 'INVALID_CHECKOUT_ID'
        && error.statusCode === 400,
    );
    await assert.rejects(
      () => provider.refundPayment({ paymentId: reference, amount: 10, currency: 'ILS' }),
      error => error instanceof PaymentProviderError
        && error.code === 'INVALID_PAYMENT_ID'
        && error.statusCode === 400,
    );
  }

  assert.equal(networkCalls, 0);
});
