import test from 'node:test';
import assert from 'node:assert/strict';
import { paymentReferenceAfterVerification, resolveStoredCheckoutReference } from '../src/routes/marketplace-supabase.js';
import { MarketplaceApiError } from '../src/services/supabase-marketplace.js';

test('payment verification cannot adopt an arbitrary checkout reference', () => {
  assert.throws(
    () => resolveStoredCheckoutReference({ provider_reference: null }, 'checkout_attacker123'),
    error => error instanceof MarketplaceApiError
      && error.statusCode === 409
      && error.code === 'PAYMENT_NOT_INITIALIZED',
  );

  assert.throws(
    () => resolveStoredCheckoutReference({ provider_reference: 'checkout_order123' }, 'checkout_other456'),
    error => error instanceof MarketplaceApiError
      && error.statusCode === 400
      && error.code === 'PAYMENT_REFERENCE_MISMATCH',
  );

  assert.equal(
    resolveStoredCheckoutReference({ provider_reference: 'checkout_order123' }, 'checkout_order123'),
    'checkout_order123',
  );
  assert.equal(
    resolveStoredCheckoutReference({ provider_reference: 'checkout_order123' }),
    'checkout_order123',
  );
});

test('non-success verification preserves the checkout reference for safe retries', () => {
  const checkoutId = 'checkout_order123';
  const providerPaymentId = 'payment_provider456';

  assert.equal(
    paymentReferenceAfterVerification(checkoutId, { paid: false, pending: true, providerReference: providerPaymentId }),
    checkoutId,
  );
  assert.equal(
    paymentReferenceAfterVerification(checkoutId, { paid: false, pending: false, providerReference: providerPaymentId }),
    checkoutId,
  );
  assert.equal(
    paymentReferenceAfterVerification(checkoutId, { paid: true, pending: false, providerReference: providerPaymentId }),
    providerPaymentId,
  );
});
