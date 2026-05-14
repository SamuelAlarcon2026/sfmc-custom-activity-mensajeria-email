const fs = require('fs/promises');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const env = require('../config/env');

async function ensureDataDir() {
  await fs.mkdir(env.dataDir, { recursive: true });
  await fs.mkdir(path.join(env.dataDir, 'snapshots'), { recursive: true });
}

function getStorePath(name) {
  return path.join(env.dataDir, name);
}

async function readJson(name, fallback) {
  await ensureDataDir();
  try {
    const content = await fs.readFile(getStorePath(name), 'utf8');
    return JSON.parse(content);
  } catch {
    return fallback;
  }
}

async function writeJson(name, value) {
  await ensureDataDir();
  await fs.writeFile(getStorePath(name), JSON.stringify(value, null, 2), 'utf8');
}

function makeConfigKey(config) {
  return [
    config.journeyId || 'unknownJourney',
    config.journeyVersionId || 'unknownVersion',
    config.activityId || 'unknownActivity'
  ].join('__');
}

async function saveDraftConfig(config) {
  const configs = await readJson('draft-configs.json', {});
  const key = makeConfigKey(config);
  configs[key] = {
    ...config,
    key,
    updatedDate: new Date().toISOString()
  };
  await writeJson('draft-configs.json', configs);
  return configs[key];
}

async function savePublishedConfig(config) {
  const configs = await readJson('published-configs.json', {});
  const key = makeConfigKey(config);
  configs[key] = {
    ...config,
    key,
    isPublished: true,
    updatedDate: new Date().toISOString()
  };
  await writeJson('published-configs.json', configs);
  return configs[key];
}

async function getPublishedConfig({ journeyId, journeyVersionId, activityId }) {
  const configs = await readJson('published-configs.json', {});
  const exactKey = [journeyId || 'unknownJourney', journeyVersionId || 'unknownVersion', activityId || 'unknownActivity'].join('__');

  if (configs[exactKey]) return configs[exactKey];

  // Fallback for payloads that do not include all identifiers.
  const candidates = Object.values(configs).filter((config) => {
    if (activityId && config.activityId !== activityId) return false;
    if (journeyId && config.journeyId !== journeyId) return false;
    if (journeyVersionId && config.journeyVersionId !== journeyVersionId) return false;
    return true;
  });

  return candidates[candidates.length - 1] || null;
}

async function saveSnapshot(snapshot) {
  const snapshotId = snapshot.snapshotId || uuidv4();
  const normalized = {
    ...snapshot,
    snapshotId
  };

  await ensureDataDir();
  await fs.writeFile(
    path.join(env.dataDir, 'snapshots', `${snapshotId}.json`),
    JSON.stringify(normalized, null, 2),
    'utf8'
  );

  return normalized;
}

async function getSnapshot(snapshotId) {
  if (!snapshotId) return null;

  await ensureDataDir();
  try {
    const content = await fs.readFile(path.join(env.dataDir, 'snapshots', `${snapshotId}.json`), 'utf8');
    return JSON.parse(content);
  } catch {
    return null;
  }
}

async function markMessageAccepted(messageId, value) {
  const index = await readJson('sent-index.json', {});
  index[messageId] = {
    ...value,
    updatedDate: new Date().toISOString()
  };
  await writeJson('sent-index.json', index);
}

async function getMessageStatus(messageId) {
  const index = await readJson('sent-index.json', {});
  return index[messageId] || null;
}

module.exports = {
  ensureDataDir,
  saveDraftConfig,
  savePublishedConfig,
  getPublishedConfig,
  saveSnapshot,
  getSnapshot,
  markMessageAccepted,
  getMessageStatus,
  makeConfigKey
};
