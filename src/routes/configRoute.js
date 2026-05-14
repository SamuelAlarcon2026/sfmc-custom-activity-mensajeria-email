const express = require('express');
const env = require('../config/env');

const router = express.Router();

router.get('/config.json', (_req, res) => {
  const baseUrl = env.publicBaseUrl;

  res.json({
    workflowApiVersion: '1.1',
    type: 'REST',
    metaData: {
      icon: `${baseUrl}/images/icon.svg`,
      category: 'message',
      isConfigured: false
    },
    lang: {
      'en-US': {
        name: 'Private Relay Email',
        description: 'Send an email using SFMC Content Builder snapshot and a private relay'
      },
      'es-ES': {
        name: 'Email Relay Privado',
        description: 'Envía un email usando snapshot de Content Builder y relay privado'
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
        url: `${baseUrl}/execute`,
        verb: 'POST',
        body: '',
        header: '',
        format: 'json',
        useJwt: true,
        timeout: 10000
      }
    },
    configurationArguments: {
      save: {
        url: `${baseUrl}/save`,
        verb: 'POST',
        useJwt: true
      },
      validate: {
        url: `${baseUrl}/validate`,
        verb: 'POST',
        useJwt: true
      },
      publish: {
        url: `${baseUrl}/publish`,
        verb: 'POST',
        useJwt: true
      },
      stop: {
        url: `${baseUrl}/stop`,
        verb: 'POST',
        useJwt: true
      }
    },
    userInterfaces: {
      configModal: {
        url: `${baseUrl}/index.html`,
        height: 760,
        width: 1040,
        fullscreen: false
      }
    },
    schema: {
      arguments: {
        execute: {
          inArguments: [],
          outArguments: []
        }
      }
    }
  });
});

module.exports = router;
