const { TOKEN_REGEX, extractTokensFromTemplates } = require('./tokenService');

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function resolveValue(name, defaultFromToken, data, defaults) {
  const rawValue = data?.[name];

  if (rawValue !== undefined && rawValue !== null && rawValue !== '') {
    return rawValue;
  }

  const defaultValue = defaults?.[name];

  if (defaultValue !== undefined && defaultValue !== null && defaultValue !== '') {
    return defaultValue;
  }

  if (defaultFromToken !== undefined && defaultFromToken !== null && defaultFromToken !== '') {
    return defaultFromToken;
  }

  return '';
}

function renderTemplate(template = '', data = {}, options = {}) {
  const defaults = options.defaults || {};
  const escape = options.escape !== false;
  const missingTokens = new Set();

  const rendered = String(template || '').replace(TOKEN_REGEX, (_match, tokenName, d1, d2, d3) => {
    const defaultFromToken = d1 ?? d2 ?? (d3 ? String(d3).trim() : undefined);
    const value = resolveValue(tokenName, defaultFromToken, data, defaults);

    if (value === '') {
      missingTokens.add(tokenName);
    }

    return escape ? escapeHtml(value) : String(value);
  });

  return {
    rendered,
    missingTokens: Array.from(missingTokens)
  };
}

function renderEmail(snapshot, data = {}, options = {}) {
  const defaults = snapshot.defaults || options.defaults || {};

  const subject = renderTemplate(snapshot.subjectTemplate || '', data, {
    defaults,
    escape: false
  });

  const preheader = renderTemplate(snapshot.preheaderTemplate || '', data, {
    defaults,
    escape: false
  });

  const html = renderTemplate(snapshot.htmlTemplate || '', data, {
    defaults,
    escape: options.escapeHtmlValues !== false
  });

  const text = renderTemplate(snapshot.textTemplate || '', data, {
    defaults,
    escape: false
  });

  const requiredTokens = snapshot.requiredTokens || [];
  const missingRequiredTokens = requiredTokens.filter((token) => {
    const value = data?.[token] ?? defaults?.[token];
    return value === undefined || value === null || value === '';
  });

  return {
    subject: subject.rendered,
    preheader: preheader.rendered,
    html: html.rendered,
    text: text.rendered,
    missingTokens: Array.from(new Set([
      ...subject.missingTokens,
      ...preheader.missingTokens,
      ...html.missingTokens,
      ...text.missingTokens
    ])),
    missingRequiredTokens
  };
}

function buildSnapshot(config, asset) {
  const htmlTemplate = asset.html || config.htmlTemplate || '';
  const textTemplate = asset.text || config.textTemplate || '';
  const subjectTemplate = config.subject || asset.subject || '';
  const preheaderTemplate = config.preheader || asset.preheader || '';

  const tokens = extractTokensFromTemplates({
    subject: subjectTemplate,
    preheader: preheaderTemplate,
    html: htmlTemplate,
    text: textTemplate
  });

  return {
    snapshotId: config.snapshotId,
    createdDate: new Date().toISOString(),
    contentAssetId: config.contentAssetId,
    assetName: asset.name || '',
    assetCustomerKey: asset.customerKey || '',
    subjectTemplate,
    preheaderTemplate,
    htmlTemplate,
    textTemplate,
    tokens,
    requiredTokens: tokens
      .filter((token) => token.name !== 'emailAddress' && token.name !== 'contactKey')
      .filter((token) => token.defaultValue === undefined || token.defaultValue === null || token.defaultValue === '')
      .filter((token) => {
        const defaultValue = (config.defaults || {})[token.name];
        return defaultValue === undefined || defaultValue === null || defaultValue === '';
      })
      .map((token) => token.name),
    defaults: config.defaults || {}
  };
}

function generateTextFromHtml(html = '') {
  return String(html || '')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

module.exports = {
  renderTemplate,
  renderEmail,
  buildSnapshot,
  generateTextFromHtml,
  escapeHtml
};
