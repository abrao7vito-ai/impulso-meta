const xlsx = require('xlsx');
const { sanitizePhoneNumber } = require('../utils/phone');

class ImportService {
  /**
   * Processa buffer de arquivo Excel (.xlsx, .xls) ou CSV
   */
  parseFile(buffer, filename) {
    const workbook = xlsx.read(buffer, { type: 'buffer' });
    const firstSheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[firstSheetName];
    
    // Converte para JSON com cabeçalhos na primeira linha
    const rawRows = xlsx.utils.sheet_to_json(worksheet, { defval: '' });
    return this.processParsedRows(rawRows);
  }

  /**
   * Processa texto colado diretamente (CSV ou TSV)
   */
  parseRawText(text) {
    if (!text || !text.trim()) {
      throw new Error('Conteúdo de texto vazio.');
    }

    const workbook = xlsx.read(text.trim(), { type: 'string' });
    const firstSheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[firstSheetName];
    const rawRows = xlsx.utils.sheet_to_json(worksheet, { defval: '' });
    return this.processParsedRows(rawRows);
  }

  /**
   * Identifica colunas e valida telefones
   */
  processParsedRows(rawRows) {
    if (!rawRows || rawRows.length === 0) {
      throw new Error('Nenhum dado encontrado no arquivo.');
    }

    const headers = Object.keys(rawRows[0]);

    // Tenta autodetectar a coluna de telefone
    const phoneKeywords = ['telefone', 'celular', 'phone', 'whatsapp', 'numero', 'número', 'contato', 'tel', 'mobile'];
    let detectedPhoneCol = headers.find(h => phoneKeywords.includes(h.toLowerCase().trim())) || '';

    // Tenta autodetectar a coluna de nome
    const nameKeywords = ['nome', 'name', 'cliente', 'destinatario', 'destinatário', 'contato'];
    let detectedNameCol = headers.find(h => nameKeywords.includes(h.toLowerCase().trim())) || '';

    const validContacts = [];
    const invalidContacts = [];

    for (let i = 0; i < rawRows.length; i++) {
      const row = rawRows[i];
      const rawPhone = detectedPhoneCol ? row[detectedPhoneCol] : (row[headers[0]] || '');
      const rawName = detectedNameCol ? row[detectedNameCol] : '';

      const phoneValidation = sanitizePhoneNumber(rawPhone);

      const contactObj = {
        rowNumber: i + 1,
        phone: phoneValidation.formatted || String(rawPhone || ''),
        rawPhone: String(rawPhone || ''),
        name: String(rawName || ''),
        isValid: phoneValidation.isValid,
        reason: phoneValidation.reason,
        customData: row
      };

      if (phoneValidation.isValid) {
        validContacts.push(contactObj);
      } else {
        invalidContacts.push(contactObj);
      }
    }

    return {
      headers,
      detectedPhoneCol,
      detectedNameCol,
      totalRows: rawRows.length,
      validCount: validContacts.length,
      invalidCount: invalidContacts.length,
      samplePreview: rawRows.slice(0, 5),
      validContacts,
      invalidContacts
    };
  }
}

module.exports = new ImportService();
