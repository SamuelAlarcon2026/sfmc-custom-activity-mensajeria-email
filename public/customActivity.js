/* global Postmonger */
(function () {
  const connection = window.Postmonger ? new Postmonger.Session() : null;
  let payload = {};
  let authTokens = {};
  let endpoints = {};
  let activityId = '';
  let journeyId = '';
  let journeyVersionId = '';

  const fields = {
    activityName: document.getElementById('activityName'),
    environment: document.getElementById('environment'),
    locale: document.getElementById('locale'),
    contentAssetId: document.getElementById('contentAssetId'),
    subject: document.getElementById('subject'),
    preheader: document.getElementById('preheader'),
    fromName: document.getElementById('fromName'),
    fromEmail: document.getElementById('fromEmail'),
    replyTo: document.getElementById('replyTo'),
    openTracking: document.getElementById('openTracking'),
    clickTracking: document.getElementById('clickTracking'),
    tokenMapping: document.getElementById('tokenMapping'),
    defaults: document.getElementById('defaults'),
    sampleData: document.getElementById('sampleData'),
    testRecipient: document.getElementById('testRecipient'),
    output: document.getElementById('output')
  };

  function parseJsonField(field, fallback) {
    try {
      return JSON.parse(field.value || '{}');
    } catch (error) {
      field.classList.add('error');
      throw new Error(`JSON inválido en ${field.id}: ${error.message}`);
    }
  }

  function clearErrors() {
    Object.values(fields).forEach((field) => {
      if (field && field.classList) field.classList.remove('error');
    });
  }

  function setOutput(value) {
    fields.output.textContent = typeof value === 'string'
      ? value
      : JSON.stringify(value, null, 2);
  }

  function getActivityConfig() {
    clearErrors();

    const tokenMapping = parseJsonField(fields.tokenMapping, {});
    const defaults = parseJsonField(fields.defaults, {});

    return {
      activityId,
      journeyId,
      journeyVersionId,
      activityName: fields.activityName.value || 'Private Relay Email',
      environment: fields.environment.value || 'uat',
      locale: fields.locale.value || 'es-ES',
      contentAssetId: fields.contentAssetId.value.trim(),
      subject: fields.subject.value,
      preheader: fields.preheader.value,
      sender: {
        fromName: fields.fromName.value,
        fromEmail: fields.fromEmail.value,
        replyTo: fields.replyTo.value
      },
      tokenMapping,
      defaults,
      tracking: {
        openTracking: fields.openTracking.checked,
        clickTracking: fields.clickTracking.checked
      },
      snapshotMode: 'publish'
    };
  }

  function setActivityConfig(config) {
    if (!config) return;

    fields.activityName.value = config.activityName || fields.activityName.value || '';
    fields.environment.value = config.environment || 'uat';
    fields.locale.value = config.locale || 'es-ES';
    fields.contentAssetId.value = config.contentAssetId || '';
    fields.subject.value = config.subject || '';
    fields.preheader.value = config.preheader || '';
    fields.fromName.value = config.sender?.fromName || '';
    fields.fromEmail.value = config.sender?.fromEmail || '';
    fields.replyTo.value = config.sender?.replyTo || '';
    fields.openTracking.checked = config.tracking?.openTracking !== false;
    fields.clickTracking.checked = config.tracking?.clickTracking !== false;

    if (config.tokenMapping) {
      fields.tokenMapping.value = JSON.stringify(config.tokenMapping, null, 2);
    }

    if (config.defaults) {
      fields.defaults.value = JSON.stringify(config.defaults, null, 2);
    }
  }

  function buildInArguments(config) {
    const args = {
      contactKey: '{{Contact.Key}}',
      __relayActivityConfig: JSON.stringify(config)
    };

    Object.entries(config.tokenMapping || {}).forEach(([key, value]) => {
      args[key] = value;
    });

    if (!args.emailAddress) {
      args.emailAddress = '{{Contact.Attribute.Profile.EmailAddress}}';
    }

    return [args];
  }

  function updatePayload() {
    const config = getActivityConfig();

    payload.name = config.activityName;
    payload.metaData = payload.metaData || {};
    payload.metaData.isConfigured = true;

    payload.arguments = payload.arguments || {};
    payload.arguments.execute = payload.arguments.execute || {};
    payload.arguments.execute.inArguments = buildInArguments(config);

    return payload;
  }

  function saveAndClose() {
    try {
      updatePayload();
      if (connection) {
        connection.trigger('updateActivity', payload);
      } else {
        setOutput({
          message: 'Postmonger no disponible. Payload generado:',
          payload
        });
      }
    } catch (error) {
      setOutput(error.message);
    }
  }

  async function apiPost(path, body) {
    const headers = {
      'Content-Type': 'application/json'
    };

    if (authTokens && authTokens.fuel2token) {
      headers.Authorization = `Bearer ${authTokens.fuel2token}`;
    }

    const response = await fetch(path, {
      method: 'POST',
      headers,
      body: JSON.stringify(body)
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(data.message || `HTTP ${response.status}`);
    }

    return data;
  }

  async function handleValidate() {
    try {
      const config = getActivityConfig();
      const errors = [];

      if (!config.contentAssetId) errors.push('Content Asset ID es obligatorio.');
      if (!config.subject) errors.push('Subject es obligatorio.');
      if (!config.sender.fromName) errors.push('From Name es obligatorio.');
      if (!config.sender.fromEmail) errors.push('From Email es obligatorio.');
      if (!config.tokenMapping.emailAddress) errors.push('tokenMapping.emailAddress es obligatorio.');

      if (errors.length) {
        setOutput({
          valid: false,
          errors
        });
        return;
      }

      setOutput({
        valid: true,
        message: 'Validación local correcta. La validación final se ejecutará en /validate y /publish.'
      });
    } catch (error) {
      setOutput(error.message);
    }
  }

  async function handlePreview() {
    try {
      const config = getActivityConfig();
      const sampleData = parseJsonField(fields.sampleData, {});
      const data = await apiPost('/preview', {
        activityConfig: config,
        sampleData
      });
      setOutput(data);
    } catch (error) {
      setOutput(error.message);
    }
  }

  async function handleTest() {
    try {
      const config = getActivityConfig();
      const sampleData = parseJsonField(fields.sampleData, {});
      const testRecipient = fields.testRecipient.value || sampleData.emailAddress;
      const data = await apiPost('/test', {
        activityConfig: config,
        sampleData,
        testRecipient
      });
      setOutput(data);
    } catch (error) {
      setOutput(error.message);
    }
  }

  function initJourneyBuilderEvents() {
    if (!connection) {
      setOutput('Modo local: Postmonger no disponible.');
      return;
    }

    connection.on('initActivity', function (data) {
      payload = data || {};
      activityId = payload.activityId || payload.activityObjectID || payload.key || payload.id || '';
      journeyId = payload.journeyId || payload.definitionInstanceId || '';
      journeyVersionId = payload.journeyVersionId || payload.definitionId || '';

      const args = payload.arguments?.execute?.inArguments || [];
      const configArg = args
        .map((item) => item && item.__relayActivityConfig)
        .find(Boolean);

      if (configArg) {
        try {
          setActivityConfig(JSON.parse(configArg));
        } catch (error) {
          setOutput(`No se pudo leer configuración existente: ${error.message}`);
        }
      }

      connection.trigger('ready');
      connection.trigger('requestTokens');
      connection.trigger('requestEndpoints');
    });

    connection.on('requestedTokens', function (tokens) {
      authTokens = tokens || {};
    });

    connection.on('requestedEndpoints', function (data) {
      endpoints = data || {};
    });

    connection.on('clickedNext', saveAndClose);
    connection.on('clickedDone', saveAndClose);

    connection.trigger('ready');
  }

  document.getElementById('validateBtn').addEventListener('click', handleValidate);
  document.getElementById('previewBtn').addEventListener('click', handlePreview);
  document.getElementById('testBtn').addEventListener('click', handleTest);

  initJourneyBuilderEvents();
})();
