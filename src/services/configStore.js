const fs = require('fs/promises');
const path = require('path');
const os = require('os');
const { v4: uuidv4 } = require('uuid');
const env = require('../config/env');

let activeDataDir = env.dataDir;
let dataDirWarningLogged = false;

function fallbackDataDirs() {
  return [
    path.resolve(process.cwd(), 'data'),
    path.join(os.tmpdir(), 'sfmc-private-relay-custom-activity')
  ];
}

function isPermissionError(error) {
  return ['EACCES', 'EPERM', 'EROFS'].includes(error?.code);
}

async function tryPrepareDataDir(candidateDir) {
  await fs.mkdir(candidateDir, { recursive: true });
  await fs.mkdir(path.join(candidateDir, 'snapshots'), { recursive: true });

  // Probe writability explicitly. Some platforms allow mkdir but fail on writes.
  const probePath = path.join(candidateDir, '.write-probe');
  await fs.writeFile(probePath, new Date().toISOString(), 'utf8');
  await fs.rm(probePath, { force: true });

  return candidateDir;
}

async function ensureDataDir() {
  const candidates = [activeDataDir, ...fallbackDataDirs()]
    .filter(Boolean)
    .map((candidate) => path.resolve(candidate));

  const uniqueCandidates = [...new Set(candidates)];
  let lastError;

  for (const candidate of uniqueCandidates) {
    try {
      activeDataDir = await tryPrepareDataDir(candidate);

      if (activeDataDir !== path.resolve(env.dataDir) && !dataDirWarningLogged) {
        console.warn(
          `[configStore] DATA_DIR "${env.dataDir}" is not writable. ` +
          `Using fallback "${activeDataDir}". Snapshots may be ephemeral unless a persistent disk is mounted.`
        );
        dataDirWarningLogged = true;
      }

      return activeDataDir;
    } catch (error) {
      lastError = error;

      if (!isPermissionError(error)) {
        // Try the remaining candidates anyway. Some Render environments can fail
        // for different filesystem reasons before a writable fallback is reached.
        continue;
      }
    }
  }

  throw lastError;
}

function getActiveDataDir() {
  return activeDataDir;
}

function getStorePath(name) {
  return path.join(activeDataDir, name);
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
    path.join(activeDataDir, 'snapshots', `${snapshotId}.json`),
    JSON.stringify(normalized, null, 2),
    'utf8'
  );

  return normalized;
}

async function getSnapshot(snapshotId) {
  if (!snapshotId) return null;

  await ensureDataDir();
  try {
    const content = await fs.readFile(path.join(activeDataDir, 'snapshots', `${snapshotId}.json`), 'utf8');
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
  getActiveDataDir,
  saveDraftConfig,
  savePublishedConfig,
  getPublishedConfig,
  saveSnapshot,
  getSnapshot,
  markMessageAccepted,
  getMessageStatus,
  makeConfigKey
};
