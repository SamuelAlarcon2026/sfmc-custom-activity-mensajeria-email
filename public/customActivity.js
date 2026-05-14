/* global Postmonger */
(function () {
  var connection = window.Postmonger ? new Postmonger.Session() : null;
  var payload = {};
  var activityId = '';
  var journeyId = '';
  var journeyVersionId = '';

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

  function getStoredConfig(data) {
    try {
      var inArguments = data && data.arguments && data.arguments.execute && data.arguments.execute.inArguments;
      if (!Array.isArray(inArguments)) return null;

      for (var i = 0; i < inArguments.length; i += 1) {
        if (inArguments[i] && inArguments[i].__relayActivityConfig) {
          return JSON.parse(inArguments[i].__relayActivityConfig);
        }
      }
    } catch (error) {
      setOutput('No se pudo leer la configuración guardada: ' + error.message);
    }

    return null;
  }

  function buildInArguments(config) {
    return [{
      contactKey: '{{Contact.Key}}',
      emailAddress: config.tokenMapping.emailAddress,
      firstName: config.tokenMapping.firstName,
      __relayActivityConfig: JSON.stringify(config)
    }];
  }

  function validate(config) {
    var errors = [];

    if (!config.contentAssetId) errors.push('Content Asset ID es obligatorio.');
    if (!config.subject) errors.push('Subject es obligatorio.');
    if (!config.sender.fromName) errors.push('From Name es obligatorio.');
    if (!config.sender.fromEmail) errors.push('From Email es obligatorio.');
    if (!config.tokenMapping.emailAddress) errors.push('Email del destinatario es obligatorio.');

    return errors;
  }

  function save() {
    var config = getConfig();
    var errors = validate(config);

    if (errors.length) {
      setOutput({
        valid: false,
        errors: errors
      });

      if (connection) {
        connection.trigger('ready');
      }

      return;
    }

    payload.name = config.activityName;
    payload.metaData = payload.metaData || {};
    payload.metaData.isConfigured = true;

    payload.arguments = payload.arguments || {};
    payload.arguments.execute = payload.arguments.execute || {};
    payload.arguments.execute.inArguments = buildInArguments(config);

    setOutput({
      saving: true,
      activityName: config.activityName
    });

    if (connection) {
      connection.trigger('updateActivity', payload);
    }
  }

  function init() {
    if (!connection) {
      setOutput('Postmonger no está disponible. Abierto en modo local.');
      return;
    }

    connection.on('initActivity', function (data) {
      payload = data || {};
      activityId = payload.activityId || payload.activityObjectID || payload.key || payload.id || '';
      journeyId = payload.journeyId || payload.definitionInstanceId || payload.interactionId || '';
      journeyVersionId = payload.journeyVersionId || payload.definitionId || '';

      setConfig(getStoredConfig(payload));

      setOutput({
        status: 'ready',
        message: 'Modal cargado correctamente. Completa los campos y pulsa Done.',
        activityId: activityId || 'unknown'
      });

      connection.trigger('ready');
      connection.trigger('requestTokens');
      connection.trigger('requestEndpoints');
    });

    connection.on('clickedNext', save);
    connection.on('clickedDone', save);

    // Important: signal readiness immediately so Journey Builder does not keep
    // the modal in a pending state while it sends initActivity.
    connection.trigger('ready');
  }

  init();
}());
