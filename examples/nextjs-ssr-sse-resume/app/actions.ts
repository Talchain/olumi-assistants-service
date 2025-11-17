'use server';

const BASE_URL = process.env.OLUMI_BASE_URL || 'http://localhost:3101';

export async function startStream(brief: string): Promise<string> {
  // Return stream URL for client to fetch
  // In production, you could generate HMAC-signed URLs here
  return `${BASE_URL}/assist/draft-graph/stream?brief=${encodeURIComponent(brief)}`;
}
