require('dotenv').config();

function cleanBaseUrl(value) {
  return (value || '').replace(/\/+$/, '');
}

const env = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT || 3000),
  // If PUBLIC_BASE_URL is not set, /config.json derives it from the incoming Render request.
  // This avoids Journey Builder receiving localhost URLs.
  publicBaseUrl: cleanBaseUrl(process.env.PUBLIC_BASE_URL || ''),

  jwtSigningSecret: process.env.JWT_SIGNING_SECRET || '',
  jwtRequired: String(process.env.JWT_REQUIRED || 'true').toLowerCase() === 'true',

  dataDir: process.env.DATA_DIR || './data',

  sfmc: {
    clientId: process.env.SFMC_CLIENT_ID || '',
    clientSecret: process.env.SFMC_CLIENT_SECRET || '',
    authBaseUrl: cleanBaseUrl(process.env.SFMC_AUTH_BASE_URL || ''),
    restBaseUrl: cleanBaseUrl(process.env.SFMC_REST_BASE_URL || ''),
    accountId: process.env.SFMC_ACCOUNT_ID || ''
  },

  dataExtensions: {
    sendLogKey: process.env.DE_SEND_LOG_KEY || 'Relay_Email_SendLog',
    eventsKey: process.env.DE_EVENTS_KEY || 'Relay_Email_Events',
    activityConfigKey: process.env.DE_ACTIVITY_CONFIG_KEY || 'Relay_Email_ActivityConfig'
  },

  relay: {
    mode: process.env.RELAY_MODE || 'mock',
    sendUrl: process.env.RELAY_SEND_URL || '',
    authToken: process.env.RELAY_AUTH_TOKEN || '',
    timeoutMs: Number(process.env.RELAY_TIMEOUT_MS || 10000),
    webhookSecret: process.env.RELAY_WEBHOOK_SECRET || ''
  },

  corsOrigin: process.env.CORS_ORIGIN || '',
  uiEndpointsAllowUnsigned: String(process.env.UI_ENDPOINTS_ALLOW_UNSIGNED || 'true').toLowerCase() === 'true',
  enableTestSend: String(process.env.ENABLE_TEST_SEND || 'false').toLowerCase() === 'true',
  applicationExtensionKey: process.env.APP_EXTENSION_KEY || process.env.APPLICATION_EXTENSION_KEY || ''
};

module.exports = env;
