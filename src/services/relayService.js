const { AppError } = require('../middleware/errorHandler');

function trimTrailingSlash(value) {
  return (value || '').replace(/\/+$/, '');
}

function requireEnv(name) {
  const value = process.env[name];
  if (!value || !value.trim()) {
    throw new AppError(`Variable de entorno requerida no configurada: ${name}`, 500, undefined, 'ENV_MISSING');
  }
  return value.trim();
}

function isEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
}

function assertRelayConfigured() {
  requireEnv('RELAY_API_URL');
  requireEnv('RELAY_API_KEY');
}

function validateRelayPayload(payload) {
  const errors = [];

  if (!payload || typeof payload !== 'object') {
    errors.push('Payload inválido.');
    return errors;
  }

  if (!isEmail(payload.to)) errors.push('El destinatario no tiene formato de email válido.');
  if (!payload.from || !isEmail(payload.from.email)) errors.push('from.email no tiene formato válido.');
  if (!payload.subject || !String(payload.subject).trim()) errors.push('El subject no puede estar vacío.');
  if (!payload.html && !payload.text) errors.push('Debe existir html o text para enviar.');
  if (payload.replyTo && !isEmail(payload.replyTo)) errors.push('replyTo no tiene formato válido.');

  return errors;
}

async function postToRelay(payload, context = {}) {
  assertRelayConfigured();

  const errors = validateRelayPayload(payload);
  if (errors.length) {
    throw new AppError('Payload no válido para el relay.', 400, errors, 'RELAY_PAYLOAD_INVALID');
  }

  const timeoutMs = Number.parseInt(process.env.RELAY_TIMEOUT_MS || '15000', 10);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number.isFinite(timeoutMs) ? timeoutMs : 15000);

  const relayUrl = requireEnv('RELAY_API_URL');
  const apiKey = requireEnv('RELAY_API_KEY');

  try {
    const response = await fetch(relayUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: `Bearer ${apiKey}`,
        'X-Correlation-Id': context.correlationId || ''
      },
      body: JSON.stringify(payload),
      signal: controller.signal
    });

    const rawText = await response.text();
    let responseBody;
    try {
      responseBody = rawText ? JSON.parse(rawText) : {};
    } catch (_err) {
      responseBody = { raw: rawText.slice(0, 1000) };
    }

    if (!response.ok) {
      throw new AppError(
        'El relay privado rechazó el envío.',
        response.status >= 500 ? 502 : response.status,
        {
          relayStatus: response.status,
          relayResponse: responseBody
        },
        'RELAY_REJECTED'
      );
    }

    return {
      success: true,
      relayStatus: response.status,
      relayResponse: responseBody
    };
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new AppError('Timeout llamando al relay privado.', 504, { timeoutMs }, 'RELAY_TIMEOUT');
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

function buildRelayPayload({
  to,
  fromName,
  fromEmail,
  replyTo,
  subject,
  preheader,
  html,
  text,
  metadata
}) {
  return {
    to: String(to || '').trim(),
    from: {
      name: String(fromName || '').trim(),
      email: String(fromEmail || '').trim()
    },
    replyTo: replyTo ? String(replyTo).trim() : undefined,
    subject: String(subject || ''),
    preheader: String(preheader || ''),
    html: String(html || ''),
    text: String(text || ''),
    metadata: metadata || {}
  };
}

module.exports = {
  postToRelay,
  buildRelayPayload,
  validateRelayPayload,
  assertRelayConfigured,
  isEmail
};