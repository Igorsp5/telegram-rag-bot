const { StringSession } = require('telegram/sessions');
const { TelegramClient } = require('telegram');
const input = require('input'); // npm install input

// Read from .env — run 'cp .env.example .env' first
require('dotenv').config();
const apiId = parseInt(process.env.API_ID || '0', 10);
const apiHash = process.env.API_HASH || '';
if (!apiId || !apiHash) { console.error('Set API_ID and API_HASH in .env first'); process.exit(1); }
const stringSession = new StringSession('');

(async () => {
  console.log('Starting Telegram session generator...');
  const client = new TelegramClient(stringSession, apiId, apiHash, {
    connectionRetries: 5,
  });

  await client.start({
    phoneNumber: async () => await input.text('Enter phone number (with country code, e.g. +1234567890): '),
    password: async () => await input.text('Enter 2FA password (press Enter to skip): '),
    phoneCode: async () => await input.text('Enter the verification code from Telegram: '),
    onError: (err) => console.log(err),
  });

  console.log('\n✅ Authorization successful!');
  console.log('Copy this SESSION string to your .env file:\n');
console.log('SESSION=' + client.session.save());
console.log('\n⚠️  Keep this string private — it grants full access to your account.');

})();