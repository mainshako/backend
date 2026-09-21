import test from 'node:test';
import assert from 'node:assert/strict';
import { createMarketplaceOrder, MarketplaceApiError } from '../src/services/supabase-marketplace.js';
import { assertElectronicOrderProviderReady, assertElectronicOrder, requirePaymentProvider } from '../src/routes/marketplace-supabase.js';
import { PaymentProviderError } from '../src/services/payment-provider.js';

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
});

test('order boundary rejects unsupported payment methods before order creation', () => {
  const env = {
    PAYMENT_PROVIDER: 'hyperpay',
    HYPERPAY_ENABLED: 'true',
    HYPERPAY_ACCESS_TOKEN: 'sandbox-token',
    HYPERPAY_ENTITY_ID: 'sandbox-entity',
  };
  for (const method of ['', 'paypal', 'crypto', 'bank_transfer', 'fake_success']) {
    assert.throws(
      () => assertElectronicOrderProviderReady(method, env),
      error => error instanceof MarketplaceApiError && error.code === 'INVALID_PAYMENT_METHOD' && error.statusCode === 400,
    );
  }
});

test('electronic order boundary fails closed while payment provider is disabled', () => {
  for (const method of ['hyperpay', 'card']) {
    assert.throws(
      () => assertElectronicOrderProviderReady(method, { PAYMENT_PROVIDER: 'disabled' }),
      error => error instanceof PaymentProviderError && error.code === 'PAYMENT_PROVIDER_DISABLED' && error.statusCode === 503,
    );
  }
  assert.equal(assertElectronicOrderProviderReady('cash_on_delivery', { PAYMENT_PROVIDER: 'disabled' }), 'cash_on_delivery');
});

test('existing electronic checkout cannot be reused while payment provider is disabled', () => {
  assert.throws(
    () => requirePaymentProvider({ PAYMENT_PROVIDER: 'disabled' }),
    error => error instanceof PaymentProviderError && error.code === 'PAYMENT_PROVIDER_DISABLED' && error.statusCode === 503,
  );
});

test('payment and refund endpoints only accept electronic orders', () => {
  assert.equal(assertElectronicOrder({ payment_method: 'hyperpay' }).payment_method, 'hyperpay');
  assert.equal(assertElectronicOrder({ payment_method: 'CARD' }).payment_method, 'CARD');

  for (const payment_method of ['', 'cash_on_delivery', 'paypal', 'crypto', 'fake_success']) {
    assert.throws(
      () => assertElectronicOrder({ payment_method }),
      error => error instanceof MarketplaceApiError && error.code === 'ORDER_NOT_ELECTRONIC' && error.statusCode === 400,
    );
  }
});