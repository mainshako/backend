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

function response(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function expectRequestFailed(operation) {
  await assert.rejects(operation, error => {
    assert.ok(error instanceof PaymentProviderError);
    assert.equal(error.code, 'HYPERPAY_REQUEST_FAILED');
    return true;
  });
}

test('non-2xx provider responses cannot confirm checkout, payment, or refund', async () => {
  const provider = getPaymentProvider(configured, async url => {
    if (String(url).endsWith('/v1/checkouts')) {
      return response(500, { id: 'checkout_12345678', result: { code: '000.200.100' } });
    }
    if (String(url).includes('/payment?')) {
      return response(500, { id: 'payment_12345678', paid: true, result: { code: '000.000.000' } });
    }
    return response(500, { id: 'refund_12345678', refunded: true, result: { code: '000.000.000' } });
  });

  await expectRequestFailed(() => provider.createPayment({ amount: 10, currency: 'ILS', merchantTransactionId: 'order_12345678' }));
  await expectRequestFailed(() => provider.verifyPayment({ checkoutId: 'checkout_12345678' }));
  await expectRequestFailed(() => provider.refundPayment({ paymentId: 'payment_12345678', amount: 10, currency: 'ILS' }));
});
