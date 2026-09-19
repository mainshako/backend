import test from 'node:test';
import assert from 'node:assert/strict';
import { createMarketplaceOrder, MarketplaceApiError } from '../src/services/supabase-marketplace.js';

const buyerId = '11111111-1111-1111-1111-111111111111';
const orderId = '22222222-2222-2222-2222-222222222222';
const base = {
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test',
};

test('electronic order creation fails closed without backend shared secret', async () => {
  await assert.rejects(
    () => createMarketplaceOrder({ buyerId, accessToken: 'user.jwt.token', paymentMethod: 'hyperpay', items: [{ productId: 1, quantity: 1 }] }, base, async () => { throw new Error('network must not be called'); }),
    error => error instanceof MarketplaceApiError && error.code === 'SUPABASE_ADMIN_NOT_CONFIGURED' && error.statusCode === 503,
  );
});

test('electronic order creation sends backend proof while preserving user identity', async () => {
  const calls = [];
  const env = { ...base, BUTTON_BACKEND_SHARED_SECRET: 'server-only-secret' };
  await createMarketplaceOrder(
    { buyerId, accessToken: 'user.jwt.token', paymentMethod: 'hyperpay', items: [{ productId: 1, quantity: 1 }] },
    env,
    async (url, options = {}) => {
      calls.push({ url, options });
      if (url.endsWith('/rpc/button_create_order')) return new Response(JSON.stringify(orderId), { status: 200, headers: { 'Content-Type': 'application/json' } });
      if (url.includes('/rest/v1/orders?')) return new Response(JSON.stringify([{ id: orderId, buyer_id: buyerId }]), { status: 200, headers: { 'Content-Type': 'application/json' } });
      if (url.includes('/rest/v1/order_items?')) return new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } });
      throw new Error(`unexpected url ${url}`);
    },
  );
  const create = calls[0];
  assert.match(create.url, /\/rpc\/button_create_order$/);
  assert.equal(create.options.headers.Authorization, 'Bearer user.jwt.token');
  assert.equal(create.options.headers['x-button-backend-key'], 'server-only-secret');
  assert.equal(create.options.headers.apikey, 'sb_publishable_test');
});

test('cash on delivery remains usable without backend shared secret', async () => {
  const calls = [];
  await createMarketplaceOrder(
    { buyerId, accessToken: 'user.jwt.token', paymentMethod: 'cash_on_delivery', items: [{ productId: 1, quantity: 1 }] },
    base,
    async (url, options = {}) => {
      calls.push({ url, options });
      if (url.endsWith('/rpc/button_create_order')) return new Response(JSON.stringify(orderId), { status: 200, headers: { 'Content-Type': 'application/json' } });
      if (url.includes('/rest/v1/orders?')) return new Response(JSON.stringify([{ id: orderId, buyer_id: buyerId }]), { status: 200, headers: { 'Content-Type': 'application/json' } });
      if (url.includes('/rest/v1/order_items?')) return new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } });
      throw new Error(`unexpected url ${url}`);
    },
  );
  assert.equal(calls[0].options.headers['x-button-backend-key'], undefined);
}