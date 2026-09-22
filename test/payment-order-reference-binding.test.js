import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveStoredCheckoutReference } from '../src/routes/marketplace-supabase.js';
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
