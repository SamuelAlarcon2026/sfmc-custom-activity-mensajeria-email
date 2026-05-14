(function () {
  'use strict';

  var STEPS = [
    { id: 1, label: 'Plantilla' },
    { id: 2, label: 'Envío' },
    { id: 3, label: 'Preview' },
    { id: 4, label: 'Test' }
  ];

  var DEFAULT_CONFIG = {
    assetId: '',
    assetCustomerKey: '',
    assetName: '',
    subject: '',
    preheader: '',
    fromName: '',
    fromEmail: '',
    replyTo: '',
    recipientExpression: '{{InteractionDefaults.Email}}',
    variableMappings: {},
    sampleData: {},
    requiredVariables: [],
    templateSnapshot: {
      html: '',
      text: ''
    },
    warnings: []
  };

  var connection = new Postmonger.Session();
  var state = {
    activity: null,
    tokens: null,
    endpoints: null,
    step: 1,
    loading: false,
    assets: [],
    assetSearch: '',
    selectedAsset: null,
    variables: [],
    preview: null,
    testResult: null,
    errors: [],
    notices: [],
    config: clone(DEFAULT_CONFIG)
  };

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function $(selector, root) {
    return (root || document).querySelector(selector);
  }

  function $all(selector, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(selector));
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function attr(value) {
    return escapeHtml(value).replace(/`/g, '&#96;');
  }

  function isEmail(value) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
  }

  function normalizeVariableName(value) {
    return String(value || '').trim();
  }

  function ensureExpression(value) {
    var text = String(value || '').trim();
    if (!text) return '';
    if (/^{{[\s\S]*}}$/.test(text)) return text;
    return '{{' + text + '}}';
  }

  function showNotice(message, variant) {
    state.notices = [{ message: message, variant: variant || 'info' }];
    render();
  }

  function setErrors(errors) {
    state.errors = Array.isArray(errors) ? errors : [String(errors || 'Error desconocido')];
    render();
  }

  async function fetchJson(url, options) {
    var controller = window.AbortController ? new AbortController() : null;
    var timeoutMs = 30000;
    var timeoutId = controller ? window.setTimeout(function () {
      controller.abort();
    }, timeoutMs) : null;

    try {
      var response = await fetch(url, Object.assign({
        headers: {
          'Content-Type': 'application/json'
        },
        signal: controller ? controller.signal : undefined
      }, options || {}));

      var body = {};
      var text = await response.text();

      try {
        body = text ? JSON.parse(text) : {};
      } catch (_err) {
        body = { raw: text };
      }

      if (!response.ok) {
        var details = body.error && body.error.details ? body.error.details : [];
        var message = body.error && body.error.message ? body.error.message : 'Error HTTP ' + response.status;
        var error = new Error(message);
        error.details = details;
        error.body = body;
        throw error;
      }

      return body;
    } catch (err) {
      if (err && err.name === 'AbortError') {
        throw new Error('La petición tardó más de ' + Math.round(timeoutMs / 1000) + ' segundos. Revisa en Render las variables SFMC_AUTH_BASE_URL, SFMC_REST_BASE_URL, SFMC_CLIENT_ID, SFMC_CLIENT_SECRET y los permisos assets_read.');
      }
      throw err;
    } finally {
      if (timeoutId) window.clearTimeout(timeoutId);
    }
  }

  function extractInArgumentConfig(activity) {
    var inArgs = activity
      && activity.arguments
      && activity.arguments.execute
      && activity.arguments.execute.inArguments;

    if (!Array.isArray(inArgs) || !inArgs.length) return null;

    var merged = inArgs.reduce(function (acc, item) {
      if (item && typeof item === 'object') {
        Object.keys(item).forEach(function (key) {
          acc[key] = item[key];
        });
      }
      return acc;
    }, {});

    return merged.config || null;
  }

  function hydrateFromActivity(activity) {
    state.activity = activity || state.activity || {};

    var existing = extractInArgumentConfig(state.activity);
    if (existing) {
      state.config = Object.assign(clone(DEFAULT_CONFIG), existing, {
        templateSnapshot: Object.assign(clone(DEFAULT_CONFIG.templateSnapshot), existing.templateSnapshot || {})
      });
      state.selectedAsset = {
        id: state.config.assetId,
        customerKey: state.config.assetCustomerKey,
        name: state.config.assetName,
        subject: state.config.subject,
        preheader: state.config.preheader
      };
      state.variables = detectVariablesClient([
        state.config.subject,
        state.config.preheader,
        state.config.templateSnapshot.html,
        state.config.templateSnapshot.text
      ].join('\n'));
      ensureMappingsForVariables();
    }

    render();
    updateJourneyButtons();
  }

  function detectVariablesClient(text) {
    var variables = {};
    var regex = /{{\s*([A-Za-z0-9_.-]+)\s*}}/g;
    var match;

    while ((match = regex.exec(String(text || ''))) !== null) {
      variables[normalizeVariableName(match[1])] = true;
    }

    return Object.keys(variables).sort(function (a, b) { return a.localeCompare(b); });
  }

  function ensureMappingsForVariables() {
    state.config.variableMappings = state.config.variableMappings || {};
    state.config.sampleData = state.config.sampleData || {};

    state.variables.forEach(function (variable) {
      if (!state.config.variableMappings[variable]) {
        state.config.variableMappings[variable] = {
          type: 'fixed',
          value: '',
          path: '',
          sampleValue: '',
          fallbackValue: '',
          required: true
        };
      }
    });
  }

  async function searchAssets() {
    readConfigFromForm();
    state.loading = true;
    state.errors = [];
    render();

    try {
      var query = new URLSearchParams({
        page: '1',
        pageSize: '25',
        search: state.assetSearch || '',
        assetType: 'all'
      });
      var result = await fetchJson('/api/assets?' + query.toString());
      state.assets = result.items || [];
      state.loading = false;
      state.notices = result.fallback
        ? [{ message: 'SFMC no aceptó la query avanzada; se usó listado básico con filtrado local.', variant: 'warning' }]
        : [];
      render();
    } catch (err) {
      state.loading = false;
      setErrors([err.message].concat(err.details || []));
    }
  }

  async function selectAsset(assetId) {
    readConfigFromForm();
    state.loading = true;
    state.errors = [];
    render();

    try {
      var result = await fetchJson('/api/assets/' + encodeURIComponent(assetId));
      var asset = result.asset;
      state.selectedAsset = asset;

      state.config.assetId = String(asset.id || '');
      state.config.assetCustomerKey = asset.customerKey || '';
      state.config.assetName = asset.name || '';
      state.config.subject = asset.subject || state.config.subject || '';
      state.config.preheader = asset.preheader || state.config.preheader || '';
      state.config.templateSnapshot = {
        html: asset.html || '',
        text: asset.text || ''
      };
      state.config.warnings = asset.warnings || [];

      state.variables = asset.variables || detectVariablesClient([
        state.config.subject,
        state.config.preheader,
        state.config.templateSnapshot.html,
        state.config.templateSnapshot.text
      ].join('\n'));

      ensureMappingsForVariables();

      state.loading = false;
      state.step = 2;
      state.notices = [{ message: 'Asset seleccionado y variables detectadas.', variant: 'success' }];
      render();
      updateJourneyButtons();
    } catch (err) {
      state.loading = false;
      setErrors([err.message].concat(err.details || []));
    }
  }

  function readConfigFromForm() {
    var form = $('#activity-form');
    if (!form) return;

    state.assetSearch = ($('#asset-search') || {}).value || state.assetSearch;

    var fieldIds = [
      'subject',
      'preheader',
      'fromName',
      'fromEmail',
      'replyTo',
      'recipientExpression'
    ];

    fieldIds.forEach(function (id) {
      var el = $('#' + id);
      if (el) state.config[id] = el.value;
    });

    state.config.variableMappings = state.config.variableMappings || {};
    state.config.sampleData = {};

    state.variables.forEach(function (variable) {
      var safe = cssSafe(variable);
      var typeEl = $('[data-var-type="' + safe + '"]');
      var valueEl = $('[data-var-value="' + safe + '"]');
      var pathEl = $('[data-var-path="' + safe + '"]');
      var sampleEl = $('[data-var-sample="' + safe + '"]');
      var requiredEl = $('[data-var-required="' + safe + '"]');

      var mapping = state.config.variableMappings[variable] || {};
      mapping.type = typeEl ? typeEl.value : mapping.type || 'fixed';
      mapping.value = valueEl ? valueEl.value : mapping.value || '';
      mapping.path = pathEl ? pathEl.value : mapping.path || '';
      mapping.sampleValue = sampleEl ? sampleEl.value : mapping.sampleValue || '';
      mapping.required = requiredEl ? requiredEl.checked : mapping.required !== false;

      state.config.variableMappings[variable] = mapping;
      if (mapping.sampleValue) {
        state.config.sampleData[variable] = mapping.sampleValue;
      }
    });
  }

  function cssSafe(value) {
    return encodeURIComponent(value).replace(/%/g, '_');
  }

  function variableFromSafe(safeValue) {
    var encoded = String(safeValue || '').replace(/_/g, '%');
    try { return decodeURIComponent(encoded); } catch (_err) { return safeValue; }
  }

  function localValidation() {
    readConfigFromForm();
    var errors = [];

    if (!state.config.assetId) errors.push('Selecciona un asset.');
    if (!String(state.config.subject || '').trim()) errors.push('El subject es obligatorio.');
    if (!isEmail(state.config.fromEmail)) errors.push('From Email debe tener formato válido.');
    if (state.config.replyTo && !isEmail(state.config.replyTo)) errors.push('Reply-To debe tener formato válido.');
    if (!String(state.config.recipientExpression || '').trim()) errors.push('Configura el destinatario.');

    state.variables.forEach(function (variable) {
      var mapping = state.config.variableMappings[variable] || {};
      if (mapping.required === false) return;

      if (mapping.type === 'fixed' && !String(mapping.value || '').trim()) {
        errors.push('La variable {{' + variable + '}} requiere valor fijo o cambia su origen.');
      }

      if ((mapping.type === 'journeyData' || mapping.type === 'contactData') && !String(mapping.path || '').trim()) {
        errors.push('La variable {{' + variable + '}} requiere expresión de datos.');
      }
    });

    return errors;
  }

  function canContinue() {
    readConfigFromForm();
    if (state.step === 1) return !!state.config.assetId;
    if (state.step === 2) return localValidation().length === 0;
    if (state.step === 3) return localValidation().length === 0;
    if (state.step === 4) return localValidation().length === 0;
    return true;
  }

  async function generatePreview() {
    readConfigFromForm();
    state.loading = true;
    state.errors = [];
    render();

    try {
      var result = await fetchJson('/api/preview', {
        method: 'POST',
        body: JSON.stringify({
          assetId: state.config.assetId,
          subject: state.config.subject,
          preheader: state.config.preheader,
          html: state.config.templateSnapshot.html,
          text: state.config.templateSnapshot.text,
          variableMappings: state.config.variableMappings,
          sampleData: state.config.sampleData,
          warnings: state.config.warnings
        })
      });

      state.preview = result;
      state.loading = false;
      state.notices = [{ message: 'Preview renderizado.', variant: 'success' }];
      render();
      updateJourneyButtons();
    } catch (err) {
      state.loading = false;
      setErrors([err.message].concat(err.details || []));
    }
  }

  async function sendTest() {
    readConfigFromForm();

    var testEmail = ($('#testEmail') || {}).value || '';
    if (!isEmail(testEmail)) {
      setErrors(['Introduce un email de test válido.']);
      return;
    }

    var errors = localValidation();
    if (errors.length) {
      setErrors(errors);
      return;
    }

    state.loading = true;
    state.errors = [];
    state.testResult = null;
    render();

    try {
      var result = await fetchJson('/api/test-send', {
        method: 'POST',
        body: JSON.stringify({
          to: testEmail,
          fromName: state.config.fromName,
          fromEmail: state.config.fromEmail,
          replyTo: state.config.replyTo,
          subject: state.config.subject,
          preheader: state.config.preheader,
          html: state.config.templateSnapshot.html,
          text: state.config.templateSnapshot.text,
          variableMappings: state.config.variableMappings,
          sampleData: state.config.sampleData,
          warnings: state.config.warnings,
          assetId: state.config.assetId
        })
      });

      state.testResult = result;
      state.loading = false;
      state.notices = [{ message: 'Test enviado al relay privado.', variant: 'success' }];
      render();
    } catch (err) {
      state.loading = false;
      setErrors([err.message].concat(err.details || []));
    }
  }

  function buildInArgument() {
    readConfigFromForm();

    var resolvedData = {};
    var flat = {};

    Object.keys(state.config.variableMappings || {}).forEach(function (variable) {
      var mapping = state.config.variableMappings[variable] || {};
      if (mapping.type === 'journeyData' || mapping.type === 'contactData') {
        var expression = ensureExpression(mapping.path);
        if (expression) {
          resolvedData[variable] = expression;
          flat['var_' + variable] = expression;
        }
      }
    });

    var emailExpression = ensureExpression(state.config.recipientExpression || '{{InteractionDefaults.Email}}');

    return Object.assign({
      config: state.config,
      contactKey: '{{Contact.Key}}',
      emailAddress: emailExpression,
      resolvedData: resolvedData
    }, flat);
  }

  function updateActivity() {
    var errors = localValidation();

    if (errors.length) {
      setErrors(errors);
      updateJourneyButtons();
      return false;
    }

    var activity = state.activity || {};
    activity.arguments = activity.arguments || {};
    activity.arguments.execute = activity.arguments.execute || {};
    activity.arguments.execute.inArguments = [buildInArgument()];

    activity.metaData = activity.metaData || {};
    activity.metaData.isConfigured = true;
    activity.name = activity.name || 'Email por relay privado';

    connection.trigger('updateActivity', activity);
    return true;
  }

  function updateJourneyButtons() {
    try {
      connection.trigger('updateButton', {
        button: 'back',
        visible: state.step > 1
      });
      connection.trigger('updateButton', {
        button: 'next',
        text: state.step === STEPS.length ? 'Done' : 'Next',
        visible: true,
        enabled: canContinue()
      });
    } catch (_err) {
      // Journey Builder controls these buttons. Ignore when running standalone.
    }
  }

  function gotoStep(step) {
    readConfigFromForm();
    var next = Math.max(1, Math.min(STEPS.length, Number(step) || 1));
    state.step = next;
    state.errors = [];
    render();
    updateJourneyButtons();

    if (state.step === 3 && !state.preview) {
      generatePreview();
    }
  }

  function onClickedNext() {
    readConfigFromForm();

    if (state.step < STEPS.length) {
      var errors = state.step >= 2 ? localValidation() : [];
      if (state.step === 1 && !state.config.assetId) {
        errors.push('Selecciona una plantilla antes de continuar.');
      }

      if (errors.length) {
        setErrors(errors);
        updateJourneyButtons();
        return;
      }

      gotoStep(state.step + 1);
      return;
    }

    updateActivity();
  }

  function render() {
    var app = $('#app');
    app.innerHTML = [
      '<form id="activity-form" class="slds-p-around_medium" novalidate>',
      renderHeader(),
      renderAlerts(),
      renderStepContent(),
      renderLocalFooter(),
      '</form>'
    ].join('');

    bindEvents();
  }

  function renderHeader() {
    return [
      '<div class="slds-page-header slds-page-header_record-home slds-m-bottom_medium">',
      '<div class="slds-page-header__row">',
      '<div class="slds-page-header__col-title">',
      '<div class="slds-media">',
      '<div class="slds-media__figure"><span class="slds-avatar slds-avatar_medium"><img src="/images/icon.png" alt=""></span></div>',
      '<div class="slds-media__body">',
      '<div class="slds-page-header__name">',
      '<div class="slds-page-header__name-title">',
      '<h1><span>Email por relay privado</span><span class="slds-page-header__title slds-truncate">Journey Builder Custom Activity</span></h1>',
      '</div>',
      '</div>',
      '<p class="slds-page-header__name-meta">Selecciona un email asset de Content Builder, resuelve {{variables}} y envía mediante relay HTTP externo.</p>',
      '</div></div></div></div>',
      renderPath(),
      '</div>'
    ].join('');
  }

  function renderPath() {
    return [
      '<div class="slds-path slds-m-top_medium">',
      '<div class="slds-grid slds-path__track">',
      '<div class="slds-grid slds-path__scroller-container">',
      '<div class="slds-path__scroller" role="application">',
      '<div class="slds-path__scroller_inner">',
      '<ul class="slds-path__nav" role="listbox" aria-orientation="horizontal">',
      STEPS.map(function (step) {
        var cls = step.id === state.step ? 'slds-is-current slds-is-active' : step.id < state.step ? 'slds-is-complete' : 'slds-is-incomplete';
        return [
          '<li class="slds-path__item ', cls, '" role="presentation">',
          '<a aria-selected="', step.id === state.step ? 'true' : 'false', '" class="slds-path__link" href="#" data-step="', step.id, '">',
          '<span class="slds-path__stage"><span class="slds-assistive-text">', escapeHtml(step.label), '</span></span>',
          '<span class="slds-path__title">', escapeHtml(step.label), '</span>',
          '</a></li>'
        ].join('');
      }).join(''),
      '</ul></div></div></div></div></div>'
    ].join('');
  }

  function renderAlerts() {
    var html = [];

    if (state.loading) {
      html.push('<div class="slds-notify slds-notify_alert slds-theme_info slds-m-bottom_small" role="status"><span class="slds-assistive-text">info</span>Procesando...</div>');
    }

    state.notices.forEach(function (notice) {
      var theme = notice.variant === 'success' ? 'slds-theme_success' : notice.variant === 'warning' ? 'slds-theme_warning' : 'slds-theme_info';
      html.push('<div class="slds-notify slds-notify_alert ' + theme + ' slds-m-bottom_small" role="status">' + escapeHtml(notice.message) + '</div>');
    });

    if (state.errors.length) {
      html.push('<div class="slds-notify slds-notify_alert slds-theme_error slds-m-bottom_small" role="alert"><div><strong>Revisa la configuración:</strong><ul class="slds-list_dotted slds-m-left_medium">' + state.errors.map(function (error) {
        return '<li>' + escapeHtml(typeof error === 'string' ? error : JSON.stringify(error)) + '</li>';
      }).join('') + '</ul></div></div>');
    }

    return html.join('');
  }

  function renderStepContent() {
    if (state.step === 1) return renderStepAssets();
    if (state.step === 2) return renderStepConfig();
    if (state.step === 3) return renderStepPreview();
    return renderStepTest();
  }

  function renderStepAssets() {
    return [
      '<div class="slds-card">',
      '<div class="slds-card__header slds-grid">',
      '<header class="slds-media slds-media_center slds-has-flexi-truncate">',
      '<div class="slds-media__body"><h2 class="slds-card__header-title">Paso 1 · Selección de plantilla</h2></div>',
      '</header></div>',
      '<div class="slds-card__body slds-card__body_inner">',
      '<div class="slds-grid slds-gutters slds-m-bottom_medium">',
      '<div class="slds-col slds-size_8-of-12">',
      '<label class="slds-form-element__label" for="asset-search">Buscar por nombre o customerKey</label>',
      '<input id="asset-search" class="slds-input" value="', attr(state.assetSearch), '" placeholder="Ej. bienvenida, confirmacion, customerKey">',
      '</div>',
      '<div class="slds-col slds-size_4-of-12 slds-align-bottom">',
      '<button type="button" class="slds-button slds-button_brand slds-m-top_large" id="search-assets">Buscar assets</button>',
      '</div></div>',
      renderSelectedAssetSummary(),
      renderAssetTable(),
      '</div></div>'
    ].join('');
  }

  function renderAssetTable() {
    if (!state.assets.length) {
      return '<div class="slds-box slds-theme_default">Usa el buscador para listar email assets de Content Builder.</div>';
    }

    return [
      '<div class="slds-scrollable_y asset-table">',
      '<table class="slds-table slds-table_cell-buffer slds-table_bordered slds-table_striped">',
      '<thead><tr><th>Nombre</th><th>CustomerKey</th><th>Tipo</th><th>Modificado</th><th></th></tr></thead>',
      '<tbody>',
      state.assets.map(function (asset) {
        return [
          '<tr>',
          '<td><strong>', escapeHtml(asset.name || ''), '</strong><div class="slds-text-color_weak">ID ', escapeHtml(asset.id || ''), '</div></td>',
          '<td>', escapeHtml(asset.customerKey || ''), '</td>',
          '<td>', escapeHtml(asset.assetType || ''), '</td>',
          '<td>', escapeHtml(asset.modifiedDate || ''), '</td>',
          '<td><button type="button" class="slds-button slds-button_neutral" data-select-asset="', attr(asset.id), '">Seleccionar</button></td>',
          '</tr>'
        ].join('');
      }).join(''),
      '</tbody></table></div>'
    ].join('');
  }

  function renderSelectedAssetSummary() {
    if (!state.config.assetId) return '';

    return [
      '<div class="slds-box slds-theme_shade slds-m-bottom_medium">',
      '<h3 class="slds-text-heading_small slds-m-bottom_x-small">Asset seleccionado</h3>',
      '<p><strong>', escapeHtml(state.config.assetName || state.config.assetId), '</strong> · ID ', escapeHtml(state.config.assetId), ' · ', escapeHtml(state.config.assetCustomerKey || ''), '</p>',
      renderVariableBadges(),
      '</div>'
    ].join('');
  }

  function renderVariableBadges() {
    if (!state.variables.length) {
      return '<p class="slds-text-color_weak slds-m-top_x-small">No se detectaron variables con sintaxis {{variable}}.</p>';
    }

    return '<div class="slds-m-top_small">' + state.variables.map(function (variable) {
      return '<span class="slds-badge slds-m-right_x-small slds-m-bottom_x-small">{{' + escapeHtml(variable) + '}}</span>';
    }).join('') + '</div>';
  }

  function renderStepConfig() {
    return [
      '<div class="slds-card">',
      '<div class="slds-card__header"><h2 class="slds-card__header-title">Paso 2 · Configuración de envío</h2></div>',
      '<div class="slds-card__body slds-card__body_inner">',
      renderSelectedAssetSummary(),
      '<div class="slds-grid slds-gutters slds-wrap">',
      field('subject', 'Subject', state.config.subject, 'slds-size_1-of-1', true),
      field('preheader', 'Preheader', state.config.preheader, 'slds-size_1-of-1', false),
      field('fromName', 'From Name', state.config.fromName, 'slds-size_1-of-2', false),
      field('fromEmail', 'From Email', state.config.fromEmail, 'slds-size_1-of-2', true),
      field('replyTo', 'Reply-To', state.config.replyTo, 'slds-size_1-of-2', false),
      field('recipientExpression', 'Email destinatario / expresión Journey Builder', state.config.recipientExpression, 'slds-size_1-of-2', true, '{{InteractionDefaults.Email}}'),
      '</div>',
      '<div class="slds-m-top_large">',
      '<h3 class="slds-text-heading_small slds-m-bottom_small">Variables dinámicas</h3>',
      '<p class="slds-text-body_small slds-text-color_weak slds-m-bottom_small">Para Journey/Contact Data escribe la expresión completa o el path sin llaves. Ej.: {{Event.FirstName}} o Contact.Attribute.Perfil.Nombre.</p>',
      renderMappingsTable(),
      '</div>',
      renderWarnings(),
      '</div></div>'
    ].join('');
  }

  function field(id, label, value, sizeClass, required, placeholder) {
    return [
      '<div class="slds-col ', sizeClass || 'slds-size_1-of-1', ' slds-m-bottom_medium">',
      '<div class="slds-form-element">',
      '<label class="slds-form-element__label" for="', id, '">', required ? '<abbr class="slds-required" title="required">*</abbr>' : '', escapeHtml(label), '</label>',
      '<div class="slds-form-element__control">',
      '<input id="', id, '" class="slds-input" value="', attr(value), '" placeholder="', attr(placeholder || ''), '">',
      '</div></div></div>'
    ].join('');
  }

  function renderMappingsTable() {
    if (!state.variables.length) {
      return '<div class="slds-box slds-theme_default">No hay variables {{}} detectadas en la plantilla.</div>';
    }

    return [
      '<table class="slds-table slds-table_cell-buffer slds-table_bordered mapping-table">',
      '<thead><tr><th>Variable</th><th>Obligatoria</th><th>Origen</th><th>Valor fijo</th><th>Journey/Contact Data</th><th>Valor test/preview</th></tr></thead>',
      '<tbody>',
      state.variables.map(function (variable) {
        var mapping = state.config.variableMappings[variable] || {};
        var safe = cssSafe(variable);
        return [
          '<tr>',
          '<td><span class="slds-badge">{{', escapeHtml(variable), '}}</span></td>',
          '<td><input type="checkbox" data-var-required="', safe, '" ', mapping.required !== false ? 'checked' : '', '></td>',
          '<td>',
          '<select class="slds-select" data-var-type="', safe, '">',
          option('fixed', 'Valor fijo', mapping.type),
          option('journeyData', 'Journey Data', mapping.type),
          option('contactData', 'Contact Data', mapping.type),
          '</select>',
          '</td>',
          '<td><input class="slds-input" data-var-value="', safe, '" value="', attr(mapping.value || ''), '" placeholder="Valor fijo"></td>',
          '<td><input class="slds-input" data-var-path="', safe, '" value="', attr(mapping.path || ''), '" placeholder="{{Event.Campo}}"></td>',
          '<td><input class="slds-input" data-var-sample="', safe, '" value="', attr(mapping.sampleValue || ''), '" placeholder="Solo preview/test"></td>',
          '</tr>'
        ].join('');
      }).join(''),
      '</tbody></table>'
    ].join('');
  }

  function option(value, label, current) {
    return '<option value="' + attr(value) + '" ' + (value === current ? 'selected' : '') + '>' + escapeHtml(label) + '</option>';
  }

  function renderWarnings() {
    if (!state.config.warnings || !state.config.warnings.length) return '';

    return [
      '<div class="slds-notify slds-notify_alert slds-theme_warning slds-m-top_medium" role="status">',
      '<div><strong>Warnings del asset</strong><ul class="slds-list_dotted slds-m-left_medium">',
      state.config.warnings.map(function (warning) {
        return '<li>' + escapeHtml(warning) + '</li>';
      }).join(''),
      '</ul></div></div>'
    ].join('');
  }

  function renderStepPreview() {
    var preview = state.preview;

    return [
      '<div class="slds-card">',
      '<div class="slds-card__header slds-grid">',
      '<header class="slds-media slds-media_center slds-has-flexi-truncate">',
      '<div class="slds-media__body"><h2 class="slds-card__header-title">Paso 3 · Preview</h2></div>',
      '<div><button type="button" class="slds-button slds-button_brand" id="generate-preview">Renderizar preview</button></div>',
      '</header></div>',
      '<div class="slds-card__body slds-card__body_inner">',
      preview ? renderPreviewResult(preview) : '<div class="slds-box slds-theme_default">Pulsa “Renderizar preview” para resolver variables con los valores de test configurados.</div>',
      '</div></div>'
    ].join('');
  }

  function renderPreviewResult(preview) {
    return [
      '<div class="slds-box slds-theme_shade slds-m-bottom_medium">',
      '<p><strong>Subject:</strong> ', escapeHtml(preview.subject || ''), '</p>',
      '<p><strong>Preheader:</strong> ', escapeHtml(preview.preheader || ''), '</p>',
      '</div>',
      renderPreviewDiagnostics(preview),
      '<div class="slds-grid slds-gutters slds-wrap">',
      '<div class="slds-col slds-size_1-of-2">',
      '<h3 class="slds-text-heading_small slds-m-bottom_small">Desktop</h3>',
      '<iframe title="Preview desktop" class="preview-frame desktop" sandbox srcdoc="', attr(preview.html || ''), '"></iframe>',
      '</div>',
      '<div class="slds-col slds-size_1-of-2">',
      '<h3 class="slds-text-heading_small slds-m-bottom_small">Mobile</h3>',
      '<iframe title="Preview mobile" class="preview-frame mobile" sandbox srcdoc="', attr(preview.html || ''), '"></iframe>',
      '</div></div>'
    ].join('');
  }

  function renderPreviewDiagnostics(preview) {
    var resolved = preview.resolvedVariables || [];
    var unresolved = preview.unresolvedVariables || [];
    var warnings = preview.warnings || [];

    return [
      '<div class="slds-grid slds-gutters slds-m-bottom_medium">',
      '<div class="slds-col slds-size_1-of-3">',
      '<div class="slds-box"><strong>Resueltas</strong><div class="slds-m-top_x-small">',
      resolved.length ? resolved.map(function (item) {
        return '<span class="slds-badge slds-m-right_x-small">' + escapeHtml(item.variable) + '</span>';
      }).join('') : '<span class="slds-text-color_weak">Ninguna</span>',
      '</div></div></div>',
      '<div class="slds-col slds-size_1-of-3">',
      '<div class="slds-box"><strong>No resueltas</strong><div class="slds-m-top_x-small">',
      unresolved.length ? unresolved.map(function (item) {
        return '<span class="slds-badge slds-theme_error slds-m-right_x-small">' + escapeHtml(item.variable) + '</span>';
      }).join('') : '<span class="slds-text-color_success">Sin pendientes</span>',
      '</div></div></div>',
      '<div class="slds-col slds-size_1-of-3">',
      '<div class="slds-box"><strong>Warnings</strong><div class="slds-m-top_x-small">',
      warnings.length ? warnings.map(function (warning) {
        return '<div class="slds-text-color_error">• ' + escapeHtml(warning) + '</div>';
      }).join('') : '<span class="slds-text-color_success">Sin warnings</span>',
      '</div></div></div>',
      '</div>'
    ].join('');
  }

  function renderStepTest() {
    return [
      '<div class="slds-card">',
      '<div class="slds-card__header"><h2 class="slds-card__header-title">Paso 4 · Envío de test</h2></div>',
      '<div class="slds-card__body slds-card__body_inner">',
      '<div class="slds-grid slds-gutters">',
      '<div class="slds-col slds-size_8-of-12">',
      '<label class="slds-form-element__label" for="testEmail">Email de test</label>',
      '<input id="testEmail" class="slds-input" placeholder="qa@tu-dominio.com">',
      '</div>',
      '<div class="slds-col slds-size_4-of-12 slds-align-bottom">',
      '<button type="button" id="send-test" class="slds-button slds-button_brand slds-m-top_large">Enviar test</button>',
      '</div></div>',
      state.testResult ? renderTestResult() : '',
      '<div class="slds-box slds-theme_shade slds-m-top_medium">Cuando pulses <strong>Done</strong> en Journey Builder, la configuración se guardará en <code>activity.arguments.execute.inArguments</code>.</div>',
      '</div></div>'
    ].join('');
  }

  function renderTestResult() {
    return [
      '<div class="slds-notify slds-notify_alert slds-theme_success slds-m-top_medium" role="status">',
      '<div><strong>Relay:</strong> ', escapeHtml(state.testResult.message || 'Test aceptado'), '</div>',
      '</div>'
    ].join('');
  }

  function renderLocalFooter() {
    return [
      '<div class="local-footer slds-grid slds-grid_align-spread slds-m-top_medium">',
      '<button type="button" class="slds-button slds-button_neutral" id="local-back" ', state.step === 1 ? 'disabled' : '', '>Atrás</button>',
      '<div>',
      '<button type="button" class="slds-button slds-button_neutral" id="local-preview" ', state.step < 2 ? 'disabled' : '', '>Preview</button>',
      '<button type="button" class="slds-button slds-button_brand" id="local-next">', state.step === STEPS.length ? 'Guardar/Done' : 'Siguiente', '</button>',
      '</div></div>'
    ].join('');
  }

  function bindEvents() {
    $all('[data-step]').forEach(function (el) {
      el.addEventListener('click', function (event) {
        event.preventDefault();
        var targetStep = Number(el.getAttribute('data-step'));
        if (targetStep <= state.step || canContinue()) gotoStep(targetStep);
      });
    });

    var searchButton = $('#search-assets');
    if (searchButton) searchButton.addEventListener('click', searchAssets);

    var assetSearch = $('#asset-search');
    if (assetSearch) {
      assetSearch.addEventListener('change', function () {
        state.assetSearch = assetSearch.value;
      });
      assetSearch.addEventListener('keydown', function (event) {
        if (event.key === 'Enter') {
          event.preventDefault();
          state.assetSearch = assetSearch.value;
          searchAssets();
        }
      });
    }

    $all('[data-select-asset]').forEach(function (button) {
      button.addEventListener('click', function () {
        selectAsset(button.getAttribute('data-select-asset'));
      });
    });

    var previewButton = $('#generate-preview');
    if (previewButton) previewButton.addEventListener('click', generatePreview);

    var sendButton = $('#send-test');
    if (sendButton) sendButton.addEventListener('click', sendTest);

    var localBack = $('#local-back');
    if (localBack) localBack.addEventListener('click', function () {
      if (state.step > 1) gotoStep(state.step - 1);
    });

    var localNext = $('#local-next');
    if (localNext) localNext.addEventListener('click', onClickedNext);

    var localPreview = $('#local-preview');
    if (localPreview) localPreview.addEventListener('click', function () {
      gotoStep(3);
    });

    $all('input, select, textarea').forEach(function (el) {
      el.addEventListener('change', function () {
        readConfigFromForm();
        state.preview = null;
        updateJourneyButtons();
      });
    });
  }

  var hasReceivedInitActivity = false;

  connection.on('initActivity', function (activity) {
    hasReceivedInitActivity = true;
    hydrateFromActivity(activity);

    /*
     * Pedimos tokens/endpoints después de initActivity. Hacerlo antes o repetir
     * "ready" puede provocar que Journey Builder reactive su overlay de carga.
     */
    connection.trigger('requestTokens');
    connection.trigger('requestEndpoints');
    updateJourneyButtons();
  });

  connection.on('requestedTokens', function (tokens) {
    state.tokens = tokens || null;
  });

  connection.on('requestedEndpoints', function (endpoints) {
    state.endpoints = endpoints || null;
  });

  connection.on('clickedNext', onClickedNext);

  connection.on('clickedBack', function () {
    if (state.step > 1) {
      gotoStep(state.step - 1);
    } else {
      connection.trigger('prevStep');
    }
  });

  connection.on('gotoStep', function (step) {
    if (step && step.key) {
      var match = String(step.key).match(/(\d+)/);
      if (match) gotoStep(Number(match[1]));
      return;
    }

    gotoStep(Number(step));
  });

  render();

  /*
   * IMPORTANTE:
   * Journey Builder quita el spinner gris cuando recibe exactamente el evento
   * Postmonger "ready". No repetimos ready y no usamos un wrapper casero:
   * cargamos Postmonger oficial desde /vendor/postmonger.js.
   */
  window.setTimeout(function () {
    connection.trigger('ready');
    updateJourneyButtons();

    window.setTimeout(function () {
      if (!hasReceivedInitActivity) {
        state.notices = [{
          message: 'Journey Builder cargó el iframe, pero todavía no respondió con initActivity. Si ves el spinner gris, revisa que se esté cargando /vendor/postmonger.js y que no haya cache antiguo del config.json.',
          variant: 'warning'
        }];
        render();
      }
    }, 6000);
  }, 0);

  // Standalone developer convenience.
  if (window.self === window.top) {
    state.notices = [{ message: 'Modo standalone. En Journey Builder se recibirá initActivity vía Postmonger.', variant: 'info' }];
    render();
  }
})();