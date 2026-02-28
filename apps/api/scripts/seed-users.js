#!/usr/bin/env node

/**
 * Seed script: creates 12 test user accounts.
 * Usage:  node scripts/seed-users.js
 * Make sure the API server is running on http://localhost:3000
 */

const BASE_URL = 'http://localhost:3000';

const users = [
  { email: 'user1@gmail.com',  password: 'user1123',  display_name: 'Alex Fernando',    native_dialect: 'english' },
  { email: 'user2@gmail.com',  password: 'user2123',  display_name: 'Kamal Perera',     native_dialect: 'sinhala' },
  { email: 'user3@gmail.com',  password: 'user3123',  display_name: 'Priya Krishnan',   native_dialect: 'tamil'   },
  { email: 'user4@gmail.com',  password: 'user4123',  display_name: 'Sarah Mitchell',   native_dialect: 'english' },
  { email: 'user5@gmail.com',  password: 'user5123',  display_name: 'Dilshan Silva',    native_dialect: 'sinhala' },
  { email: 'user6@gmail.com',  password: 'user6123',  display_name: 'Kavitha Nair',     native_dialect: 'tamil'   },
  { email: 'user7@gmail.com',  password: 'user7123',  display_name: 'James Cooray',     native_dialect: 'english' },
  { email: 'user8@gmail.com',  password: 'user8123',  display_name: 'Chamari Wickrama', native_dialect: 'sinhala' },
  { email: 'user9@gmail.com',  password: 'user9123',  display_name: 'Niroshan Kumaran', native_dialect: 'tamil'   },
  { email: 'user10@gmail.com', password: 'user10123', display_name: 'Emma Reynolds',    native_dialect: 'english' },
  { email: 'user11@gmail.com', password: 'user11123', display_name: 'Asitha Bandara',   native_dialect: 'sinhala' },
  { email: 'user12@gmail.com', password: 'user12123', display_name: 'Divya Rajan',      native_dialect: 'tamil'   },
];

async function registerUser(user) {
  const res = await fetch(`${BASE_URL}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(user),
  });

  const data = await res.json();

  if (!res.ok) {
    const msg = data?.message ?? JSON.stringify(data);
    console.error(`  ✗ ${user.email} — ${res.status}: ${msg}`);
    return false;
  }

  console.log(
    `  ✓ ${user.email} (native: ${user.native_dialect})  id=${data.id}`,
  );
  return true;
}

async function main() {
  console.log(`Seeding ${users.length} users against ${BASE_URL} ...\n`);

  let ok = 0;
  let fail = 0;

  for (const user of users) {
    const success = await registerUser(user);
    success ? ok++ : fail++;
  }

  console.log(`\nDone — ${ok} created, ${fail} failed.`);
}

main().catch((err) => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
