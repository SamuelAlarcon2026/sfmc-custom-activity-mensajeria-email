const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { verifyJourneyPayload } = require('../services/jwtService');
const { getAssetById } = require('../services/sfmcAssetService');
const { buildSnapshot, renderEmail } = require('../services/renderService');
const { extractTokensFromTemplates, normalizeTokenMapping } = require('../services/tokenService');
const { sendEmail, verifyWebhookSignature } = require('../services/relayClient');
const { logSend, logEvent, logPublishedConfig } = require('../services/logService');
const {
  saveDraftConfig,
  savePublishedConfig,
  getPublishedConfig,
  saveSnapshot,
  getSnapshot,
  markMessageAccepted,
  getMessageStatus
} = require('../services/configStore');
const { flattenInArguments, pickFirst } = require('../utils/object');
const { safeParseJson } = require('../utils/safeJson');
const env = require('../config/env');

const router = express.Router();

function extractActivityConfig(payload = {}) {
  const inArgs = flattenInArguments(payload?.arguments?.execute?.inArguments || payload?.inArguments || []);
  const config = safeParseJson(inArgs.__relayActivityConfig, {});

  const activityId = pickFirst(
    config.activityId,
    payload.activityId,
    payload.activityObjectID,
    payload.key,
    payload.id
  );

  const journeyId = pickFirst(
    config.journeyId,
    payload.journeyId,
    payload.definitionInstanceId,
    payload.interactionId,
    payload?.metaData?.journeyId
  );

  const journeyVersionId = pickFirst(
    config.journeyVersionId,
    payload.journeyVersionId,
    payload.definitionId,
    payload?.metaData?.journeyVersionId
  );

  return {
    configId: config.configId || uuidv4(),
    activityId: activityId || 'unknownActivity',
    journeyId: journeyId || 'unknownJourney',
    journeyVersionId: journeyVersionId || 'unknownVersion',
    activityName: config.activityName || payload.name || 'Private Relay Email',
    environment: config.environment || 'uat',
    contentAssetId: String(config.contentAssetId || '').trim(),
    subject: config.subject || '',
    preheader: config.preheader || '',
    locale: config.locale || 'es-ES',
    sender: {
      fromName: config.sender?.fromName || '',
      fromEmail: config.sender?.fromEmail || '',
      replyTo: config.sender?.replyTo || ''
    },
    tokenMapping: normalizeTokenMapping(config.tokenMapping || {}),
    defaults: config.defaults || {},
    tracking: {
      openTracking: config.tracking?.openTracking !== false,
      clickTracking: config.tracking?.clickTracking !== false
    },
    snapshotMode: 'publish',
    raw: config
  };
}

function validateConfig(config) {
  const errors = [];

  if (!config.contentAssetId) {
    errors.push({
      field: 'contentAssetId',
      message: 'Content Asset ID es obligatorio.'
    });
  }

  if (!config.subject) {
    errors.push({
      field: 'subject',
      message: 'Subject es obligatorio.'
    });
  }

  if (!config.sender.fromName) {
    errors.push({
      field: 'sender.fromName',
      message: 'From Name es obligatorio.'
    });
  }

  if (!config.sender.fromEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(config.sender.fromEmail)) {
    errors.push({
      field: 'sender.fromEmail',
      message: 'From Email es obligatorio y debe ser un email válido.'
    });
  }

  if (!config.tokenMapping.emailAddress) {
    errors.push({
      field: 'tokenMapping.emailAddress',
      message: 'El mapeo emailAddress es obligatorio.'
    });
  }

  if (config.sender.replyTo && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(config.sender.replyTo)) {
    errors.push({
      field: 'sender.replyTo',
      message: 'Reply-To debe ser un email válido.'
    });
  }

  return errors;
}

function responseOk(res, data = {}) {
  return res.status(200).json({
    status: 'ok',
    ...data
  });
}

function responseValidation(res, valid, errors = [], warnings = []) {
  return res.status(200).json({
    valid,
    errors,
    warnings
  });
}

router.post('/save', async (req, res, next) => {
  try {
    const payload = verifyJourneyPayload(req);
    const config = extractActivityConfig(payload);
    await saveDraftConfig(config);

    return responseOk(res, {
      message: 'Draft configuration saved.'
    });
  } catch (error) {
    next(error);
  }
});

router.post('/validate', async (req, res, next) => {
  try {
    const payload = verifyJourneyPayload(req);
    const config = extractActivityConfig(payload);
    const errors = validateConfig(config);
    const warnings = [];

    const tokens = extractTokensFromTemplates({
      subject: config.subject,
      preheader: config.preheader
    });

    for (const token of tokens) {
      if (!config.tokenMapping[token.name] && !config.defaults[token.name]) {
        warnings.push({
          field: `tokenMapping.${token.name}`,
          message: `El token {{${token.name}}} aparece en subject/preheader, pero no tiene mapeo ni default.`
        });
      }
    }

    return responseValidation(res, errors.length === 0, errors, warnings);
  } catch (error) {
    next(error);
  }
});

router.post('/publish', async (req, res, next) => {
  try {
    const payload = verifyJourneyPayload(req);
    const config = extractActivityConfig(payload);
    const errors = validateConfig(config);

    if (errors.length) {
      return responseValidation(res, false, errors);
    }

    const asset = await getAssetById(config.contentAssetId);
    const snapshot = buildSnapshot({
      ...config,
      snapshotId: uuidv4()
    }, asset);

    const unmappedRequiredTokens = snapshot.requiredTokens.filter((token) => {
      return !config.tokenMapping[token] && !config.defaults[token];
    });

    if (unmappedRequiredTokens.length) {
      return responseValidation(res, false, unmappedRequiredTokens.map((token) => ({
        field: `tokenMapping.${token}`,
        message: `El token {{${token}}} aparece en el contenido, pero no tiene mapeo ni default.`
      })));
    }

    const savedSnapshot = await saveSnapshot(snapshot);
    const publishedConfig = await savePublishedConfig({
      ...config,
      snapshotId: savedSnapshot.snapshotId,
      publishedDate: new Date().toISOString()
    });

    await logPublishedConfig({
      ...publishedConfig,
      snapshotId: savedSnapshot.snapshotId
    });

    return responseOk(res, {
      message: 'Published configuration saved with content snapshot.',
      snapshotId: savedSnapshot.snapshotId,
      tokens: savedSnapshot.tokens
    });
  } catch (error) {
    next(error);
  }
});

router.post('/execute', async (req, res, next) => {
  const startedAt = new Date().toISOString();

  try {
    const payload = verifyJourneyPayload(req);
    const data = flattenInArguments(payload.inArguments || payload?.arguments?.execute?.inArguments || []);
    const configFromPayload = extractActivityConfig(payload);

    const identifiers = {
      journeyId: pickFirst(payload.journeyId, configFromPayload.journeyId, data.journeyId),
      journeyVersionId: pickFirst(payload.journeyVersionId, configFromPayload.journeyVersionId, data.journeyVersionId),
      activityId: pickFirst(payload.activityId, payload.activityObjectID, configFromPayload.activityId, data.activityId)
    };

    const publishedConfig = await getPublishedConfig(identifiers);
    const config = publishedConfig || configFromPayload;

    if (!publishedConfig) {
      console.warn('[execute] No published config found. Falling back to payload config.');
    }

    const snapshot = await getSnapshot(config.snapshotId);

    if (!snapshot) {
      const error = new Error('Published content snapshot was not found. Re-publish the journey or check persistent disk.');
      error.code = 'SNAPSHOT_NOT_FOUND';
      error.statusCode = 500;
      throw error;
    }

    const contactKey = pickFirst(data.contactKey, payload.contactKey, payload.key);
    const emailAddress = pickFirst(data.emailAddress, data.EmailAddress, data.email, data.Email);

    const messageId = [
      'sfmc',
      identifiers.journeyId || config.journeyId,
      identifiers.journeyVersionId || config.journeyVersionId,
      identifiers.activityId || config.activityId,
      contactKey || emailAddress
    ].join('-').replace(/[^a-zA-Z0-9_.@-]/g, '_');

    const previous = await getMessageStatus(messageId);
    if (previous && ['accepted', 'sent', 'delivered'].includes(previous.status)) {
      await logSend({
        messageId,
        providerMessageId: previous.providerMessageId,
        contactKey,
        emailAddress,
        journeyId: config.journeyId,
        journeyVersionId: config.journeyVersionId,
        activityId: config.activityId,
        activityName: config.activityName,
        contentAssetId: config.contentAssetId,
        subject: previous.subject,
        status: 'duplicate_skipped',
        createdDate: startedAt
      });

      return responseOk(res, {
        status: 'duplicate_skipped',
        messageId
      });
    }

    if (!emailAddress || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailAddress)) {
      await logSend({
        messageId,
        contactKey,
        emailAddress,
        journeyId: config.journeyId,
        journeyVersionId: config.journeyVersionId,
        activityId: config.activityId,
        activityName: config.activityName,
        contentAssetId: config.contentAssetId,
        status: 'skipped',
        errorCode: 'INVALID_EMAIL',
        errorMessage: 'Missing or invalid recipient email address.',
        createdDate: startedAt
      });

      return responseOk(res, {
        status: 'skipped',
        reason: 'INVALID_EMAIL'
      });
    }

    const rendered = renderEmail(snapshot, data, {
      defaults: config.defaults,
      escapeHtmlValues: true
    });

    if (rendered.missingRequiredTokens.length) {
      await logSend({
        messageId,
        contactKey,
        emailAddress,
        journeyId: config.journeyId,
        journeyVersionId: config.journeyVersionId,
        activityId: config.activityId,
        activityName: config.activityName,
        contentAssetId: config.contentAssetId,
        subject: rendered.subject,
        status: 'skipped',
        errorCode: 'MISSING_REQUIRED_TOKENS',
        errorMessage: `Missing required tokens: ${rendered.missingRequiredTokens.join(', ')}`,
        createdDate: startedAt
      });

      return responseOk(res, {
        status: 'skipped',
        reason: 'MISSING_REQUIRED_TOKENS',
        missingRequiredTokens: rendered.missingRequiredTokens
      });
    }

    const relayPayload = {
      messageId,
      recipient: {
        email: emailAddress,
        contactKey
      },
      sender: config.sender,
      content: {
        subject: rendered.subject,
        preheader: rendered.preheader,
        html: rendered.html,
        text: rendered.text
      },
      tracking: config.tracking || {
        openTracking: true,
        clickTracking: true
      },
      metadata: {
        source: 'SFMC',
        businessUnitId: env.sfmc.accountId || '',
        journeyId: config.journeyId,
        journeyVersionId: config.journeyVersionId,
        activityId: config.activityId,
        activityName: config.activityName,
        contentAssetId: config.contentAssetId,
        snapshotId: config.snapshotId,
        environment: config.environment
      }
    };

    const relayResponse = await sendEmail(relayPayload);
    const status = relayResponse.success ? (relayResponse.status || 'accepted') : 'failed';

    await markMessageAccepted(messageId, {
      status,
      providerMessageId: relayResponse.providerMessageId,
      subject: rendered.subject
    });

    await logSend({
      messageId,
      providerMessageId: relayResponse.providerMessageId,
      contactKey,
      emailAddress,
      journeyId: config.journeyId,
      journeyVersionId: config.journeyVersionId,
      activityId: config.activityId,
      activityName: config.activityName,
      contentAssetId: config.contentAssetId,
      subject: rendered.subject,
      status,
      createdDate: startedAt
    });

    return responseOk(res, {
      status,
      messageId,
      providerMessageId: relayResponse.providerMessageId
    });
  } catch (error) {
    next(error);
  }
});

router.post('/preview', async (req, res, next) => {
  try {
    const payload = verifyJourneyPayload(req, { allowUnsigned: true });
    const body = payload.body || payload;
    const config = body.activityConfig || extractActivityConfig(payload);
    const sampleData = body.sampleData || {};

    let snapshot = null;

    if (config.snapshotId) {
      snapshot = await getSnapshot(config.snapshotId);
    }

    if (!snapshot) {
      const asset = await getAssetById(config.contentAssetId);
      snapshot = buildSnapshot({
        ...config,
        snapshotId: 'preview'
      }, asset);
    }

    const rendered = renderEmail(snapshot, sampleData, {
      defaults: config.defaults,
      escapeHtmlValues: true
    });

    return res.json({
      status: 'ok',
      snapshotId: snapshot.snapshotId,
      tokens: snapshot.tokens,
      rendered
    });
  } catch (error) {
    next(error);
  }
});

router.post('/test', async (req, res, next) => {
  try {
    const payload = verifyJourneyPayload(req, { allowUnsigned: true });
    const body = payload.body || payload;
    const config = body.activityConfig || extractActivityConfig(payload);
    const sampleData = body.sampleData || {};
    const testRecipient = body.testRecipient || sampleData.emailAddress;

    if (!testRecipient || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(testRecipient)) {
      return res.status(400).json({
        status: 'error',
        message: 'testRecipient is required and must be a valid email address.'
      });
    }

    const asset = await getAssetById(config.contentAssetId);
    const snapshot = buildSnapshot({
      ...config,
      snapshotId: 'test'
    }, asset);

    const rendered = renderEmail(snapshot, {
      ...sampleData,
      emailAddress: testRecipient
    }, {
      defaults: config.defaults,
      escapeHtmlValues: true
    });

    const messageId = `sfmc-test-${Date.now()}-${uuidv4()}`;

    const relayPayload = {
      messageId,
      recipient: {
        email: testRecipient,
        contactKey: sampleData.contactKey || 'test-contact'
      },
      sender: config.sender,
      content: {
        subject: rendered.subject,
        preheader: rendered.preheader,
        html: rendered.html,
        text: rendered.text
      },
      tracking: config.tracking || {
        openTracking: true,
        clickTracking: true
      },
      metadata: {
        source: 'SFMC',
        test: true,
        activityName: config.activityName,
        contentAssetId: config.contentAssetId,
        environment: config.environment
      }
    };

    if (env.relay.mode === 'http' && !env.enableTestSend) {
      return res.json({
        status: 'preview_only',
        message: 'ENABLE_TEST_SEND=false. El email de test no se ha enviado al relay real.',
        messageId,
        rendered: relayPayload.content
      });
    }

    const relayResponse = await sendEmail(relayPayload);

    return res.json({
      status: relayResponse.success ? 'ok' : 'error',
      messageId,
      providerMessageId: relayResponse.providerMessageId,
      relayStatus: relayResponse.status
    });
  } catch (error) {
    next(error);
  }
});

router.post('/stop', async (req, res, next) => {
  try {
    verifyJourneyPayload(req);
    return responseOk(res, {
      message: 'Stop acknowledged.'
    });
  } catch (error) {
    next(error);
  }
});

router.post('/webhook/relay', async (req, res, next) => {
  try {
    const rawBody = req.rawBody || '';
    const signature = req.headers['x-relay-signature'];

    if (!verifyWebhookSignature(rawBody, signature)) {
      return res.status(401).json({
        status: 'error',
        message: 'Invalid relay webhook signature.'
      });
    }

    const event = req.body || {};

    await logEvent({
      messageId: event.messageId,
      providerMessageId: event.providerMessageId,
      contactKey: event.contactKey,
      emailAddress: event.recipient || event.emailAddress,
      eventType: event.eventType || event.type || 'unknown',
      eventDate: event.eventDate || event.timestamp || new Date().toISOString(),
      rawPayload: event
    });

    return responseOk(res);
  } catch (error) {
    next(error);
  }
});

module.exports = router;
