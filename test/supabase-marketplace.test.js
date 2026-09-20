import test from 'node:test';
import assert from 'node:assert/strict';
import {
  marketplaceConfiguration,
  supabaseAdminHeaders,
  supabaseBackendHeaders,
  supabaseUserHeaders,
  normalizeOrderItems,
  markOrderPayment,
  MarketplaceApiError,
} from '../src/services/supabase-marketplace.js';
import { assertElectronicOrder, assertElectronicOrderProviderReady } from '../src/routes/marketplace-supabase.js';
import { probeMarketplaceAdmin } from '../src/services/readiness.js';

test('marketplace works with publishable key even when admin secret is absent', () => {
  const config = marketplaceConfiguration({ SUPABASE_URL: 'https://example.supabase.co/', SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test' });
  assert.equal(config.url, 'https://example.supabase.co'); assert.equal(config.marketplaceConfigured, true); assert.equal(config.marketplaceAdminConfigured, false); assert.equal(config.clientKey, 'sb_publishable_test');
});

test('admin key alone remains backward compatible', () => {
  const config = marketplaceConfiguration({ SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'header.payload.signature' });
  assert.equal(config.marketplaceConfigured, true); assert.equal(config.marketplaceAdminConfigured, true); assert.equal(config.clientKey, 'header.payload.signature');
});

test('shared backend secret enables sensitive operations without service_role', () => {
  const config = marketplaceConfiguration({ SUPABASE_URL: 'https://example.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test', BUTTON_BACKEND_SHARED_SECRET: 'server-only-secret' });
  assert.equal(config.marketplaceConfigured, true); assert.equal(config.marketplaceAdminConfigured, true); assert.equal(config.sharedBackendConfigured, true); assert.equal(config.adminKey, '');
});

test('shared backend secret uses a dedicated header and never Authorization', () => {
  const headers = supabaseBackendHeaders('sb_publishable_test', 'server-only-secret', { 'Content-Type': 'application/json' });
  assert.equal(headers.apikey, 'sb_publishable_test'); assert.equal(headers['x-button-backend-key'], 'server-only-secret'); assert.equal(headers.Authorization, undefined);
});

test('payment mutation uses narrow backend RPC when service_role is absent', async () => {
  const calls = [];
  await markOrderPayment('22222222-2222-2222-2222-222222222222','11111111-1111-1111-1111-111111111111','checkout-reference-123','pending',null,{ SUPABASE_URL:'https://example.supabase.co', SUPABASE_PUBLISHABLE_KEY:'sb_publishable_test', BUTTON_BACKEND_SHARED_SECRET:'server-only-secret' },async (url, options={}) => { calls.push({url,options}); return new Response(JSON.stringify('pending'), { status:200, headers:{'Content-Type':'application/json'} }); });
  assert.match(calls[0].url, /\/rpc\/button_backend_set_order_payment_v2$/); assert.equal(calls[0].options.headers.apikey,'sb_publishable_test'); assert.equal(calls[0].options.headers['x-button-backend-key'],'server-only-secret'); assert.equal(calls[0].options.headers.Authorization,undefined);
});

test('electronic order is rejected before stock reservation while provider is disabled', () => {
  assert.throws(() => assertElectronicOrderProviderReady('hyperpay',{PAYMENT_PROVIDER:'disabled'}), error => error?.code==='PAYMENT_PROVIDER_DISABLED' && error?.statusCode===503);
  assert.equal(assertElectronicOrderProviderReady('cash_on_delivery',{PAYMENT_PROVIDER:'disabled'}),'cash_on_delivery');
});

test('unsupported payment methods are rejected at the API boundary', () => {
  for (const method of ['', 'crypto', 'paypal', 'bank_transfer']) assert.throws(() => assertElectronicOrderProviderReady(method,{PAYMENT_PROVIDER:'disabled'}), error => error instanceof MarketplaceApiError && error.code==='INVALID_PAYMENT_METHOD' && error.statusCode===400);
});

test('payment endpoints reject non-electronic orders before provider verification', () => {
  const electronic={payment_method:'hyperpay'}; assert.equal(assertElectronicOrder(electronic),electronic);
  assert.throws(() => assertElectronicOrder({payment_method:'cash_on_delivery',payment_status:'paid'}), error => error instanceof MarketplaceApiError && error.code==='ORDER_NOT_ELECTRONIC' && error.statusCode===400);
});

test('modern secret key is not copied into Authorization header', () => { const headers=supabaseAdminHeaders('sb_secret_example',{'Content-Type':'application/json'}); assert.equal(headers.apikey,'sb_secret_example'); assert.equal(headers.Authorization,undefined); });
test('legacy JWT service role key keeps Authorization compatibility', () => { const headers=supabaseAdminHeaders('header.payload.signature'); assert.equal(headers.Authorization,'Bearer header.payload.signature'); });
test('authenticated headers always carry the user access token', () => { const headers=supabaseUserHeaders('sb_publishable_test','user.jwt.token'); assert.equal(headers.apikey,'sb_publishable_test'); assert.equal(headers.Authorization,'Bearer user.jwt.token'); });
test('authenticated headers reject missing access token', () => { assert.throws(() => supabaseUserHeaders('sb_publishable_test',''), error => error instanceof MarketplaceApiError && error.code==='AUTH_REQUIRED'); });

test('order normalization rejects invalid quantities and accepts aliases', () => {
  assert.deepEqual(normalizeOrderItems([{productId:12,quantity:2,size:' M '}]),[{product_id:12,quantity:2,size:'M'}]);
  assert.throws(() => normalizeOrderItems([{product_id:12,quantity:0}]), error => error instanceof MarketplaceApiError && error.code==='INVALID_ITEM');
});

test('privileged readiness probe validates shared-secret bridge end to end', async () => {
  const calls=[];
  const result=await probeMarketplaceAdmin({ SUPABASE_URL:'https://example.supabase.co', SUPABASE_PUBLISHABLE_KEY:'sb_publishable_test', BUTTON_BACKEND_SHARED_SECRET:'server-only-secret' }, async (url,options={}) => { calls.push({url,options}); return new Response('true',{status:200,headers:{'Content-Type':'application/json'}}); });
  assert.deepEqual(result,{reachable:true,mode:'shared_secret'}); assert.match(calls[0].url,/\/rpc\/button_backend_ping$/); assert.equal(calls[0].options.headers['x-button-backend-key'],'server-only-secret');
  assert.ok(calls[0].options.signal instanceof AbortSignal); assert.equal(calls[0].options.signal.aborted,false);
});

test('privileged readiness probe fails closed on rejected shared secret', async () => {
  await assert.rejects(() => probeMarketplaceAdmin({ SUPABASE_URL:'https://example.supabase.co', SUPABASE_PUBLISHABLE_KEY:'sb_publishable_test', BUTTON_BACKEND_SHARED_SECRET:'wrong-secret' }, async () => new Response('{"message":"forbidden"}',{status:403,headers:{'Content-Type':'application/json'}})), /shared_secret_http_403/);
});
