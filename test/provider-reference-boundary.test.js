import test from 'node:test';
import assert from 'node:assert/strict';
import { assertValidProviderReference, PaymentProviderError } from '../src/services/payment-provider.js';

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
