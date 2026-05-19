const { AppError } = require('../middleware/errorHandler');
const { sfmcFetch } = require('./sfmcTokenService');
const { detectVariables } = require('./variableParserService');

const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;

// Tipos de asset de email más habituales en Content Builder.
// "message" aparece en algunas BUs para emails guardados desde Email Studio/Content Builder.
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
    if (acc === null || acc === undefined) return undefined;

    // Permite navegar objetos normales y evita errores si SFMC devuelve strings/números.
    if (typeof acc !== 'object' && typeof acc !== 'function') return undefined;

    if (Object.prototype.hasOwnProperty.call(acc, key)) return acc[key];
    return undefined;
  }, obj);
}

function valueToString(value) {
  if (value === null || value === undefined) return '';

  if (typeof value === 'string') return value.trim() ? value : '';
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);

  // Muchas respuestas de Asset API devuelven vistas como { content: "..." }.
  if (typeof value === 'object') {
    const candidates = [
      value.content,
      value.html,
      value.text,
      value.value,
      value.body,
      value.subject,
      value.preheader
    ];

    for (const candidate of candidates) {
      const result = valueToString(candidate);
      if (result) return result;
    }
  }

  return '';
}

function firstString(obj, paths) {
  for (const path of paths) {
    const value = valueToString(getAt(obj, path));
    if (value) return value;
  }
  return '';
}

function assetTypeName(asset) {
  const type = asset?.assetType;

  if (typeof type === 'string') return type;
  if (typeof type === 'number') return String(type);

  return String(
    type?.name ||
    type?.displayName ||
    type?.description ||
    type?.id ||
    ''
  );
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

  const typeName = assetTypeName(asset);

  return {
    id: asset.id,
    customerKey: asset.customerKey,
    name: asset.name,
    assetType: typeName,
    assetTypeName: typeName,
    assetTypeRaw: asset.assetType || null,
    categoryId: asset.category?.id || asset.categoryId || null,
    categoryName: asset.category?.name || null,
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

function buildSearchQuery({ search, assetType, categoryId }) {
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

  // Content Builder usa category.id, no categoryId.
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

function extractItems(body) {
  if (Array.isArray(body.items)) return body.items;
  if (Array.isArray(body.entities)) return body.entities;
  if (Array.isArray(body)) return body;
  return [];
}

function isEmailAsset(asset, requestedType) {
  const type = String(assetTypeName(asset)).toLowerCase();

  if (requestedType && requestedType !== 'all') {
    return type === String(requestedType).toLowerCase();
  }

  return DEFAULT_EMAIL_ASSET_TYPES.includes(type);
}

function filterAssets(rawItems, { search, assetType, categoryId }) {
  const searchText = String(search || '').toLowerCase();

  return rawItems.filter((asset) => {
    if (!asset || typeof asset !== 'object') return false;
    if (!isEmailAsset(asset, assetType)) return false;

    if (categoryId) {
      const currentCategory = asset.category?.id || asset.categoryId;
      if (String(currentCategory) !== String(categoryId)) return false;
    }

    if (!searchText) return true;

    return String(asset.name || '').toLowerCase().includes(searchText)
      || String(asset.customerKey || '').toLowerCase().includes(searchText);
  });
}

async function queryAssetsMinimal({ page, pageSize, search, assetType, categoryId }) {
  const queryPayload = {
    page: { page, pageSize },
    query: buildSearchQuery({ search, assetType, categoryId })
  };

  // No enviamos "fields": varias BUs rechazan campos como categoryId/views.*.
  const response = await sfmcFetch('/asset/v1/content/assets/query', {
    method: 'POST',
    body: JSON.stringify(queryPayload)
  });

  const body = await parseSfmcResponse(response);

  if (!response.ok) {
    throw new AppError(
      body.message || 'No se pudieron consultar assets en Content Builder.',
      response.status,
      {
        status: response.status,
        sfmcError: body
      },
      'SFMC_ASSET_QUERY_ERROR'
    );
  }

  const rawItems = extractItems(body);
  const filtered = filterAssets(rawItems, { search, assetType, categoryId });

  return {
    page,
    pageSize,
    count: body.count || filtered.length,
    totalCount: body.totalCount || body.count || filtered.length,
    items: filtered.map(mapAssetSummary),
    method: 'query-minimal'
  };
}

async function listAssetsViaGet({ page, pageSize, search, assetType, categoryId }) {
  const query = new URLSearchParams({
    '$page': String(page),
    '$pagesize': String(pageSize)
  });

  const response = await sfmcFetch(`/asset/v1/content/assets?${query.toString()}`, {
    method: 'GET'
  });

  const body = await parseSfmcResponse(response);

  if (!response.ok) {
    throw new AppError(
      body.message || 'No se pudieron consultar assets en Content Builder por GET.',
      response.status,
      {
        status: response.status,
        sfmcError: body
      },
      'SFMC_ASSET_GET_ERROR'
    );
  }

  const rawItems = extractItems(body);
  const filtered = filterAssets(rawItems, { search, assetType, categoryId });

  return {
    page,
    pageSize,
    count: filtered.length,
    totalCount: body.totalCount || body.count || filtered.length,
    items: filtered.map(mapAssetSummary),
    method: 'get-fallback'
  };
}

async function listAssets(params = {}) {
  const page = clampPage(params.page);
  const pageSize = clampPageSize(params.pageSize || params.limit);
  const search = params.search || '';
  const assetType = params.assetType || 'all';
  const categoryId = params.categoryId || params.folderId || '';

  try {
    return await queryAssetsMinimal({ page, pageSize, search, assetType, categoryId });
  } catch (queryError) {
    try {
      const fallback = await listAssetsViaGet({ page, pageSize, search, assetType, categoryId });
      return {
        ...fallback,
        warning: 'Se usó fallback GET porque la consulta avanzada de Asset API falló.',
        queryError: {
          code: queryError.code,
          statusCode: queryError.statusCode,
          message: queryError.message,
          details: queryError.details
        }
      };
    } catch (fallbackError) {
      if (fallbackError instanceof AppError) {
        throw fallbackError;
      }

      throw new AppError(
        'Error inesperado consultando Content Builder.',
        502,
        {
          message: fallbackError.message
        },
        'CONTENT_BUILDER_UNEXPECTED'
      );
    }
  }
}

function collectSlotContent(node, warnings, depth = 0) {
  if (!node || depth > 10) return [];

  const pieces = [];

  if (typeof node === 'string') {
    if (node.trim()) pieces.push(node);
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
    const text = valueToString(value);
    if (text) pieces.push(text);
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
    'views.html',
    'views.email.html',
    'data.email.html',
    'data.html',
    'html',
    'content'
  ]);

  if (html) return html;

  const slotSources = [
    asset.views?.html?.slots,
    asset.views?.template?.slots,
    asset.slots,
    asset.content?.slots,
    asset.data?.slots
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

function safeJsonSlice(value, length = 250000) {
  try {
    return JSON.stringify(value).slice(0, length);
  } catch (_err) {
    return '';
  }
}

function detectWarnings(asset, subject, preheader, html, text, sourceNotes = []) {
  const warnings = [...sourceNotes];
  const combined = [subject, preheader, html, text].join('\n');

  if (/%%\[|%%=|%%[A-Za-z0-9_.-]+%%/.test(combined)) {
    warnings.push('Se detectó AMPscript o personalization strings de SFMC. Esta custom activity no ejecuta el motor nativo de SFMC, por lo que esos valores no se resolverán automáticamente.');
  }

  const meta = safeJsonSlice({
    views: asset.views,
    slots: asset.slots,
    content: asset.content,
    data: asset.data
  });

  if (/\bDynamicContent\b|dynamicContent|contentAreas|ruleSet|rules/i.test(meta)) {
    warnings.push('El asset parece incluir contenido dinámico, reglas o bloques anidados. El preview y el envío por relay podrían no coincidir con el render nativo de SFMC.');
  }

  if (/<script[\s>]/i.test(html)) {
    warnings.push('Se detectaron etiquetas <script>. No se sustituyen variables dentro de script/style y el preview usa iframe sandbox.');
  }

  if (!html && !text) {
    warnings.push('No se encontró HTML ni texto plano en la respuesta del asset. Si el email usa bloques anidados, puede requerir adaptar el extractor.');
  }

  return Array.from(new Set(warnings.filter(Boolean)));
}

async function queryAssetById(id) {
  const numericId = Number(id);
  const payload = {
    page: { page: 1, pageSize: 1 },
    query: {
      property: 'id',
      simpleOperator: 'equal',
      value: Number.isNaN(numericId) ? id : numericId
    }
  };

  const response = await sfmcFetch('/asset/v1/content/assets/query', {
    method: 'POST',
    body: JSON.stringify(payload)
  });

  const body = await parseSfmcResponse(response);

  if (!response.ok) {
    throw new AppError(
      body.message || 'No se pudo consultar el asset por id.',
      response.status,
      { status: response.status, sfmcError: body },
      'SFMC_ASSET_QUERY_BY_ID_ERROR'
    );
  }

  const items = extractItems(body);
  return items[0] || null;
}

async function fetchAssetDetailById(id) {
  const response = await sfmcFetch(`/asset/v1/content/assets/${encodeURIComponent(id)}`, {
    method: 'GET'
  });

  const body = await parseSfmcResponse(response);

  if (response.status === 404) {
    throw new AppError('Asset no encontrado en Content Builder.', 404, body, 'SFMC_ASSET_NOT_FOUND');
  }

  if (response.status === 401 || response.status === 403) {
    throw new AppError('La integración no tiene permisos para leer el detalle de este asset.', response.status, body, 'SFMC_ASSET_FORBIDDEN');
  }

  if (!response.ok) {
    throw new AppError(
      body.message || 'No se pudo recuperar el detalle del asset.',
      response.status,
      { status: response.status, sfmcError: body },
      'SFMC_ASSET_DETAIL_ERROR'
    );
  }

  return body;
}

function normalizeAssetDetail(asset, sourceNotes = []) {
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
    'views.text',
    'views.email.text',
    'data.email.text',
    'data.text',
    'text',
    'textBody'
  ]);

  const variables = detectVariables([subject, preheader, html, text].join('\n'));
  const detectedWarnings = detectWarnings(asset, subject, preheader, html, text, sourceNotes);

  const typeName = assetTypeName(asset);

  return {
    id: asset.id,
    customerKey: asset.customerKey,
    name: asset.name,
    assetType: typeName,
    assetTypeName: typeName,
    assetTypeRaw: asset.assetType || null,
    categoryId: asset.category?.id || asset.categoryId || null,
    categoryName: asset.category?.name || null,
    createdDate: asset.createdDate || asset.createdDateTime || null,
    modifiedDate: asset.modifiedDate || asset.modifiedDateTime || null,
    subject,
    preheader,
    html,
    text,
    variables,
    warnings: Array.from(new Set([...warnings, ...detectedWarnings]))
  };
}

async function getAssetDetail(id) {
  if (!id || !String(id).match(/^\d+$/)) {
    throw new AppError('El id de asset debe ser numérico.', 400, undefined, 'INVALID_ASSET_ID');
  }

  let asset;
  let detailError = null;
  const sourceNotes = [];

  try {
    asset = await fetchAssetDetailById(id);
  } catch (err) {
    detailError = err;
    sourceNotes.push('No se pudo usar el endpoint directo de detalle de Asset API; se intentó recuperar el asset mediante query por id.');

    // Algunas BUs permiten listar/query pero rechazan el endpoint directo de detalle.
    // En ese caso devolvemos lo que podamos desde /assets/query para no bloquear la configuración.
    try {
      asset = await queryAssetById(id);
    } catch (queryErr) {
      if (queryErr instanceof AppError) {
        throw new AppError(
          'No se pudo recuperar el asset seleccionado ni por detalle ni por query.',
          queryErr.statusCode || 502,
          {
            detailError: {
              code: detailError?.code,
              statusCode: detailError?.statusCode,
              message: detailError?.message,
              details: detailError?.details
            },
            queryError: {
              code: queryErr.code,
              statusCode: queryErr.statusCode,
              message: queryErr.message,
              details: queryErr.details
            }
          },
          'SFMC_ASSET_DETAIL_AND_QUERY_FAILED'
        );
      }

      throw queryErr;
    }
  }

  if (!asset) {
    throw new AppError('Asset no encontrado en Content Builder.', 404, undefined, 'SFMC_ASSET_NOT_FOUND');
  }

  try {
    return normalizeAssetDetail(asset, sourceNotes);
  } catch (err) {
    throw new AppError(
      'El asset se recuperó, pero no se pudo normalizar su contenido.',
      502,
      {
        message: err.message,
        assetId: id,
        assetName: asset?.name,
        assetType: assetTypeName(asset)
      },
      'SFMC_ASSET_NORMALIZE_ERROR'
    );
  }
}

module.exports = {
  listAssets,
  getAssetDetail,
  mapAssetSummary
};
