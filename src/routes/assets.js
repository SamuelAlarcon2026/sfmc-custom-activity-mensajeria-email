const express = require('express');
const { listAssets, getAssetDetail } = require('../services/contentBuilderService');

const router = express.Router();

router.get('/assets', async (req, res, next) => {
  try {
    const result = await listAssets({
      page: req.query.page,
      pageSize: req.query.pageSize || req.query.limit,
      search: req.query.search || req.query.q,
      assetType: req.query.assetType,
      categoryId: req.query.categoryId || req.query.folderId
    });

    res.json({
      success: true,
      ...result
    });
  } catch (err) {
    next(err);
  }
});

router.get('/assets/:id', async (req, res, next) => {
  try {
    const detail = await getAssetDetail(req.params.id);
    res.json({
      success: true,
      asset: detail
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;