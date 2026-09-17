const express = require('express');
const router = express.Router();
const multer = require('multer');
const { db, checkTenantQuota } = require('../db/database');
const importService = require('../services/importService');
const campaignEngine = require('../services/campaignEngine');
const xlsx = require('xlsx');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

// Importar e pré-visualizar arquivo (Excel / CSV)
router.post('/import-preview', upload.single('file'), (req, res) => {
  try {
    let result;
    if (req.file) {
      result = importService.parseFile(req.file.buffer, req.file.originalname);
    } else if (req.body.textData) {
      result = importService.parseRawText(req.body.textData);
    } else {
      return res.status(400).json({ error: 'Nenhum arquivo ou texto fornecido.' });
    }

    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Criar nova campanha
router.post('/', (req, res) => {
  try {
    const tenantId = req.user?.tenantId || 1;
    const {
      name,
      templateName,
      templateLanguage = 'pt_BR',
      delayMs = 1000,
      parametersMapping = {},
      headerVariable = null,
      scheduledAt = null,
      contacts = [],
      consentSource = null
    } = req.body;

    if (!name || !templateName) {
      return res.status(400).json({ error: 'Nome da campanha e nome do template são obrigatórios.' });
    }

    if (!contacts || contacts.length === 0) {
      return res.status(400).json({ error: 'A lista de contatos não pode estar vazia.' });
    }

    // Validação da cota mensal do tenant
    const quota = checkTenantQuota(tenantId);
    if (!quota.canSend) {
      return res.status(403).json({ error: quota.reason, quota });
    }

    const initialStatus = scheduledAt ? 'SCHEDULED' : 'DRAFT';
    const scheduledIso = scheduledAt ? new Date(scheduledAt).toISOString() : null;

    const insertCampaign = db.prepare(`
      INSERT INTO campaigns (tenant_id, name, template_name, template_language, total_contacts, delay_ms, parameters_mapping, header_variable, scheduled_at, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const result = insertCampaign.run(
      tenantId,
      name,
      templateName,
      templateLanguage,
      contacts.length,
      parseInt(delayMs) || 1000,
      JSON.stringify(parametersMapping),
      headerVariable,
      scheduledIso,
      initialStatus
    );

    const campaignId = result.lastInsertRowid;

    // Registro de Consentimento LGPD (se informado)
    if (consentSource) {
      try {
        db.prepare(`
          INSERT INTO consent_logs (tenant_id, campaign_id, source, terms_version, ip_address, declared_by_user_id)
          VALUES (?, ?, ?, 'v1.0', ?, ?)
        `).run(tenantId, campaignId, consentSource, req.ip || '', req.user?.id || null);
      } catch (_) {}
    }

    // Insere os contatos vinculados à campanha e ao tenant
    const insertMessage = db.prepare(`
      INSERT INTO campaign_messages (tenant_id, campaign_id, phone, name, custom_data, status)
      VALUES (?, ?, ?, ?, ?, 'PENDING')
    `);

    const insertMany = db.transaction((list) => {
      for (const item of list) {
        insertMessage.run(
          tenantId,
          campaignId,
          item.phone,
          item.name || '',
          JSON.stringify(item.customData || item)
        );
      }
    });

    insertMany(contacts);

    res.json({
      success: true,
      campaignId,
      message: `Campanha criada com ${contacts.length} contatos.`
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Listar todas as campanhas da empresa
router.get('/', (req, res) => {
  try {
    const tenantId = req.user?.tenantId || 1;
    const rows = db.prepare(`
      SELECT 
        c.*,
        ROUND((CAST(c.sent_count AS FLOAT) / NULLIF(c.total_contacts, 0)) * 100, 1) as progress_percent
      FROM campaigns c
      WHERE c.tenant_id = ?
      ORDER BY c.created_at DESC
    `).all(tenantId);

    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Detalhes da campanha e mensagens
router.get('/:id', (req, res) => {
  try {
    const tenantId = req.user?.tenantId || 1;
    const campaignId = req.params.id;
    const campaign = db.prepare('SELECT * FROM campaigns WHERE id = ? AND tenant_id = ?').get(campaignId, tenantId);

    if (!campaign) {
      return res.status(404).json({ error: 'Campanha não encontrada.' });
    }

    const limit = parseInt(req.query.limit) || 200;
    const offset = parseInt(req.query.offset) || 0;
    const statusFilter = req.query.status;

    let query = 'SELECT * FROM campaign_messages WHERE campaign_id = ? AND tenant_id = ?';
    const params = [campaignId, tenantId];

    if (statusFilter && statusFilter !== 'ALL') {
      query += ' AND status = ?';
      params.push(statusFilter);
    }

    query += ' ORDER BY id ASC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const messages = db.prepare(query).all(...params);

    const totalFiltered = db.prepare(
      `SELECT COUNT(*) as count FROM campaign_messages WHERE campaign_id = ? AND tenant_id = ? ${statusFilter && statusFilter !== 'ALL' ? 'AND status = ?' : ''}`
    ).get(statusFilter && statusFilter !== 'ALL' ? [campaignId, tenantId, statusFilter] : [campaignId, tenantId]).count;

    res.json({
      campaign,
      messages: messages.map(m => ({
        ...m,
        custom_data: JSON.parse(m.custom_data || '{}')
      })),
      totalFiltered,
      limit,
      offset
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Iniciar disparo
router.post('/:id/start', async (req, res) => {
  try {
    const result = await campaignEngine.startCampaign(req.params.id);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Agendar disparo
router.post('/:id/schedule', (req, res) => {
  try {
    const { scheduledAt } = req.body;
    if (!scheduledAt) return res.status(400).json({ error: 'Data e hora do agendamento são obrigatórias.' });
    const result = campaignEngine.scheduleCampaign(req.params.id, scheduledAt);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Pausar disparo
router.post('/:id/pause', (req, res) => {
  try {
    const result = campaignEngine.pauseCampaign(req.params.id);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Retomar disparo
router.post('/:id/resume', (req, res) => {
  try {
    const result = campaignEngine.resumeCampaign(req.params.id);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Cancelar disparo
router.post('/:id/cancel', (req, res) => {
  try {
    const result = campaignEngine.cancelCampaign(req.params.id);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Excluir campanha
router.delete('/:id', (req, res) => {
  try {
    const tenantId = req.user?.tenantId || 1;
    const campaignId = req.params.id;
    campaignEngine.cancelCampaign(campaignId);

    db.prepare('DELETE FROM campaign_messages WHERE campaign_id = ? AND tenant_id = ?').run(campaignId, tenantId);
    db.prepare('DELETE FROM campaigns WHERE id = ? AND tenant_id = ?').run(campaignId, tenantId);

    res.json({ success: true, message: 'Campanha excluída.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Exportar relatório em Excel (.xlsx)
router.get('/:id/export', (req, res) => {
  try {
    const tenantId = req.user?.tenantId || 1;
    const campaignId = req.params.id;
    const campaign = db.prepare('SELECT * FROM campaigns WHERE id = ? AND tenant_id = ?').get(campaignId, tenantId);
    if (!campaign) return res.status(404).send('Campanha não encontrada.');

    const messages = db.prepare('SELECT * FROM campaign_messages WHERE campaign_id = ? AND tenant_id = ?').all(campaignId, tenantId);

    const exportData = messages.map(m => {
      const custom = JSON.parse(m.custom_data || '{}');
      return {
        ID: m.id,
        Telefone: m.phone,
        Nome: m.name,
        Status: m.status,
        'ID Oficial (wamid)': m.wamid || '',
        'Enviado em': m.sent_at || '',
        'Entregue em': m.delivered_at || '',
        'Lido em': m.read_at || '',
        'Erro / Motivo': m.error_message || '',
        ...custom
      };
    });

    const worksheet = xlsx.utils.json_to_sheet(exportData);
    const workbook = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(workbook, worksheet, 'Resultados');

    const buffer = xlsx.write(workbook, { type: 'buffer', bookType: 'xlsx' });

    res.setHeader('Content-Disposition', `attachment; filename="relatorio_campanha_${campaignId}.xlsx"`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buffer);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
