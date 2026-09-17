const crypto = require('crypto');

// Obtém a chave de 32 bytes a partir do segredo no ambiente
function getMasterKey() {
  const secret = process.env.ENCRYPTION_SECRET || 'chave_mestra_padrao_desenvolvimento_32b!';
  return crypto.createHash('sha256').update(String(secret)).digest();
}

/**
 * Criptografa um token de acesso permanente da Meta usando AES-256-GCM
 */
function encryptToken(plainText) {
  if (!plainText) return null;
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-gcm', getMasterKey(), iv);
  
  let encrypted = cipher.update(String(plainText), 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const tag = cipher.getAuthTag();

  return {
    encrypted,
    iv: iv.toString('hex'),
    tag: tag.toString('hex')
  };
}

/**
 * Descriptografa um token de acesso permanente da Meta usando AES-256-GCM
 */
function decryptToken(encryptedHex, ivHex, tagHex) {
  if (!encryptedHex || !ivHex || !tagHex) return null;
  try {
    const iv = Buffer.from(ivHex, 'hex');
    const tag = Buffer.from(tagHex, 'hex');
    const decipher = crypto.createDecipheriv('aes-256-gcm', getMasterKey(), iv);
    decipher.setAuthTag(tag);

    let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch (err) {
    console.error('Falha ao descriptografar token Meta:', err.message);
    return null;
  }
}

/**
 * Valida a assinatura HMAC-SHA256 da Meta (X-Hub-Signature-256)
 */
function verifyMetaSignature(rawBody, signatureHeader, appSecret) {
  if (!signatureHeader || !appSecret) return true; // Se appSecret não configurado, ignora
  try {
    const [algo, signature] = signatureHeader.split('=');
    if (algo !== 'sha256' || !signature) return false;

    const expected = crypto
      .createHmac('sha256', appSecret)
      .update(rawBody)
      .digest('hex');

    return crypto.timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(expected, 'hex'));
  } catch (err) {
    return false;
  }
}

module.exports = {
  encryptToken,
  decryptToken,
  verifyMetaSignature
};
