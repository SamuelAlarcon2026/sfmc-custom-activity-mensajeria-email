const sfmcTokenService = require('./sfmcTokenService');

const DEFAULT_PAGE = 1;
const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;

function getRestBaseUrl() {
  const restBaseUrl = process.env.SFMC_REST_BASE_URL;

  if (!restBaseUrl) {
    throw new Error('SFMC_REST_BASE_URL no está configurado.');
  }

  return restBaseUrl.replace(/\/$/, '');
}

async function sfmcFetch(path, options = {}) {
  const token = await sfmcTokenService.getAccessToken();
  const baseUrl = getRestBaseUrl();

  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });

  const rawText = await response.text();

  let data;
  try {
    data = rawText ? JSON.parse(rawText) : {};
  } catch (error) {
    data = {
      raw: rawText
    };
  }

  if (!response.ok) {
    const message =
      data.message ||
      data.error_description ||
      data.error ||
      `Error consultando SFMC Asset API. Status ${response.status}`;

    const err = new Error(message);
    err.status = response.status;
    err.details = data;
    throw err;
  }

  return data;
}

function normalizeAsset(asset) {
  const assetType = asset.assetType || {};
  const category = asset.category || {};

  const views = asset.views || {};
  const data = asset.data || {};
  const legacyData = asset.legacyData || {};

  return {
    id: asset.id,
    customerKey: asset.customerKey,
    name: asset.name,
    assetType,
    assetTypeId: assetType.id,
    assetTypeName: assetType.name,
    category,
    categoryId: category.id || null,
    categoryName: category.name || null,
    createdDate: asset.createdDate,
    modifiedDate: asset.modifiedDate,
    thumbnail: asset.thumbnail || null,
    subject:
      views.subjectline ||
      views.subject ||
      data.subjectline ||
      data.subject ||
      legacyData.subject ||
      null,
    preheader:
      views.preheader ||
      data.preheader ||
      legacyData.preheader ||
      null
  };
}

function buildSearchQuery({ search, assetType, categoryId }) {
  const operands = [];

  const emailAssetTypes = [
    {
      property: 'assetType.name',
      simpleOperator: 'equal',
      value: 'htmlemail'
    },
    {
      property: 'assetType.name',
      simpleOperator: 'equal',
      value: 'templatebasedemail'
    }
  ];

  if (!assetType || assetType === 'all' || assetType === 'email') {
    operands.push({
      leftOperand: emailAssetTypes[0],
      logicalOperator: 'OR',
      rightOperand: emailAssetTypes[1]
    });
  } else {
    operands.push({
      property: 'assetType.name',
      simpleOperator: 'equal',
      value: assetType
    });
  }

  if (search) {
    const searchQuery = {
      leftOperand: {
        property: 'name',
        simpleOperator: 'like',
        value: search
      },
      logicalOperator: 'OR',
      rightOperand: {
        property: 'customerKey',
        simpleOperator: 'like',
        value: search
      }
    };

    operands.push(searchQuery);
  }

  if (categoryId) {
    operands.push({
      property: 'category.id',
      simpleOperator: 'equal',
      value: Number(categoryId)
    });
  }

  if (operands.length === 1) {
    return operands[0];
  }

  return operands.reduce((leftOperand, rightOperand) => ({
    leftOperand,
    logicalOperator: 'AND',
    rightOperand
  }));
}

async function listAssets(params = {}) {
  const page = Math.max(Number(params.page || DEFAULT_PAGE), 1);
  const pageSize = Math.min(
    Math.max(Number(params.pageSize || DEFAULT_PAGE_SIZE), 1),
    MAX_PAGE_SIZE
  );

  const search = params.search ? String(params.search).trim() : '';
  const assetType = params.assetType ? String(params.assetType).trim() : 'email';
  const categoryId = params.categoryId ? String(params.categoryId).trim() : '';

  const body = {
    page: {
      page,
      pageSize
    },
    query: buildSearchQuery({
      search,
      assetType,
      categoryId
    }),
    fields: [
      'id',
      'customerKey',
      'name',
      'assetType',
      'category',
      'createdDate',
      'modifiedDate',
      'thumbnail',
      'views',
      'data',
      'legacyData'
    ],
    sort: [
      {
        property: 'modifiedDate',
        direction: 'DESC'
      }
    ]
  };

  const data = await sfmcFetch('/asset/v1/content/assets/query', {
    method: 'POST',
    body: JSON.stringify(body)
  });

  const items = Array.isArray(data.items) ? data.items.map(normalizeAsset) : [];

  return {
    success: true,
    page,
    pageSize,
    count: data.count || items.length,
    totalCount: data.totalCount || data.count || items.length,
    items
  };
}

async function getAssetById(assetId) {
  if (!assetId) {
    throw new Error('assetId es obligatorio.');
  }

  const asset = await sfmcFetch(`/asset/v1/content/assets/${encodeURIComponent(assetId)}`, {
    method: 'GET'
  });

  return asset;
}

module.exports = {
  listAssets,
  getAssetById,
  normalizeAsset
};
