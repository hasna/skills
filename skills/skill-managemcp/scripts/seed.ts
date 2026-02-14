#!/usr/bin/env bun

import { sql, testConnection, closeConnection } from '../src/db';

console.log('Seeding database...');

const connected = await testConnection();
if (!connected) {
  console.error('Failed to connect to database');
  process.exit(1);
}

console.log('Database connected\n');

try {
  const [{ count }] = await sql`SELECT COUNT(*) as count FROM items`;

  if (parseInt(count) > 0) {
    console.log(`Database already has ${count} items - skipping seed`);
    console.log('To re-seed, truncate the items table first\n');
    process.exit(0);
  }

  console.log('Inserting seed data...');

  const seedItems = [
    {
      name: 'Example Item 1',
      description: 'This is the first example item',
      metadata: { category: 'example', priority: 'high' },
    },
    {
      name: 'Example Item 2',
      description: 'This is the second example item',
      metadata: { category: 'sample', priority: 'medium' },
    },
    {
      name: 'Example Item 3',
      description: 'This is the third example item',
      metadata: { category: 'demo', priority: 'low' },
    },
  ];

  for (const item of seedItems) {
    await sql`
      INSERT INTO items (name, description, metadata)
      VALUES (${item.name}, ${item.description}, ${JSON.stringify(item.metadata)})
    `;
    console.log(`  Created: ${item.name}`);
  }

  console.log(`\nSeeded ${seedItems.length} items successfully`);
} catch (error) {
  console.error('\nSeeding failed:', error);
  process.exit(1);
} finally {
  await closeConnection();
}
