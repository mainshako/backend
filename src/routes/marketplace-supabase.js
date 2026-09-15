import express from 'express';
import { getPaymentProvider, PaymentProviderError } from '../services/payment-provider.js';
import {
  authenticateSupabaseRequest,
  createMarketplaceOrder,
  getMarketplaceOrder,
  listBuyerOrders,
  listSellerOrders,
  setSellerOrderStatus,
  markOrderPayment,
  cancelBuyerOrder,
  getPendingRefund,
  claimRefundProcessing,
  recordRefundProcessing,
  finalizeRefundV2,
  MarketplaceApiError,
} from '../services/supabase-marketplace.js';

function authorizationToken(req) {
  return /^Bearer\s+(.+)$/i.exec(req.headers.authorization || '')?.[1] || '';
}

export function marketplaceErrorResponse(error, res) {
  console.error('Button marketplace request failed:', error);
  const statusCode = Number(error?.statusCode);
  const status = Number.isInteger(statusCode) && statusCode >= 400 && statusCode <= 599 ? statusCode : 500;
  const safeMessage = error instanceof MarketplaceApiError || error instanceof PaymentProviderError
    ? error.message
    : 'تعذر تنفيذ الطلب. يرجى المحاولة لاحقًا.';
  res.status(status).json({ error: safeMessage, code: error?.code || 'MARKETPLACE_ERROR' });
}

async function processElectronicRefund(order, userId, environment) {
  if (order.payment_status !== 'paid' || !['hyperpay', 'card'].includes(order.payment_method)) {
    throw new MarketplaceApiError(400, 'ORDER_NOT_REFUNDABLE', 'الطلب غير مؤهل للاسترداد الإلكتروني.');
  }

  const refund = await getPendingRefund(order.id, userId, environment);
  const claim = await claimRefundProcessing(refund.id, order.id, userId, environment);
  if (claim === 'succeeded') return { httpStatus: 200, body: { ok: true, refunded: true, status: 'refunded' } };
  if (claim === 'processing') {
    return {
      httpStatus: 202,
      body: { ok: true, pending: true, status: 'processing', message: 'طلب الاسترداد قيد المعالجة ولن نرسل طلب استرداد مكرر.' },
    };
  }
  if (claim !== 'claimed') throw new MarketplaceApiError(409, 'REFUND_NOT_PROCESSABLE', 'طلب الاسترداد ليس في حالة تسمح بالمعالجة.');

  const provider = getPaymentProvider(environment);
  if (!provider.ready) {
    await recordRefundProcessing(refund.id, order.id, userId, 'pending', null, null, 'PAYMENT_PROVIDER_DISABLED', environment);
    return {
      httpStatus: 202,
      body: { ok: true, pending: true, status: 'pending', code: 'PAYMENT_PROVIDER_DISABLED', message: 'تم حفظ طلب الاسترداد. بوابة الدفع غير مفعلة بعد، ولم يتم إرسال خصم أو استرداد وهمي.' },
    };
  }

  let result;
  try {
    result = await provider.refundPayment({
      paymentId: order.provider_reference,
      amount: refund.amount,
      currency: refund.currency,
    });
  } catch (error) {
    await recordRefundProcessing(
      refund.id,
      order.id,
      userId,
      'processing',
      null,
      null,
      error?.code || 'REFUND_PROVIDER_UNCERTAIN',
      environment,
    ).catch(() => {});
    throw error;
  }

  if (result.pending) {
    await recordRefundProcessing(
      refund.id,
      order.id,
      userId,
      'processing',
      result.providerReference,
      result.resultCode,
      null,
      environment,
    );
    return {
      httpStatus: 202,
      body: { ok: true, pending: true, status: 'processing', resultCode: result.resultCode },
    };
  }

  const state = await finalizeRefundV2(
    refund.id,
    order.id,
    userId,
    result.succeeded,
    result.providerReference,
    result.resultCode,
    environment,
  );
  return {
    httpStatus: result.succeeded ? 200 : 502,
    body: { ok: result.succeeded, refunded: result.succeeded, status: state, resultCode: result.resultCode },
  };
}

export function createMarketplaceSupabaseRouter(environment = process.env) {
  const router = express.Router();

  router.post('/orders', async (req, res) => {
    try {
      const user = await authenticateSupabaseRequest(req, environment);
      const order = await createMarketplaceOrder({
        buyerId: user.id,
        paymentMethod: req.body?.paymentMethod,
        shippingAddress: req.body?.shippingAddress,
        items: req.body?.items,
      }, environment);
      res.status(201).json({ order });
    } catch (error) { marketplaceErrorResponse(error, res); }
  });

  router.get('/orders', async (req, res) => {
    try {
      const user = await authenticateSupabaseRequest(req, environment);
      const orders = await listBuyerOrders(user.id, environment);
      res.json({ orders });
    } catch (error) { marketplaceErrorResponse(error, res); }
  });

  router.get('/orders/:id', async (req, res) => {
    try {
      const user = await authenticateSupabaseRequest(req, environment);
      const order = await getMarketplaceOrder(req.params.id, user.id, environment);
      res.json({ order });
    } catch (error) { marketplaceErrorResponse(error, res); }
  });

  router.get('/seller/orders', async (req, res) => {
    try {
      await authenticateSupabaseRequest(req, environment);
      const orders = await listSellerOrders(authorizationToken(req), environment);
      res.json({ orders });
    } catch (error) { marketplaceErrorResponse(error, res); }
  });

  router.patch('/seller/orders/:id/status', async (req, res) => {
    try {
      await authenticateSupabaseRequest(req, environment);
      const status = await setSellerOrderStatus(authorizationToken(req), req.params.id, req.body?.status, environment);
      res.json({ ok: true, status });
    } catch (error) { marketplaceErrorResponse(error, res); }
  });

  router.post('/orders/:id/cancel', async (req, res) => {
    try {
      const user = await authenticateSupabaseRequest(req, environment);
      const result = await cancelBuyerOrder(req.params.id, user.id, req.body?.reason, environment);
      if (result !== 'refund_required') return res.json({ ok: true, status: result });

      const order = await getMarketplaceOrder(req.params.id, user.id, environment);
      try {
        const refundResult = await processElectronicRefund(order, user.id, environment);
        return res.status(refundResult.httpStatus).json({
          ...refundResult.body,
          cancellationStatus: 'refund_required',
          message: refundResult.body.refunded
            ? 'تم تأكيد الاسترداد وإلغاء الطلب بأمان.'
            : (refundResult.body.message || 'تم تسجيل طلب الاسترداد بأمان. لن يعتبر المبلغ مستردًا قبل تأكيد بوابة الدفع.'),
        });
      } catch (refundError) {
        console.error('Refund provider status is uncertain after cancellation:', refundError);
        return res.status(202).json({
          ok: true, pending: true, status: 'processing', cancellationStatus: 'refund_required',
          code: refundError?.code || 'REFUND_PROVIDER_UNCERTAIN',
          message: 'تم حفظ طلب الاسترداد. تعذر تأكيد نتيجة البوابة الآن، لذلك بقي الطلب قيد المعالجة ولن نرسل استردادًا مكررًا تلقائيًا.',
        });
      }
    } catch (error) { marketplaceErrorResponse(error, res); }
  });

  router.post('/orders/:id/refund/process', async (req, res) => {
    try {
      const user = await authenticateSupabaseRequest(req, environment);
      const order = await getMarketplaceOrder(req.params.id, user.id, environment);
      const result = await processElectronicRefund(order, user.id, environment);
      res.status(result.httpStatus).json(result.body);
    } catch (error) { marketplaceErrorResponse(error, res); }
  });

  router.post('/orders/:id/payment', async (req, res) => {
    try {
      const user = await authenticateSupabaseRequest(req, environment);
      const order = await getMarketplaceOrder(req.params.id, user.id, environment);
      if (!['hyperpay', 'card'].includes(order.payment_method)) throw new MarketplaceApiError(400, 'ORDER_NOT_ELECTRONIC', 'هذا الطلب لا يستخدم الدفع الإلكتروني.');
      if (order.payment_status === 'paid') return res.json({ paid: true, order });
      if (order.payment_status === 'pending' && order.provider_reference) return res.json({ paid: false, checkoutId: order.provider_reference, reused: true });
      const provider = getPaymentProvider(environment);
      const payment = await provider.createPayment({ amount: order.total, currency: order.currency, merchantTransactionId: order.id });
      await markOrderPayment(order.id, user.id, payment.providerReference, 'pending', null, environment);
      res.status(201).json({ paid: false, checkoutId: payment.checkoutId, reused: false });
    } catch (error) { marketplaceErrorResponse(error, res); }
  });

  router.post('/orders/:id/payment/verify', async (req, res) => {
    try {
      const user = await authenticateSupabaseRequest(req, environment);
      const order = await getMarketplaceOrder(req.params.id, user.id, environment);
      if (order.payment_status === 'paid') return res.json({ paid: true, order });
      const checkoutId = String(req.body?.checkoutId || order.provider_reference || '');
      if (order.provider_reference && checkoutId !== order.provider_reference) throw new MarketplaceApiError(400, 'PAYMENT_REFERENCE_MISMATCH', 'مرجع الدفع لا يطابق الطلب.');
      const verification = await getPaymentProvider(environment).verifyPayment({ checkoutId });
      const status = verification.paid ? 'paid' : (verification.pending ? 'pending' : 'failed');
      await markOrderPayment(order.id, user.id, verification.providerReference, status, verification.resultCode, environment);
      res.json({ paid: verification.paid, pending: verification.pending, failed: status === 'failed', resultCode: verification.resultCode });
    } catch (error) { marketplaceErrorResponse(error, res); }
  });

  return router;
}
