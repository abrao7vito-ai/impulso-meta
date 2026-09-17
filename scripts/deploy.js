const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

console.log('🚀 Iniciando sincronização e deploy automático no GitHub & Render...');

// Função para copiar diretórios recursivamente
function copyDir(src, dest) {
  if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === '.env') continue;

    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

// 1. Sincroniza arquivos para dentro de projeto-impulso-pronto (onde o Render lê)
const subfolder = path.join(__dirname, '..', 'projeto-impulso-pronto');
if (fs.existsSync(subfolder)) {
  console.log('📦 Sincronizando pastas src, public, data e package.json...');
  copyDir(path.join(__dirname, '..', 'src'), path.join(subfolder, 'src'));
  copyDir(path.join(__dirname, '..', 'public'), path.join(subfolder, 'public'));
  copyDir(path.join(__dirname, '..', 'data'), path.join(subfolder, 'data'));
  copyDir(path.join(__dirname, '..', 'samples'), path.join(subfolder, 'samples'));
  if (fs.existsSync(path.join(__dirname, '..', 'package.json'))) {
    fs.copyFileSync(path.join(__dirname, '..', 'package.json'), path.join(subfolder, 'package.json'));
  }
  if (fs.existsSync(path.join(__dirname, '..', 'package-lock.json'))) {
    fs.copyFileSync(path.join(__dirname, '..', 'package-lock.json'), path.join(subfolder, 'package-lock.json'));
  }
}

// 2. Comandos Git
try {
  const commitMsg = process.argv[2] || `Atualização automática: ${new Date().toLocaleString('pt-BR')}`;
  
  console.log('📝 Registrando alterações no Git...');
  execSync('git add -A', { stdio: 'inherit' });
  
  try {
    execSync(`git commit -m "${commitMsg}"`, { stdio: 'inherit' });
  } catch (e) {
    console.log('ℹ️ Nenhuma alteração pendente para commitar.');
  }

  console.log('⬆️ Enviando para o GitHub (o Render vai atualizar em seguida)...');
  execSync('git push origin main', { stdio: 'inherit' });

  console.log('\n🎉 SUCESSO! Alterações enviadas para o GitHub.');
  console.log('⚡ O Render já detectou a mudança e está atualizando o seu site na nuvem!');
} catch (err) {
  console.error('❌ Erro durante o deploy:', err.message);
  process.exit(1);
}
