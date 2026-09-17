const express = require('express');
const router = express.Router();
const { db } = require('../db/database');
const { sanitizePhoneNumber } = require('../utils/phone');

// Listar todas as listas salvas da empresa
router.get('/', (req, res) => {
  try {
    const tenantId = req.user?.tenantId || 1;
    const lists = db.prepare(`
      SELECT 
        l.*,
        (SELECT COUNT(*) FROM contact_list_items WHERE list_id = l.id) as contact_count
      FROM contact_lists l
      WHERE l.tenant_id = ?
      ORDER BY l.created_at DESC
    `).all(tenantId);
    res.json(lists);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Criar nova lista de contatos para a empresa
router.post('/', (req, res) => {
  try {
    const tenantId = req.user?.tenantId || 1;
    const { name, description = '', contacts = [] } = req.body;
    if (!name) {
      return res.status(400).json({ error: 'Nome da lista é obrigatório.' });
    }

    const insertList = db.prepare(`
      INSERT INTO contact_lists (tenant_id, name, description, total_contacts, created_at, updated_at)
      VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `);

    const result = insertList.run(tenantId, name, description, contacts.length);
    const listId = result.lastInsertRowid;

    if (contacts.length > 0) {
      const insertItem = db.prepare(`
        INSERT INTO contact_list_items (tenant_id, list_id, phone, name, custom_data, created_at)
        VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `);

      const insertMany = db.transaction((items) => {
        for (const item of items) {
          const phoneCheck = sanitizePhoneNumber(item.phone);
          insertItem.run(
            tenantId,
            listId,
            phoneCheck.isValid ? phoneCheck.formatted : item.phone,
            item.name || '',
            JSON.stringify(item.customData || item)
          );
        }
      });
      insertMany(contacts);
    }

    res.json({
      success: true,
      listId,
      message: `Lista "${name}" criada com ${contacts.length} contatos.`
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Obter detalhes e contatos de uma lista da empresa
router.get('/:id', (req, res) => {
  try {
    const tenantId = req.user?.tenantId || 1;
    const listId = req.params.id;
    const list = db.prepare('SELECT * FROM contact_lists WHERE id = ? AND tenant_id = ?').get(listId, tenantId);
    if (!list) {
      return res.status(404).json({ error: 'Lista não encontrada.' });
    }

    const limit = parseInt(req.query.limit) || 200;
    const offset = parseInt(req.query.offset) || 0;

    const items = db.prepare(`
      SELECT * FROM contact_list_items WHERE list_id = ? AND tenant_id = ? ORDER BY id ASC LIMIT ? OFFSET ?
    `).all(listId, tenantId, limit, offset);

    const contactsList = items.map(i => ({
      ...i,
      customData: JSON.parse(i.custom_data || '{}')
    }));

    res.json({
      list,
      items: contactsList,
      contacts: contactsList
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Excluir lista salva
router.delete('/:id', (req, res) => {
  try {
    const tenantId = req.user?.tenantId || 1;
    const listId = req.params.id;
    db.prepare('DELETE FROM contact_list_items WHERE list_id = ? AND tenant_id = ?').run(listId, tenantId);
    db.prepare('DELETE FROM contact_lists WHERE id = ? AND tenant_id = ?').run(listId, tenantId);
    res.json({ success: true, message: 'Lista excluída com sucesso.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
