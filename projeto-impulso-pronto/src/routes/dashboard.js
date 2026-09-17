const express = require('express');
const router = express.Router();
const { db, checkTenantQuota } = require('../db/database');

router.get('/stats', (req, res) => {
  try {
    const tenantId = req.user?.tenantId || 1;

    const totalCampaigns = db.prepare('SELECT COUNT(*) as count FROM campaigns WHERE tenant_id = ?').get(tenantId).count;

    const aggregate = db.prepare(`
      SELECT 
        COALESCE(SUM(total_contacts), 0) as total_contacts,
        COALESCE(SUM(sent_count), 0) as total_sent,
        COALESCE(SUM(delivered_count), 0) as total_delivered,
        COALESCE(SUM(read_count), 0) as total_read,
        COALESCE(SUM(failed_count), 0) as total_failed
      FROM campaigns
      WHERE tenant_id = ?
    `).get(tenantId);

    const activeCampaigns = db.prepare(`
      SELECT COUNT(*) as count FROM campaigns WHERE tenant_id = ? AND status = 'RUNNING'
    `).get(tenantId).count;

    const deliveryRate = aggregate.total_sent > 0 
      ? Math.round((aggregate.total_delivered / aggregate.total_sent) * 100) 
      : 0;

    const readRate = aggregate.total_delivered > 0 
      ? Math.round((aggregate.total_read / aggregate.total_delivered) * 100) 
      : 0;

    const recentCampaigns = db.prepare(`
      SELECT 
        id, name, template_name, total_contacts, sent_count, delivered_count, read_count, failed_count, status, created_at,
        ROUND((CAST(sent_count AS FLOAT) / NULLIF(total_contacts, 0)) * 100, 1) as progress_percent
      FROM campaigns
      WHERE tenant_id = ?
      ORDER BY created_at DESC
      LIMIT 6
    `).all(tenantId);

    const quota = checkTenantQuota(tenantId);

    res.json({
      totalCampaigns,
      activeCampaigns,
      totalContacts: aggregate.total_contacts,
      totalSent: aggregate.total_sent,
      totalDelivered: aggregate.total_delivered,
      totalRead: aggregate.total_read,
      totalFailed: aggregate.total_failed,
      deliveryRate,
      readRate,
      recentCampaigns,
      quota
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
