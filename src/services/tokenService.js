const TOKEN_REGEX = /{{\s*([a-zA-Z0-9_.-]+)\s*(?:\|\s*default\s*:\s*(?:"([^"]*)"|'([^']*)'|([^}]+)))?\s*}}/g;

function extractTokens(template = '') {
  const tokens = new Map();
  const text = String(template || '');
  let match;

  while ((match = TOKEN_REGEX.exec(text)) !== null) {
    const name = match[1];
    const defaultValue = match[2] ?? match[3] ?? (match[4] ? String(match[4]).trim() : undefined);

    if (!tokens.has(name)) {
      tokens.set(name, {
        name,
        defaultValue,
        count: 1
      });
    } else {
      const existing = tokens.get(name);
      existing.count += 1;
      if (existing.defaultValue === undefined && defaultValue !== undefined) {
        existing.defaultValue = defaultValue;
      }
    }
  }

  return Array.from(tokens.values());
}

function extractTokensFromTemplates(templates = {}) {
  const combined = [
    templates.subject || '',
    templates.preheader || '',
    templates.html || '',
    templates.text || ''
  ].join('\n');

  return extractTokens(combined);
}

function normalizeTokenMapping(mapping) {
  if (!mapping || typeof mapping !== 'object' || Array.isArray(mapping)) return {};

  return Object.fromEntries(
    Object.entries(mapping)
      .filter(([key]) => key && typeof key === 'string')
      .map(([key, value]) => [key.trim(), value])
  );
}

module.exports = {
  TOKEN_REGEX,
  extractTokens,
  extractTokensFromTemplates,
  normalizeTokenMapping
};
