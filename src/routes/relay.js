const express = require('express');
const { AppError } = require('../middleware/errorHandler');
const { renderEmailTemplate, hasBlockingUnresolved } = require('../services/templateRenderService');
const { buildRelayPayload, postToRelay, isEmail } = require('../services/relayService');
const { getAssetDetail } = require('../services/contentBuilderService');

const router = express.Router();

router.post('/preview', async (req, res, next) => {
  try {
    const result = renderEmailTemplate(req.body || {}, { useSamples: true });

    res.json({
      success: true,
      ...result
    });
  } catch (err) {
    next(err);
  }
});

router.post('/test-send', async (req, res, next) => {
  try {
    const body = req.body || {};
    const to = String(body.to || '').trim();

    if (!isEmail(to)) {
      throw new AppError('Email de test inválido.', 400, ['Introduce un email de test válido.'], 'INVALID_TEST_EMAIL');
    }

    let html = body.html || '';
    let text = body.text || '';
    let subject = body.subject || '';
    let preheader = body.preheader || '';

    if ((!html && !text) && body.assetId) {
      const asset = await getAssetDetail(String(body.assetId));
      html = asset.html;
      text = asset.text;
      subject = subject || asset.subject;
      preheader = preheader || asset.preheader;
    }

    const rendered = renderEmailTemplate({
      subject,
      preheader,
      html,
      text,
      variableMappings: body.variableMappings,
      sampleData: body.sampleData,
      warnings: body.warnings
    }, { useSamples: true });

    if (hasBlockingUnresolved(rendered)) {
      throw new AppError(
        'No se puede enviar el test porque hay variables obligatorias sin resolver.',
        400,
        rendered.unresolvedVariables,
        'UNRESOLVED_VARIABLES'
      );
    }

    const relayPayload = buildRelayPayload({
      to,
      fromName: body.fromName,
      fromEmail: body.fromEmail,
      replyTo: body.replyTo,
      subject: rendered.subject,
      preheader: rendered.preheader,
      html: rendered.html,
      text: rendered.text,
      metadata: {
        test: true,
        assetId: body.assetId || null,
        correlationId: req.correlationId
      }
    });

    const relayResult = await postToRelay(relayPayload, { correlationId: req.correlationId });

    res.json({
      success: true,
      message: 'Test aceptado por el relay privado.',
      relay: relayResult,
      rendered: {
        subject: rendered.subject,
        preheader: rendered.preheader,
        resolvedVariables: rendered.resolvedVariables,
        unresolvedVariables: rendered.unresolvedVariables,
        warnings: rendered.warnings
      }
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;