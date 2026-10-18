'use strict';
/** Decides from Stripe Checkout Sessions whether an account has an active Premium purchase. Pure, no network. */

/**
 * @param sessions Stripe Checkout Session objects (subscription expanded when present)
 * @param who      { uid, email } of the verified account
 */
function evaluateSessions(sessions, who) {
  const email = String(who.email || '').toLowerCase();
  for (const s of Array.isArray(sessions) ? sessions : []) {
    if (!s || s.status !== 'complete') continue;
    const mine = (s.client_reference_id && s.client_reference_id === who.uid)
      || (email && String((s.customer_details && s.customer_details.email) || s.customer_email || '').toLowerCase() === email);
    if (!mine) continue;
    if (s.mode === 'subscription') {
      const sub = s.subscription;
      if (sub && typeof sub === 'object' && ['active', 'trialing'].includes(sub.status)) return { premium: true, until: sub.current_period_end ? sub.current_period_end * 1000 : null };
      continue; // cancelled or unpaid subscription
    }
    if (s.payment_status === 'paid' || s.payment_status === 'no_payment_required') return { premium: true, until: null };
  }
  return { premium: false, reason: 'none' };
}

module.exports = { evaluateSessions };
