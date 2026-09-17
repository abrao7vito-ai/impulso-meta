/**
 * Helper para sanitização e validação de números de telefone no padrão internacional exigido pela Meta Cloud API.
 * Exemplo de formato final: 5511999998888 (DDI + DDD + Número, apenas dígitos, sem o símbolo +)
 */
function sanitizePhoneNumber(rawPhone, defaultCountryCode = '55') {
  if (!rawPhone) {
    return { isValid: false, formatted: '', original: rawPhone, reason: 'Número vazio' };
  }

  const original = String(rawPhone).trim();
  // Remove tudo que não for dígito
  let digits = original.replace(/\D/g, '');

  // Remove zeros à esquerda (ex: 011999998888 ou 0055...)
  while (digits.startsWith('0')) {
    digits = digits.substring(1);
  }

  if (digits.length < 8) {
    return { isValid: false, formatted: '', original, reason: 'Número muito curto' };
  }

  // Se tem 10 dígitos (DDD + 8 dígitos) ou 11 dígitos (DDD + 9 dígitos) no Brasil
  if ((digits.length === 10 || digits.length === 11) && defaultCountryCode === '55') {
    digits = '55' + digits;
  }

  // Validação básica do tamanho internacional (E.164: entre 10 e 15 dígitos com DDI)
  if (digits.length < 10 || digits.length > 15) {
    return { isValid: false, formatted: digits, original, reason: 'Quantidade de dígitos incompatível com padrão internacional' };
  }

  return {
    isValid: true,
    formatted: digits,
    original
  };
}

module.exports = {
  sanitizePhoneNumber
};
