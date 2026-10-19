'use strict';
/**
 * Zentro Browser - online services configuration.
 * Fill the empty values in once (see SETUP.md), then build the installer.
 * Nothing in this file is a secret: Firebase API keys, Stripe payment links and Google "desktop app"
 * client ids are meant to be public. The Stripe SECRET key only ever lives on your server (server/).
 */
module.exports = Object.freeze({
  APP_NAME: 'Zentro Browser',
  TEAM_NAME: 'Zentro dev team',

  // ---- Premium (Stripe) ------------------------------------------------------------------------
  STRIPE_PAYMENT_LINK: 'https://buy.stripe.com/test_5kQ3cv8hn3rU9uyfA69k400',
  // Base URL of the Zentro server from the /server folder, e.g. https://zentro-api.onrender.com
  API_BASE: '',

  // ---- Accounts (Firebase Authentication) ------------------------------------------------------
  FIREBASE_API_KEY: '',
  // Google sign-in: an OAuth client of type "Desktop app" from Google Cloud Console.
  GOOGLE_CLIENT_ID: '',
  GOOGLE_CLIENT_SECRET: '',
  // true  = the sign-in screen can be skipped ("Continue without an account")
  // false = nobody gets into the browser without an account
  ALLOW_SKIP_LOGIN: true,

  // ---- Update check (GitHub Releases) ----------------------------------------------------------
  // "owner/repository" of the GitHub repo that builds Zentro-Setup.exe, e.g. "DuggyDev/Zentro-Browser".
  UPDATE_REPO: 'DuggyDev/Zentro-Browser',
});
