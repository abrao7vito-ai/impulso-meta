const { spawn } = require('child_process');
const path = require('path');
const { getSetting, setSetting } = require('./db/database');

const PORT = process.env.PORT || 3000;
const cloudflaredBin = path.join(__dirname, '..', 'bin', 'cloudflared.exe');

console.log('🔄 Iniciando túnel HTTPS seguro com Cloudflare Tunnel...');

const child = spawn(cloudflaredBin, ['tunnel', '--url', `http://localhost:${PORT}`], {
  windowsHide: true
});

let tunnelUrlFound = false;

child.stderr.on('data', (data) => {
  const output = data.toString();

  // Cloudflare outputs the URL to stderr
  const match = output.match(/https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/);
  if (match && !tunnelUrlFound) {
    tunnelUrlFound = true;
    const publicUrl = match[0];
    const webhookUrl = `${publicUrl}/api/webhook`;
    const verifyToken = getSetting('meta_verify_token') || 'token_disparo_meta_seguro_2yyh2y5w';

    setSetting('active_webhook_url', webhookUrl);

    console.log('\n=============================================================');
    console.log('🎉 TÚNEL HTTPS DA CLOUDFLARE ATIVO COM SUCESSO!');
    console.log('=============================================================');
    console.log(`🔗 Copie e cole na Meta em "URL de callback":`);
    console.log(`   👉 ${webhookUrl}`);
    console.log(`\n🔑 Em "Verificar token", cole:`);
    console.log(`   👉 ${verifyToken}`);
    console.log('=============================================================');
    console.log('Agora é só clicar em "Verificar e salvar" no painel da Meta!\n');
  }
});

child.stdout.on('data', (data) => {
  // Cloudflare stdout
});

child.on('error', (err) => {
  console.error('Erro ao executar cloudflared:', err);
});

child.on('close', (code) => {
  console.log('Túnel encerrado com código:', code);
});
