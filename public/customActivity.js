/* global Postmonger */
(function () {
  'use strict';

  var connection = null;
  var payload = {};
  var activityId = '';
  var journeyId = '';
  var journeyVersionId = '';
  var hasInitActivity = false;

  var fields = {
    activityName: document.getElementById('activityName'),
    emailAddress: document.getElementById('emailAddress'),
    contentAssetId: document.getElementById('contentAssetId'),
    subject: document.getElementById('subject'),
    fromName: document.getElementById('fromName'),
    fromEmail: document.getElementById('fromEmail'),
    output: document.getElementById('output')
  };

  function setOutput(value) {
    if (!fields.output) return;
    fields.output.textContent = typeof value === 'string'
      ? value
      : JSON.stringify(value, null, 2);
  }

  function safeJsonParse(value, fallback) {
    try {
      return value ? JSON.parse(value) : fallback;
    } catch (_error) {
      return fallback;
    }
  }

  function getConfig() {
    return {
      activityId: activityId || 'unknownActivity',
      journeyId: journeyId || 'unknownJourney',
      journeyVersionId: journeyVersionId || 'unknownVersion',
      activityName: fields.activityName.value || 'Private Relay Email',
      environment: 'uat',
      locale: 'es-ES',
      contentAssetId: (fields.contentAssetId.value || '').trim(),
      subject: fields.subject.value || '',
      preheader: '',
      sender: {
        fromName: fields.fromName.value || '',
        fromEmail: fields.fromEmail.value || '',
        replyTo: ''
      },
      tokenMapping: {
        emailAddress: fields.emailAddress.value || '{{Contact.Attribute.Profile.EmailAddress}}',
        firstName: '{{Contact.Attribute.Profile.FirstName}}'
      },
      defaults: {
        firstName: 'cliente'
      },
      tracking: {
        openTracking: true,
        clickTracking: true
      },
      snapshotMode: 'publish'
    };
  }

  function setConfig(config) {
    if (!config) return;

    fields.activityName.value = config.activityName || fields.activityName.value;
    fields.emailAddress.value = (config.tokenMapping && config.tokenMapping.emailAddress) || fields.emailAddress.value;
    fields.contentAssetId.value = config.contentAssetId || '';
    fields.subject.value = config.subject || '';
    fields.fromName.value = (config.sender && config.sender.fromName) || '';
    fields.fromEmail.value = (config.sender && config.sender.fromEmail) || '';
  }

  function flattenInArguments(inArguments) {
    var result = {};
    if (!Array.isArray(inArguments)) return result;

    inArguments.forEach(function (item) {
      Object.keys(item || {}).forEach(function (key) {
        result[key] = item[key];
      });
    });

    return result;
  }

  function getStoredConfig(data) {
    var inArguments = data && data.arguments && data.arguments.execute && data.arguments.execute.inArguments;
    var flat = flattenInArguments(inArguments || []);
    return safeJsonParse(flat.__relayActivityConfig, null);
  }

  function buildInArguments(config) {
    return [{
      contactKey: '{{Contact.Key}}',
      emailAddress: config.tokenMapping.emailAddress,
      firstName: config.tokenMapping.firstName,
      __relayActivityConfig: JSON.stringify(config)
    }];
  }

  function ensurePayloadShape() {
    payload.metaData = payload.metaData || {};
    payload.arguments = payload.arguments || {};
    payload.arguments.execute = payload.arguments.execute || {};
    payload.arguments.execute.inArguments = payload.arguments.execute.inArguments || [];
    payload.arguments.execute.outArguments = payload.arguments.execute.outArguments || [];
  }

  function save() {
    var config = getConfig();

    ensurePayloadShape();

    payload.name = config.activityName;
    payload.metaData.isConfigured = true;
    payload.metaData.icon = payload.metaData.icon || '/images/icon.png';

    payload.arguments.execute.inArguments = buildInArguments(config);

    setOutput({
      status: 'saving',
      message: 'Enviando updateActivity a Journey Builder...',
      activityName: config.activityName
    });

    connection.trigger('updateActivity', payload);
  }

  function onInitActivity(data) {
    hasInitActivity = true;
    payload = data || {};

    activityId = payload.activityId || payload.activityObjectID || payload.key || payload.id || '';
    journeyId = payload.journeyId || payload.definitionInstanceId || payload.interactionId || '';
    journeyVersionId = payload.journeyVersionId || payload.definitionId || '';

    setConfig(getStoredConfig(payload));

    setOutput({
      status: 'ready',
      message: 'Modal conectado con Journey Builder.',
      activityId: activityId || 'unknown',
      hasExistingConfig: Boolean(getStoredConfig(payload))
    });

    connection.trigger('ready');
  }

  function init() {
    if (!window.Postmonger || !window.Postmonger.Session) {
      setOutput('Postmonger no está disponible. La página abrió, pero no podrá comunicarse con Journey Builder.');
      return;
    }

    connection = new window.Postmonger.Session();

    connection.on('initActivity', onInitActivity);
    connection.on('clickedNext', save);
    connection.on('clickedDone', save);

    connection.on('requestedTokens', function (tokens) {
      setOutput({
        status: hasInitActivity ? 'ready' : 'waitingInitActivity',
        message: 'Tokens recibidos desde Journey Builder.',
        tokenKeys: Object.keys(tokens || {})
      });
    });

    connection.on('requestedEndpoints', function () {
      // No-op. Kept for compatibility.
    });

    // Tell Journey Builder the iframe is ready. This is what enables the modal footer.
    connection.trigger('ready');
    connection.trigger('requestTokens');
    connection.trigger('requestEndpoints');

    setOutput({
      status: 'waitingInitActivity',
      message: 'Postmonger cargado. Esperando initActivity de Journey Builder...'
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
}());
