import test from 'node:test';
import assert from 'node:assert/strict';
import {
  marketplaceConfiguration,
  supabaseAdminHeaders,
  supabaseUserHeaders,
  normalizeOrderItems,
  MarketplaceApiError,
} from '../src/services/supabase-marketplace.js';

test('marketplace works with publishable key even when admin secret is absent', () => {
  const config = marketplaceConfiguration({
    SUPABASE_URL: 'https://example.supabase.co/',
    SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test',
  });
  assert.equal(config.url, 'https://example.supabase.co');
  assert.equal(config.marketplaceConfigured, true);
  assert.equal(config.marketplaceAdminConfigured, false);
  assert.equal(config.clientKey, 'sb_publishable_test');
});

test('admin key alone remains backward compatible', () => {
  const config = marketplaceConfiguration({
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'header.payload.signature',
  });
  assert.equal(config.marketplaceConfigured, true);
  assert.equal(config.marketplaceAdminConfigured, true);
  assert.equal(config.clientKey, 'header.payload.signature');
});

test('modern secret key is not copied into Authorization header', () => {
  const headers = supabaseAdminHeaders('sb_secret_example', { 'Content-Type': 'application/json' });
  assert.equal(headers.apikey, 'sb_secret_example');
  assert.equal(headers.Authorization, undefined);
});

test('legacy JWT service role key keeps Authorization compatibility', () => {
  const headers = supabaseAdminHeaders('header.payload.signature');
  assert.equal(headers.Authorization, 'Bearer header.payload.signature');
});

test('authenticated headers always carry the user access token', () => {
  const headers = supabaseUserHeaders('sb_publishable_test', 'user.jwt.token');
  assert.equal(headers.apikey, 'sb_publishable_test');
  assert.equal(headers.Authorization, 'Bearer user.jwt.token');
});

test('authenticated headers reject missing access token', () => {
  assert.throws(
    () => supabaseUserHeaders('sb_publishable_test', ''),
    error => error instanceof MarketplaceApiError && error.code === 'AUTH_REQUIRED',
  );
});

test('order normalization rejects invalid quantities and accepts aliases', () => {
  assert.deepEqual(normalizeOrderItems([{ productId: 12, quantity: 2, size: ' M ' }]), [
    { product_id: 12, quantity: 2, size: 'M' },
  ]);
  assert.throws(
    () => normalizeOrderItems([{ product_id: 12, quantity: 0 }]),
    error => error instanceof MarketplaceApiError && error.code === 'INVALID_ITEM',
  );
});
