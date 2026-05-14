const axios = require('axios');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const env = require('../config/env');

async function sendEmail(payload) {
  if (env.relay.mode === 'mock') {
    return {
      success: true,
      status: 'accepted',
      providerMessageId: `mock-${uuidv4()}`,
      raw: {
        mock: true
      }
    };
  }

  if (env.relay.mode !== 'http') {
    const error = new Error(`Unsupported RELAY_MODE: ${env.relay.mode}`);
    error.code = 'RELAY_MODE_UNSUPPORTED';
    throw error;
  }

  if (!env.relay.sendUrl) {
    const error = new Error('RELAY_SEND_URL is not configured.');
    error.code = 'RELAY_CONFIG_MISSING';
    throw error;
  }

  const headers = {
    'Content-Type': 'application/json'
  };

  if (env.relay.authToken) {
    headers.Authorization = `Bearer ${env.relay.authToken}`;
  }

  const response = await axios.post(env.relay.sendUrl, payload, {
    headers,
    timeout: env.relay.timeoutMs
  });

  return {
    success: response.data?.success !== false,
    status: response.data?.status || 'accepted',
    providerMessageId: response.data?.providerMessageId || response.data?.id || '',
    raw: response.data
  };
}

function verifyWebhookSignature(rawBody, signature) {
  if (!env.relay.webhookSecret) return true;
  if (!signature) return false;

  const expected = crypto
    .createHmac('sha256', env.relay.webhookSecret)
    .update(rawBody || '')
    .digest('hex');

  const cleanSignature = String(signature).replace(/^sha256=/, '');

  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(cleanSignature));
  } catch {
    return false;
  }
}

module.exports = {
  sendEmail,
  verifyWebhookSignature
};
