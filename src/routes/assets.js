const express = require('express');
const contentBuilderService = require('../services/contentBuilderService');
const variableParserService = require('../services/variableParserService');

const router = express.Router();

router.get('/assets', async (req, res, next) => {
  try {
    const result = await contentBuilderService.listAssets({
      page: req.query.page,
      pageSize: req.query.pageSize,
      search: req.query.search || req.query.q,
      assetType: req.query.assetType,
      categoryId: req.query.categoryId
    });

    res.json(result);
  } catch (error) {
    error.message = `No se pudieron consultar assets en Content Builder. ${error.message}`;
    next(error);
  }
});

router.get('/assets/:id', async (req, res, next) => {
  try {
    const asset = await contentBuilderService.getAssetById(req.params.id);

    const views = asset.views || {};
    const data = asset.data || {};
    const legacyData = asset.legacyData || {};

    const subject =
      views.subjectline ||
      views.subject ||
      data.subjectline ||
      data.subject ||
      legacyData.subject ||
      '';

    const preheader =
      views.preheader ||
      data.preheader ||
      legacyData.preheader ||
      '';

    const html =
      views.html ||
      asset.content ||
      data.email?.html ||
      data.html ||
      legacyData.html ||
      '';

    const text =
      views.text ||
      data.text ||
      legacyData.text ||
      '';

    const combined = [subject, preheader, html, text].join('\n');

    const variables = variableParserService.extractVariables(combined);

    const warnings = [];

    if (/%%=|%%\[|%%[^%]+%%/.test(combined)) {
      warnings.push('El asset contiene AMPscript o personalization strings de SFMC que no se ejecutan fuera del motor nativo de SFMC.');
    }

    if (/dynamic/i.test(JSON.stringify(asset.assetType || {})) || /dynamic/i.test(combined)) {
      warnings.push('El asset puede contener contenido dinámico que no puede resolverse completamente fuera de SFMC.');
    }

    res.json({
      success: true,
      id: asset.id,
      customerKey: asset.customerKey,
      name: asset.name,
      assetType: asset.assetType,
      category: asset.category,
      categoryId: asset.category?.id || null,
      subject,
      preheader,
      html,
      text,
      variables,
      warnings,
      rawMetadata: {
        createdDate: asset.createdDate,
        modifiedDate: asset.modifiedDate
      }
    });
  } catch (error) {
    error.message = `No se pudo recuperar el asset seleccionado. ${error.message}`;
    next(error);
  }
});

module.exports = router;
