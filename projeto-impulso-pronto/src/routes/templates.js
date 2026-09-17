const express = require('express');
const router = express.Router();
const metaService = require('../services/metaService');
const { sanitizePhoneNumber } = require('../utils/phone');

// Listar templates em cache da empresa
router.get('/', (req, res) => {
  try {
    const tenantId = req.user?.tenantId || 1;
    const templates = metaService.getCachedTemplates(tenantId);
    res.json(templates);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Sincronizar templates com a Meta para a empresa
router.post('/sync', async (req, res) => {
  try {
    const tenantId = req.user?.tenantId || 1;
    const result = await metaService.syncTemplates(tenantId);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Envio de teste unitário individual
router.post('/test-send', async (req, res) => {
  try {
    const tenantId = req.user?.tenantId || 1;
    const { to, templateName, languageCode = 'pt_BR', parameters = [] } = req.body;

    if (!to || !templateName) {
      return res.status(400).json({ error: 'Número de telefone e nome do template são obrigatórios.' });
    }

    const phoneCheck = sanitizePhoneNumber(to);
    if (!phoneCheck.isValid) {
      return res.status(400).json({ error: `Telefone inválido: ${phoneCheck.reason}` });
    }

    const result = await metaService.sendTemplateMessage({
      to: phoneCheck.formatted,
      templateName,
      languageCode,
      bodyParameters: parameters
    }, tenantId);

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Criar e submeter novo template para a Meta
router.post('/', async (req, res) => {
  try {
    const tenantId = req.user?.tenantId || 1;
    const { name, category = 'MARKETING', language = 'pt_BR', headerText, bodyText, footerText, buttons = [] } = req.body;

    if (!name || !bodyText) {
      return res.status(400).json({ error: 'Nome do template e corpo da mensagem são obrigatórios.' });
    }

    const components = [];

    // Header component
    if (headerText && headerText.trim()) {
      components.push({
        type: 'HEADER',
        format: 'TEXT',
        text: headerText.trim()
      });
    }

    // Body component
    const bodyComp = {
      type: 'BODY',
      text: bodyText.trim()
    };

    // Auto-gera example para a Meta se houver variáveis {{1}}, {{2}}
    const matches = bodyText.match(/\{\{(\d+)\}\}/g) || [];
    if (matches.length > 0) {
      bodyComp.example = {
        body_text: [matches.map((m, idx) => `Exemplo_${idx + 1}`)]
      };
    }
    components.push(bodyComp);

    // Footer component
    if (footerText && footerText.trim()) {
      components.push({
        type: 'FOOTER',
        text: footerText.trim()
      });
    }

    // Buttons component
    if (buttons && buttons.length > 0) {
      components.push({
        type: 'BUTTONS',
        buttons: buttons.map(b => ({
          type: b.type || 'QUICK_REPLY',
          text: b.text,
          ...(b.url ? { url: b.url } : {})
        }))
      });
    }

    const result = await metaService.createTemplate({
      name,
      category,
      language,
      components
    }, tenantId);

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Excluir template
router.delete('/:name', async (req, res) => {
  try {
    const tenantId = req.user?.tenantId || 1;
    const result = await metaService.deleteTemplate(req.params.name, tenantId);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
