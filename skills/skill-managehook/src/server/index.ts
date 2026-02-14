import { sql, testConnection, closeConnection } from '../db';

const PORT = parseInt(process.env.PORT || '3000');
const PATH_PREFIX = '/{{name}}';
const API_KEY = process.env.API_KEY || '';

// API Key validation
function validateApiKey(req: Request): boolean {
  if (!API_KEY) return true; // No key configured = open access

  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) return false;

  return authHeader.slice(7) === API_KEY;
}

const connected = await testConnection();
if (!connected) {
  console.error('Failed to connect to database');
  process.exit(1);
}

console.log('Database connection successful');

async function handleRequest(req: Request): Promise<Response> {
  const url = new URL(req.url);
  let { pathname } = url;
  const { searchParams } = url;
  const method = req.method;

  // Strip path prefix if present (for ALB routing)
  if (pathname.startsWith(PATH_PREFIX)) {
    pathname = pathname.slice(PATH_PREFIX.length) || '/';
  }

  try {
    // Health check (no auth required)
    if (pathname === '/health' && method === 'GET') {
      return Response.json({
        status: 'ok',
        service: 'service-{{name}}',
        timestamp: new Date().toISOString(),
      });
    }

    // All routes below require authentication
    if (!validateApiKey(req)) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // List items
    if (pathname === '/api/items' && method === 'GET') {
      const limit = Math.min(parseInt(searchParams.get('limit') || '10'), 100);
      const offset = Math.max(parseInt(searchParams.get('offset') || '0'), 0);

      const items = await sql`
        SELECT * FROM items
        ORDER BY created_at DESC
        LIMIT ${limit}
        OFFSET ${offset}
      `;
      return Response.json({ items });
    }

    // Create item
    if (pathname === '/api/items' && method === 'POST') {
      const body = await req.json();

      if (!body.name) {
        return Response.json({ error: 'Name is required' }, { status: 400 });
      }

      const [item] = await sql`
        INSERT INTO items (name, description, metadata)
        VALUES (${body.name}, ${body.description || null}, ${JSON.stringify(body.metadata || {})})
        RETURNING *
      `;
      return Response.json(item, { status: 201 });
    }

    return Response.json({ error: 'Not found' }, { status: 404 });
  } catch (error) {
    console.error('Request error:', error);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
}

const server = Bun.serve({
  port: PORT,
  fetch: handleRequest,
});

console.log(`Server running at http://localhost:${PORT}`);

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\nShutting down gracefully...');
  server.stop();
  await closeConnection();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\nShutting down gracefully...');
  server.stop();
  await closeConnection();
  process.exit(0);
});
