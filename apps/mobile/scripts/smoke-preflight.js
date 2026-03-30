const fs = require('fs');
const path = require('path');

const mobileRoot = path.resolve(__dirname, '..');

const requiredFiles = [
  {
    label: 'Mobile env file',
    filePath: path.join(mobileRoot, '.env'),
  },
  {
    label: 'Firebase config (root)',
    filePath: path.join(mobileRoot, 'google-services.json'),
  },
  {
    label: 'Firebase config (android app)',
    filePath: path.join(mobileRoot, 'android', 'app', 'google-services.json'),
  },
];

let hasError = false;

for (const required of requiredFiles) {
  if (!fs.existsSync(required.filePath)) {
    console.error(`ERROR: Missing ${required.label}: ${required.filePath}`);
    hasError = true;
  }
}

const envPath = path.join(mobileRoot, '.env');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  const envLine = envContent.match(/^\s*EXPO_PUBLIC_API_URL\s*=\s*(.+)\s*$/m);

  if (!envLine) {
    console.error('ERROR: EXPO_PUBLIC_API_URL is missing in apps/mobile/.env');
    hasError = true;
  } else {
    const rawValue = envLine[1].trim();
    const url = rawValue.replace(/^['\"]|['\"]$/g, '');

    if (!/^https?:\/\//i.test(url)) {
      console.error(
        `ERROR: EXPO_PUBLIC_API_URL must start with http:// or https:// (current: ${url})`,
      );
      hasError = true;
    }

    if (/localhost/i.test(url)) {
      console.warn(
        'WARN: EXPO_PUBLIC_API_URL uses localhost. This works on iOS simulator, but not on a physical device.',
      );
    }
  }
}

if (hasError) {
  console.error('\nMobile smoke preflight failed. Fix the errors above and retry.');
  process.exit(1);
}

console.log('Mobile smoke preflight passed.');
