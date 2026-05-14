const axios = require('axios');
const env = require('../config/env');

let cachedToken = null;

function hasSfmcConfig() {
  return Boolean(
    env.sfmc.clientId &&
    env.sfmc.clientSecret &&
    env.sfmc.authBaseUrl &&
    env.sfmc.restBaseUrl
  );
}

async function getAccessToken() {
  if (!hasSfmcConfig()) {
    const error = new Error('SFMC API credentials are not configured.');
    error.code = 'SFMC_CONFIG_MISSING';
    throw error;
  }

  const now = Date.now();

  if (cachedToken && cachedToken.expiresAt > now + 60000) {
    return cachedToken.accessToken;
  }

  const payload = {
    grant_type: 'client_credentials',
    client_id: env.sfmc.clientId,
    client_secret: env.sfmc.clientSecret
  };

  if (env.sfmc.accountId) {
    payload.account_id = Number(env.sfmc.accountId);
  }

  const response = await axios.post(`${env.sfmc.authBaseUrl}/v2/token`, payload, {
    timeout: 10000
  });

  cachedToken = {
    accessToken: response.data.access_token,
    expiresAt: now + ((response.data.expires_in || 1080) * 1000)
  };

  return cachedToken.accessToken;
}

module.exports = {
  getAccessToken,
  hasSfmcConfig
};
