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

test('HyperPay remains unavailable unless explicitly enabled with complete credentials', async () => {
  for (const env of [
    { ...configured, HYPERPAY_ENABLED: 'false' },
    { ...configured, HYPERPAY_ACCESS_TOKEN: '' },
    { ...configured, HYPERPAY_ENTITY_ID: '' },
  ]) {
    const provider = getPaymentProvider(env, async () => { throw new Error('network must not be called'); });
    assert.equal(provider.ready, false);
    await assert.rejects(
      () => provider.createPayment({ amount: 10, merchantTransactionId: 'order-1' }),
      error => error instanceof PaymentProviderError && error.code === 'HYPERPAY_NOT_CONFIGURED',
    );
  }
});

test('HyperPay checkout creation sends server credentials and never reports payment success', async () => {
  const calls = [];
  const provider = getPaymentProvider(configured, async (url, options = {}) => {
    calls.push({ url, options });
    return new Response(JSON.stringify({ id: 'checkout_12345678' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  });
  const result = await provider.createPayment({ amount: 12.5, currency: 'ILS', merchantTransactionId: 'order-123' });
  assert.deepEqual(result, { checkoutId: 'checkout_12345678', providerReference: 'checkout_12345678' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.headers.Authorization, 'Bearer sandbox-token');
  assert.match(String(calls[0].options.body), /paymentType=DB/);
  assert.match(String(calls[0].options.body), /amount=12.50/);
  assert.equal('paid' in result, false);
});

test('HyperPay verification fails closed for unknown result codes', async () => {
  const provider = getPaymentProvider(configured, async () => new Response(JSON.stringify({
    id: 'payment_12345678',
    result: { code: '999.999.999', description: 'unknown' },
  }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
  const result = await provider.verifyPayment({ checkoutId: 'checkout_12345678' });
  assert.equal(result.paid, false);
  assert.equal(result.pending, false);
  assert.equal(result.resultCode, '999.999.999');
  assert.equal(result.providerReference, 'payment_12345678');
});

test('HyperPay verification recognizes pending without marking paid', async () => {
  const provider = getPaymentProvider(configured, async () => new Response(JSON.stringify({
    id: 'payment_12345678',
    result: { code: '000.200.000', description: 'pending' },
  }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
  const result = await provider.verifyPayment({ checkoutId: 'checkout_12345678' });
  assert.equal(result.paid, false);
  assert.equal(result.pending, true);
});

test('HyperPay verification only marks documented success pattern paid', async () => {
  const provider = getPaymentProvider(configured, async () => new Response(JSON.stringify({
    id: 'payment_12345678',
    result: { code: '000.000.000', description: 'success' },
  }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
  const result = await provider.verifyPayment({ checkoutId: 'checkout_12345678' });
  assert.equal(result.paid, true);
  assert.equal(result.pending, false);
});

test('HyperPay rejects malformed checkout ids before network access', async () => {
  const provider = getPaymentProvider(configured, async () => { throw new Error('network must not be called'); });
  await assert.rejects(
    () => provider.verifyPayment({ checkoutId: '../bad' }),
    error => error instanceof PaymentProviderError && error.code === 'INVALID_CHECKOUT_ID' && error.statusCode === 400,
  );
});
