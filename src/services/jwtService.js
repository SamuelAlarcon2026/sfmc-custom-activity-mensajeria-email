const jwt = require('jsonwebtoken');
const env = require('../config/env');

function verifyJourneyPayload(req, options = {}) {
  const body = req.body || {};

  // Journey Builder commonly sends { jwt: "..." } when useJwt=true.
  if (body.jwt) {
    if (!env.jwtSigningSecret) {
      if (env.jwtRequired) {
        const error = new Error('JWT_SIGNING_SECRET is not configured.');
        error.statusCode = 500;
        throw error;
      }

      return body;
    }

    try {
      return jwt.verify(body.jwt, env.jwtSigningSecret);
    } catch (error) {
      error.statusCode = 401;
      error.message = `Invalid Journey Builder JWT: ${error.message}`;
      throw error;
    }
  }

  if (options.allowUnsigned && env.uiEndpointsAllowUnsigned) {
    return body;
  }

  if (env.jwtRequired && env.nodeEnv === 'production') {
    const error = new Error('Missing Journey Builder JWT.');
    error.statusCode = 401;
    throw error;
  }

  return body;
}

module.exports = {
  verifyJourneyPayload
};
