import { getApiKey, getApiUrl } from './config';

export interface ApiItem {
  id: string;
  name: string;
  description?: string;
  metadata?: Record<string, unknown>;
  createdAt?: string;
  updatedAt?: string;
}

export interface ListOptions {
  filter?: string;
  limit?: number;
  offset?: number;
}

export interface CreateItemData {
  name: string;
  description?: string;
  metadata?: Record<string, unknown>;
}

export class ApiError extends Error {
  constructor(
    message: string,
    public statusCode?: number,
    public response?: unknown
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function makeRequest<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const apiUrl = await getApiUrl();
  const apiKey = await getApiKey();

  if (!apiUrl) {
    throw new ApiError('API URL not configured. Run: {{name}} config --set-api-url <url>');
  }

  if (!apiKey) {
    throw new ApiError('API key not configured. Run: {{name}} config --set-api-key <key>');
  }

  const url = `${apiUrl}${endpoint}`;
  const headers = {
    'Authorization': `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    ...options.headers,
  };

  try {
    const response = await fetch(url, {
      ...options,
      headers,
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => null);
      const message = errorData?.error || response.statusText;
      throw new ApiError(`API request failed: ${message}`, response.status, errorData);
    }

    return await response.json();
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(`Network error: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

export async function listItems(options: ListOptions = {}): Promise<ApiItem[]> {
  const params = new URLSearchParams();
  if (options.filter) params.set('filter', options.filter);
  if (options.limit) params.set('limit', options.limit.toString());
  if (options.offset) params.set('offset', options.offset.toString());

  const query = params.toString();
  const endpoint = `/items${query ? `?${query}` : ''}`;

  const response = await makeRequest<{ items: ApiItem[] }>(endpoint);
  return response.items;
}

export async function getItem(id: string): Promise<ApiItem> {
  return await makeRequest<ApiItem>(`/items/${id}`);
}

export async function searchItems(query: string, limit = 10): Promise<ApiItem[]> {
  const params = new URLSearchParams({
    q: query,
    limit: limit.toString(),
  });

  const response = await makeRequest<{ items: ApiItem[] }>(`/items/search?${params}`);
  return response.items;
}

export async function createItem(data: CreateItemData): Promise<ApiItem> {
  return await makeRequest<ApiItem>('/items', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}
