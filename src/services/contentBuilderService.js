const { AppError } = require('../middleware/errorHandler');
const { sfmcFetch } = require('./sfmcTokenService');
const { detectVariables } = require('./variableParserService');

const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;

const DEFAULT_EMAIL_ASSET_TYPES = [
  'htmlemail',
  'templatebasedemail',
  'textonlyemail',
  'message'
];

function clampPage(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

function clampPageSize(value) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_PAGE_SIZE;
  return Math.min(parsed, MAX_PAGE_SIZE);
}

function getAt(obj, path) {
  return path.split('.').reduce((acc, key) => {
    if (acc && Object.prototype.hasOwnProperty.call(acc, key)) return acc[key];
    return undefined;
  }, obj);
}

function firstString(obj, paths) {
  for (const path of paths) {
    const value = getAt(obj, path);
    if (typeof value === 'string' && value.trim()) return value;
  }
  return '';
}

function assetTypeName(asset) {
  return asset?.assetType?.name || asset?.assetType?.displayName || asset?.assetType?.id || '';
}

function mapAssetSummary(asset) {
  const subject = firstString(asset, [
    'views.subjectline.content',
    'views.subject.content',
    'views.email.subject',
    'data.email.subject',
    'subjectline',
    'subjectLine',
    'subject'
  ]);

  const preheader = firstString(asset, [
    'views.preheader.content',
    'views.email.preheader',
    'data.email.preheader',
    'preheader',
    'preHeader'
  ]);

  return {
    id: asset.id,
    customerKey: asset.customerKey,
    name: asset.name,
    assetType: assetTypeName(asset),
    categoryId: asset.category?.id || asset.categoryId || null,
    createdDate: asset.createdDate || asset.createdDateTime || null,
    modifiedDate: asset.modifiedDate || asset.modifiedDateTime || null,
    thumbnail: asset.thumbnail || asset.thumbnailUrl || asset.fileProperties?.publishedURL || null,
    subject,
    preheader
  };
}

function operand(property, simpleOperator, value) {
  return { property, simpleOperator, value };
}

function combine(leftOperand, logicalOperator, rightOperand) {
  if (!leftOperand) return rightOperand;
  if (!rightOperand) return leftOperand;
  return { leftOperand, logicalOperator, rightOperand };
}

function combineMany(operands, logicalOperator) {
  return operands.filter(Boolean).reduce((acc, current) => combine(acc, logicalOperator, current), null);
}

function buildAssetQuery({ search, assetType, categoryId }) {
  const typeNames = assetType && assetType !== 'all'
    ? [assetType]
    : DEFAULT_EMAIL_ASSET_TYPES;

  const typeQuery = combineMany(
    typeNames.map((typeName) => operand('assetType.name', 'equal', typeName)),
    'OR'
  );

  const searchText = typeof search === 'string' ? search.trim() : '';
  const searchQuery = searchText
    ? combine(
      operand('name', 'like', searchText),
      'OR',
      operand('customerKey', 'like', searchText)
    )
    : null;

  const categoryQuery = categoryId
    ? operand('category.id', 'equal', Number.isNaN(Number(categoryId)) ? categoryId : Number(categoryId))
    : null;

  return combineMany([typeQuery, searchQuery, categoryQuery], 'AND');
}

async function parseSfmcResponse(response) {
  const rawText = await response.text();
  let body;
  try {
    body = rawText ? JSON.parse(rawText) : {};
  } catch (_err) {
    body = { raw: rawText.slice(0, 1000) };
  }
  return body;
}

function isEmailAsset(asset, requestedType) {
  const type = String(assetTypeName(asset)).toLowerCase();
  if (requestedType && requestedType !== 'all') return type === String(requestedType).toLowerCase();
  return DEFAULT_EMAIL_ASSET_TYPES.includes(type);
}

async function listAssets(params = {}) {
  const page = clampPage(params.page);
  const pageSize = clampPageSize(params.pageSize || params.pageSize);
  const search = params.search || '';
  const assetType = params.assetType || 'all';
  const categoryId = params.categoryId || params.folderId || '';

  const queryPayload = {
    page: { page, pageSize },
    sort: [{ property: 'modifiedDate', direction: 'DESC' }],
    query: buildAssetQuery({ search, assetType, categoryId }),
    fields: [
      'id',
      'customerKey',
      'name',
      'assetType',
      'category',
      'categoryId',
      'createdDate',
      'modifiedDate',
      'thumbnail',
      'views.subjectline',
      'views.preheader'
    ]
  };

  const response = await sfmcFetch('/asset/v1/content/assets/query', {
    method: 'POST',
    body: JSON.stringify(queryPayload)
  });

  if (response.status === 429) {
    throw new AppError('SFMC Asset API devolvió rate limit 429. Reduce la frecuencia de búsqueda.', 429, undefined, 'SFMC_RATE_LIMIT');
  }

  if (!response.ok) {
    const body = await parseSfmcResponse(response);

    const fallback = await fallbackListAssets({ page, pageSize, search, assetType, categoryId });
    if (fallback) return fallback;

    throw new AppError('No se pudieron consultar assets en Content Builder.', response.status, body, 'SFMC_ASSET_QUERY_ERROR');
  }

  const body = await parseSfmcResponse(response);
  const items = Array.isArray(body.items)
    ? body.items
    : Array.isArray(body.entities)
      ? body.entities
      : [];

  return {
    page,
    pageSize,
    count: body.count || items.length,
    totalCount: body.totalCount || body.count || items.length,
    items: items.map(mapAssetSummary)
  };
}

async function fallbackListAssets({ page, pageSize, search, assetType, categoryId }) {
  try {
    const query = new URLSearchParams({
      '$page': String(page),
      '$pagesize': String(pageSize),
      '$orderBy': 'modifiedDate desc'
    });

    const response = await sfmcFetch(`/asset/v1/content/assets?${query.toString()}`, {
      method: 'GET'
    });

    if (!response.ok) return null;

    const body = await parseSfmcResponse(response);
    const rawItems = Array.isArray(body.items)
      ? body.items
      : Array.isArray(body.entities)
        ? body.entities
        : [];

    const searchText = String(search || '').toLowerCase();
    const filtered = rawItems.filter((asset) => {
      if (!isEmailAsset(asset, assetType)) return false;

      if (categoryId) {
        const currentCategory = asset.category?.id || asset.categoryId;
        if (String(currentCategory) !== String(categoryId)) return false;
      }

      if (!searchText) return true;
      return String(asset.name || '').toLowerCase().includes(searchText)
        || String(asset.customerKey || '').toLowerCase().includes(searchText);
    });

    return {
      page,
      pageSize,
      count: filtered.length,
      totalCount: body.totalCount || body.count || filtered.length,
      items: filtered.map(mapAssetSummary),
      fallback: true
    };
  } catch (_err) {
    return null;
  }
}

function collectSlotContent(node, warnings, depth = 0) {
  if (!node || depth > 8) return [];

  const pieces = [];

  if (typeof node === 'string') {
    pieces.push(node);
    return pieces;
  }

  if (Array.isArray(node)) {
    for (const child of node) {
      pieces.push(...collectSlotContent(child, warnings, depth + 1));
    }
    return pieces;
  }

  if (typeof node !== 'object') return pieces;

  const possibleContent = [
    node.content,
    node.html,
    node.body,
    node.value,
    node.asset?.views?.html?.content,
    node.block?.content,
    node.block?.views?.html?.content
  ];

  for (const value of possibleContent) {
    if (typeof value === 'string' && value.trim()) {
      pieces.push(value);
    }
  }

  const children = [
    node.blocks,
    node.slots,
    node.contentBlocks,
    node.items,
    node.asset?.views?.html?.slots,
    node.block?.slots
  ];

  for (const child of children) {
    if (child) pieces.push(...collectSlotContent(child, warnings, depth + 1));
  }

  if ((node.contentBlockId || node.blockId || node.assetId) && pieces.length === 0) {
    warnings.push('El asset contiene referencias a bloques de contenido que podrían no estar embebidas en la respuesta de Asset API.');
  }

  return pieces;
}

function extractHtml(asset, warnings) {
  const html = firstString(asset, [
    'views.html.content',
    'views.email.html',
    'data.email.html',
    'html',
    'content'
  ]);

  if (html) return html;

  const slotSources = [
    asset.views?.html?.slots,
    asset.views?.template?.slots,
    asset.slots,
    asset.content?.slots
  ];

  const slotContent = [];
  for (const source of slotSources) {
    if (source) slotContent.push(...collectSlotContent(source, warnings));
  }

  if (slotContent.length) {
    warnings.push('El HTML se reconstruyó desde slots/bloques. Revisa el preview porque algunos bloques dinámicos pueden no renderizarse fuera de SFMC.');
    return slotContent.join('\n');
  }

  return '';
}

function detectWarnings(asset, subject, preheader, html, text) {
  const warnings = [];
  const combined = [subject, preheader, html, text].join('\n');

  if (/%%\[|%%=|%%[A-Za-z0-9_.-]+%%/.test(combined)) {
    warnings.push('Se detectó AMPscript o personalization strings de SFMC. Esta custom activity no ejecuta el motor nativo de SFMC, por lo que esos valores no se resolverán automáticamente.');
  }

  if (/\bDynamicContent\b|dynamicContent|contentAreas|ruleSet|rules/i.test(JSON.stringify({
    views: asset.views,
    slots: asset.slots,
    content: asset.content
  }).slice(0, 250000))) {
    warnings.push('El asset parece incluir contenido dinámico, reglas o bloques anidados. El preview y el envío por relay podrían no coincidir con el render nativo de SFMC.');
  }

  if (/<script[\s>]/i.test(html)) {
    warnings.push('Se detectaron etiquetas <script>. No se sustituyen variables dentro de script/style y el preview usa iframe sandbox.');
  }

  if (!html && !text) {
    warnings.push('No se encontró HTML ni texto plano en el asset. Verifica que sea un email de Content Builder compatible.');
  }

  return Array.from(new Set(warnings));
}

async function getAssetDetail(id) {
  if (!id || !String(id).match(/^\d+$/)) {
    throw new AppError('El id de asset debe ser numérico.', 400, undefined, 'INVALID_ASSET_ID');
  }

  const response = await sfmcFetch(`/asset/v1/content/assets/${id}`, {
    method: 'GET'
  });

  const body = await parseSfmcResponse(response);

  if (response.status === 404) {
    throw new AppError('Asset no encontrado en Content Builder.', 404, body, 'SFMC_ASSET_NOT_FOUND');
  }

  if (response.status === 401 || response.status === 403) {
    throw new AppError('La integración no tiene permisos para leer este asset.', response.status, body, 'SFMC_ASSET_FORBIDDEN');
  }

  if (!response.ok) {
    throw new AppError('No se pudo recuperar el detalle del asset.', response.status, body, 'SFMC_ASSET_DETAIL_ERROR');
  }

  const asset = body;
  const warnings = [];

  const subject = firstString(asset, [
    'views.subjectline.content',
    'views.subject.content',
    'views.email.subject',
    'data.email.subject',
    'subjectline',
    'subjectLine',
    'subject'
  ]);

  const preheader = firstString(asset, [
    'views.preheader.content',
    'views.email.preheader',
    'data.email.preheader',
    'preheader',
    'preHeader'
  ]);

  const html = extractHtml(asset, warnings);

  const text = firstString(asset, [
    'views.text.content',
    'views.email.text',
    'data.email.text',
    'text',
    'textBody'
  ]);

  const variables = detectVariables([subject, preheader, html, text].join('\n'));
  const detectedWarnings = detectWarnings(asset, subject, preheader, html, text);

  return {
    id: asset.id,
    customerKey: asset.customerKey,
    name: asset.name,
    assetType: assetTypeName(asset),
    categoryId: asset.category?.id || asset.categoryId || null,
    createdDate: asset.createdDate || null,
    modifiedDate: asset.modifiedDate || null,
    subject,
    preheader,
    html,
    text,
    variables,
    warnings: Array.from(new Set([...warnings, ...detectedWarnings]))
  };
}

module.exports = {
  listAssets,
  getAssetDetail,
  mapAssetSummary
};