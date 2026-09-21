import test from 'node:test';
import assert from 'node:assert/strict';
import { getPaymentProvider } from '../src/services/payment-provider.js';

const configured = {
  PAYMENT_PROVIDER: 'hyperpay',
  HYPERPAY_ENABLED: 'true',
  HYPERPAY_ACCESS_TOKEN: 'sandbox-token',
  HYPERPAY_ENTITY_ID: 'sandbox-entity',
  HYPERPAY_BASE_URL: 'https://eu-test.oppwa.com',
};

const responseFor = (code, id = 'payment_12345678') =>
  new Response(JSON.stringify({ id, result: { code, description: 'provider response' } }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

test('HyperPay 000.3xx and 000.6xx codes outside documented 300/600 success families fail closed', async () => {
  for (const code of ['000.301.000', '000.399.999', '000.601.000', '000.699.999']) {
    const verify = getPaymentProvider(configured, async () => responseFor(code));
    const payment = await verify.verifyPayment({ checkoutId: 'checkout_12345678' });
    assert.equal(payment.paid, false, `${code} must not mark a payment paid`);
    assert.equal(payment.pending, false);

    const refund = getPaymentProvider(configured, async () => responseFor(code, 'refund_12345678'));
    const result = await refund.refundPayment({ paymentId: 'payment_12345678', amount: 10, currency: 'ILS' });
    assert.equal(result.succeeded, false, `${code} must not mark a refund succeeded`);
    assert.equal(result.pending, false);
  }
});

test('HyperPay documented 300/600 success families remain accepted for payments and refunds', async () => {
  for (const code of ['000.300.000', '000.600.000']) {
    const paymentProvider = getPaymentProvider(configured, async () => responseFor(code));
    const payment = await paymentProvider.verifyPayment({ checkoutId: 'checkout_12345678' });
    assert.equal(payment.paid, true, `${code} should remain a recognized payment success code`);
    assert.equal(payment.pending, false);
    assert.equal(payment.providerReference, 'payment_12345678');

    const refundProvider = getPaymentProvider(configured, async () => responseFor(code, 'refund_12345678'));
    const refund = await refundProvider.refundPayment({ paymentId: 'payment_12345678', amount: 10, currency: 'ILS' });
    assert.equal(refund.succeeded, true, `${code} should remain a recognized refund success code`);
    assert.equal(refund.pending, false);
    assert.equal(refund.providerReference, 'refund_12345678');
  }
});
