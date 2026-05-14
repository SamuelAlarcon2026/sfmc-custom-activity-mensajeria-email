const express = require('express');
const env = require('../config/env');

const router = express.Router();

function getBaseUrl(req) {
  if (env.publicBaseUrl) return env.publicBaseUrl;

  const forwardedProto = req.headers['x-forwarded-proto'];
  const proto = Array.isArray(forwardedProto) ? forwardedProto[0] : forwardedProto;
  const protocol = proto || req.protocol || 'https';
  const forwardedHost = req.headers['x-forwarded-host'];
  const host = Array.isArray(forwardedHost) ? forwardedHost[0] : (forwardedHost || req.headers.host);

  return `${protocol}://${host}`.replace(/\/+$/, '');
}

function endpoint(baseUrl, path) {
  return `${baseUrl}${path}`;
}

function noCacheJson(res) {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.removeHeader('X-Frame-Options');
  res.removeHeader('Content-Security-Policy');
}

router.get(['/config.json', '/config'], (req, res) => {
  const baseUrl = getBaseUrl(req);

  const configurationArguments = {
    save: {
      url: endpoint(baseUrl, '/save'),
      verb: 'POST',
      body: '',
      header: '',
      format: 'json',
      useJwt: true
    },
    validate: {
      url: endpoint(baseUrl, '/validate'),
      verb: 'POST',
      body: '',
      header: '',
      format: 'json',
      useJwt: true
    },
    publish: {
      url: endpoint(baseUrl, '/publish'),
      verb: 'POST',
      body: '',
      header: '',
      format: 'json',
      useJwt: true
    },
    stop: {
      url: endpoint(baseUrl, '/stop'),
      verb: 'POST',
      body: '',
      header: '',
      format: 'json',
      useJwt: true
    }
  };

  if (env.applicationExtensionKey) {
    configurationArguments.applicationExtensionKey = env.applicationExtensionKey;
  }

  noCacheJson(res);

  res.json({
    workflowApiVersion: '1.1',
    type: 'REST',
    metaData: {
      icon: endpoint(baseUrl, '/images/icon.png'),
      iconSmall: endpoint(baseUrl, '/images/icon.png'),
      category: 'message',
      isConfigured: false,
      version: '0.1.4'
    },
    lang: {
      'en-US': {
        name: 'Private Relay Email',
        description: 'Send email through a private relay using an SFMC content snapshot'
      },
      'es-ES': {
        name: 'Private Relay Email',
        description: 'Envío de email por relay privado usando snapshot de contenido SFMC'
      }
    },
    arguments: {
      execute: {
        inArguments: [
          {
            contactKey: '{{Contact.Key}}',
            emailAddress: '{{Contact.Attribute.Profile.EmailAddress}}'
          }
        ],
        outArguments: [],
        url: endpoint(baseUrl, '/execute'),
        verb: 'POST',
        body: '',
        header: '',
        format: 'json',
        useJwt: true,
        timeout: 10000
      }
    },
    configurationArguments,
    wizardSteps: [
      {
        label: 'Configuration',
        key: 'configuration'
      }
    ],
    userInterfaces: {
      configModal: {
        // Some Journey Builder tenants use this explicit URL.
        // Others open the package endpoint URL directly. Therefore /, /index.html,
        // /ui and /ui/index.html all serve the same HTML in server.js.
        url: endpoint(baseUrl, '/'),
        height: 700,
        width: 900,
        fullscreen: false
      }
    }
  });
});

router.get('/debug/config', (req, res) => {
  const baseUrl = getBaseUrl(req);
  noCacheJson(res);
  res.json({
    detectedBaseUrl: baseUrl,
    publicBaseUrl: env.publicBaseUrl || null,
    uiUrl: endpoint(baseUrl, '/'),
    configUrl: endpoint(baseUrl, '/config.json'),
    applicationExtensionKeyConfigured: Boolean(env.applicationExtensionKey),
    note: 'In the Journey Builder Activity component, use the base URL as Endpoint URL, not /config.json.'
  });
});

module.exports = router;
