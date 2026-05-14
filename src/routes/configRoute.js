const express = require('express');
const env = require('../config/env');

const router = express.Router();

function getBaseUrl(req) {
  if (env.publicBaseUrl) return env.publicBaseUrl;

  const forwardedProto = req.headers['x-forwarded-proto'];
  const proto = Array.isArray(forwardedProto) ? forwardedProto[0] : forwardedProto;
  const protocol = proto || req.protocol || 'https';
  const host = req.headers['x-forwarded-host'] || req.headers.host;

  return `${protocol}://${host}`.replace(/\/+$/, '');
}

function endpoint(baseUrl, path) {
  return `${baseUrl}${path}`;
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

  // Some SFMC tenants require this to match the Journey Builder Activity
  // component external key from the Installed Package. Leave it empty unless
  // APP_EXTENSION_KEY is configured in Render.
  if (env.applicationExtensionKey) {
    configurationArguments.applicationExtensionKey = env.applicationExtensionKey;
  }

  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.removeHeader('X-Frame-Options');
  res.removeHeader('Content-Security-Policy');

  res.json({
    workflowApiVersion: '1.1',
    type: 'REST',
    metaData: {
      icon: endpoint(baseUrl, '/images/icon.png'),
      iconSmall: endpoint(baseUrl, '/images/icon.png'),
      category: 'message',
      isConfigured: false,
      version: '0.1.3'
    },
    lang: {
      'en-US': {
        name: 'Private Relay Email',
        description: 'Send email through a private relay using an SFMC content snapshot'
      }
    },
    arguments: {
      execute: {
        inArguments: [
          {
            contactKey: '{{Contact.Key}}'
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
        url: endpoint(baseUrl, '/ui/index.html'),
        height: 700,
        width: 900,
        fullscreen: false
      }
    },
    schema: {
      arguments: {
        execute: {
          inArguments: [
            {
              contactKey: {
                dataType: 'Text',
                isNullable: false,
                direction: 'in'
              }
            }
          ],
          outArguments: []
        }
      }
    }
  });
});

module.exports = router;
