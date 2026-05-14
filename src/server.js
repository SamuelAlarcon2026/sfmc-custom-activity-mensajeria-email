const path = require('path');
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const env = require('./config/env');
const configRoute = require('./routes/configRoute');
const activityRoutes = require('./routes/activityRoutes');
const { ensureDataDir, getActiveDataDir } = require('./services/configStore');

const app = express();

app.set('trust proxy', 1);

/**
 * Do not use X-Frame-Options or a restrictive CSP here.
 * Journey Builder opens the config UI inside a Salesforce iframe.
 * Headers such as X-Frame-Options:SAMEORIGIN or frame-ancestors 'self'
 * make the activity appear in the palette but prevent the modal from opening.
 */
app.use((_req, res, next) => {
  res.removeHeader('X-Frame-Options');
  res.removeHeader('Content-Security-Policy');
  next();
});

app.use(cors({
  origin: env.corsOrigin ? env.corsOrigin.split(',').map((origin) => origin.trim()) : true,
  credentials: true
}));

app.use(morgan(env.nodeEnv === 'production' ? 'combined' : 'dev'));

app.use(rateLimit({
  windowMs: 60 * 1000,
  limit: 600,
  standardHeaders: true,
  legacyHeaders: false
}));

app.use(express.json({
  limit: '5mb',
  verify: (req, _res, buf) => {
    req.rawBody = buf.toString('utf8');
  }
}));

app.use(express.urlencoded({
  extended: true,
  limit: '5mb'
}));

function sendIndex(_req, res) {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
}

app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'sfmc-private-relay-custom-activity',
    version: require('../package.json').version,
    timestamp: new Date().toISOString(),
    dataDir: getActiveDataDir()
  });
});

app.get('/', sendIndex);
app.get('/index.html', sendIndex);
app.get('/ui', sendIndex);
app.get('/ui/', sendIndex);
app.get('/ui/index.html', sendIndex);

app.use(configRoute);
app.use(activityRoutes);
app.use(express.static(path.join(__dirname, '..', 'public'), {
  etag: false,
  maxAge: 0,
  setHeaders: (res) => {
    res.removeHeader('X-Frame-Options');
    res.removeHeader('Content-Security-Policy');
    res.setHeader('Cache-Control', 'no-store');
  }
}));

app.use((req, res) => {
  res.status(404).json({
    status: 'error',
    message: `Route not found: ${req.method} ${req.path}`
  });
});

app.use((error, _req, res, _next) => {
  const statusCode = error.statusCode || error.response?.status || 500;
  const response = {
    status: 'error',
    message: error.message || 'Unexpected error',
    code: error.code || 'INTERNAL_ERROR'
  };

  if (env.nodeEnv !== 'production') {
    response.stack = error.stack;
    response.details = error.response?.data || error.details;
  }

  console.error('[server] error:', error.response?.data || error);
  res.status(statusCode).json(response);
});

ensureDataDir()
  .then(() => {
    app.listen(env.port, () => {
      console.log(`SFMC Private Relay Custom Activity listening on port ${env.port}`);
      console.log(`Public base URL: ${env.publicBaseUrl || '(derived from request)'}`);
      console.log(`Data directory: ${getActiveDataDir()}`);
    });
  })
  .catch((error) => {
    console.error('Unable to initialize data directory:', error);
    process.exit(1);
  });
