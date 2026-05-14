const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const env = require('../config/env');
const { getAccessToken, hasSfmcConfig } = require('./sfmcAuthService');
const { truncate } = require('../utils/object');

async function insertDataExtensionRows(externalKey, rows) {
  if (!hasSfmcConfig()) {
    console.warn(`[logService] SFMC credentials missing. Skipping DE insert for ${externalKey}.`);
    return {
      skipped: true
    };
  }

  const token = await getAccessToken();

  const payload = rows.map((row) => ({
    keys: row.keys || {},
    values: row.values || {}
  }));

  const response = await axios.post(
    `${env.sfmc.restBaseUrl}/hub/v1/dataevents/key:${encodeURIComponent(externalKey)}/rowset`,
    payload,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      timeout: 15000
    }
  );

  return response.data;
}

async function logSend(input) {
  const createdDate = new Date().toISOString();
  const sendLogId = input.sendLogId || uuidv4();

  const row = {
    keys: {
      SendLogId: sendLogId
    },
    values: {
      MessageId: truncate(input.messageId, 200),
      ProviderMessageId: truncate(input.providerMessageId, 200),
      ContactKey: truncate(input.contactKey, 100),
      EmailAddress: truncate(input.emailAddress, 254),
      JourneyId: truncate(input.journeyId, 100),
      JourneyVersionId: truncate(input.journeyVersionId, 100),
      ActivityId: truncate(input.activityId, 100),
      ActivityName: truncate(input.activityName, 200),
      ContentAssetId: truncate(input.contentAssetId, 50),
      Subject: truncate(input.subject, 500),
      Status: truncate(input.status, 50),
      ErrorCode: truncate(input.errorCode, 100),
      ErrorMessage: truncate(input.errorMessage, 4000),
      CreatedDate: input.createdDate || createdDate,
      UpdatedDate: input.updatedDate || createdDate
    }
  };

  try {
    await insertDataExtensionRows(env.dataExtensions.sendLogKey, [row]);
  } catch (error) {
    console.error('[logService] Failed to insert send log in SFMC DE:', error.response?.data || error.message);
  }

  return {
    sendLogId,
    ...row.values
  };
}

async function logEvent(input) {
  const createdDate = new Date().toISOString();
  const eventId = input.eventId || uuidv4();

  const row = {
    keys: {
      EventId: eventId
    },
    values: {
      MessageId: truncate(input.messageId, 200),
      ProviderMessageId: truncate(input.providerMessageId, 200),
      ContactKey: truncate(input.contactKey, 100),
      EmailAddress: truncate(input.emailAddress, 254),
      EventType: truncate(input.eventType, 50),
      EventDate: input.eventDate || createdDate,
      EventPayload: truncate(JSON.stringify(input.rawPayload || {}), 4000),
      CreatedDate: createdDate
    }
  };

  try {
    await insertDataExtensionRows(env.dataExtensions.eventsKey, [row]);
  } catch (error) {
    console.error('[logService] Failed to insert relay event in SFMC DE:', error.response?.data || error.message);
  }

  return {
    eventId,
    ...row.values
  };
}

async function logPublishedConfig(config) {
  const createdDate = new Date().toISOString();

  const row = {
    keys: {
      ConfigId: config.configId
    },
    values: {
      ActivityId: truncate(config.activityId, 100),
      JourneyId: truncate(config.journeyId, 100),
      JourneyVersionId: truncate(config.journeyVersionId, 100),
      ActivityName: truncate(config.activityName, 200),
      ContentAssetId: truncate(config.contentAssetId, 50),
      ContentSnapshotId: truncate(config.snapshotId, 100),
      SubjectTemplate: truncate(config.subject, 500),
      PreheaderTemplate: truncate(config.preheader, 500),
      FromName: truncate(config.sender?.fromName, 200),
      FromEmail: truncate(config.sender?.fromEmail, 254),
      ReplyTo: truncate(config.sender?.replyTo, 254),
      TokenMapping: truncate(JSON.stringify(config.tokenMapping || {}), 4000),
      Environment: truncate(config.environment, 50),
      IsPublished: true,
      CreatedDate: createdDate,
      UpdatedDate: createdDate
    }
  };

  try {
    await insertDataExtensionRows(env.dataExtensions.activityConfigKey, [row]);
  } catch (error) {
    console.error('[logService] Failed to insert activity config in SFMC DE:', error.response?.data || error.message);
  }

  return row.values;
}

module.exports = {
  logSend,
  logEvent,
  logPublishedConfig,
  insertDataExtensionRows
};
