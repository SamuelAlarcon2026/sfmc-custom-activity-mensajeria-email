const axios = require('axios');
const env = require('../config/env');
const { getAccessToken, hasSfmcConfig } = require('./sfmcAuthService');
const { generateTextFromHtml } = require('./renderService');

function findHtmlContent(asset) {
  if (!asset || typeof asset !== 'object') return '';

  const candidates = [
    asset?.views?.html?.content,
    asset?.views?.html?.slots?.main?.content,
    asset?.content,
    asset?.data?.html,
    asset?.data?.content,
    asset?.superContent,
    asset?.legacyData?.legacyId
  ];

  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate;
    }
  }

  // Some Content Builder assets are block/slot based.
  const discovered = [];
  function walk(node) {
    if (!node || typeof node !== 'object') return;

    if (typeof node.content === 'string' && node.content.trim()) {
      discovered.push(node.content);
    }

    for (const value of Object.values(node)) {
      if (value && typeof value === 'object') walk(value);
    }
  }

  walk(asset.views || asset.slots || {});
  return discovered.join('\n');
}

function findTextContent(asset) {
  return asset?.views?.text?.content ||
    asset?.data?.text ||
    asset?.text ||
    '';
}

async function getAssetById(assetId) {
  if (!assetId) {
    const error = new Error('Content Asset ID is required.');
    error.code = 'ASSET_ID_REQUIRED';
    throw error;
  }

  if (!hasSfmcConfig()) {
    const error = new Error('SFMC API credentials are not configured, so the asset snapshot cannot be created.');
    error.code = 'SFMC_CONFIG_MISSING';
    throw error;
  }

  const token = await getAccessToken();

  const response = await axios.get(`${env.sfmc.restBaseUrl}/asset/v1/content/assets/${encodeURIComponent(assetId)}`, {
    headers: {
      Authorization: `Bearer ${token}`
    },
    timeout: 15000
  });

  const asset = response.data || {};
  const html = findHtmlContent(asset);

  if (!html) {
    const error = new Error(`No HTML content could be extracted from Content Asset ID ${assetId}.`);
    error.code = 'ASSET_HTML_NOT_FOUND';
    error.details = {
      assetKeys: Object.keys(asset)
    };
    throw error;
  }

  const text = findTextContent(asset) || generateTextFromHtml(html);

  return {
    raw: asset,
    id: asset.id || assetId,
    name: asset.name || '',
    customerKey: asset.customerKey || '',
    assetType: asset.assetType?.name || asset.assetType?.id || '',
    subject: asset?.views?.subjectline?.content || asset?.subjectLine || asset?.data?.subject || '',
    preheader: asset?.views?.preheader?.content || asset?.preheader || asset?.data?.preheader || '',
    html,
    text
  };
}

module.exports = {
  getAssetById,
  findHtmlContent,
  findTextContent
};
