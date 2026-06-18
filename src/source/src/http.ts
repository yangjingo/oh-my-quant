export async function postJson<TResponse>(
  url: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<TResponse> {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText}`);
  }
  return await response.json() as TResponse;
}

export async function getJson<TResponse>(
  url: string,
  headers: Record<string, string> = {},
): Promise<TResponse> {
  const response = await fetch(url, { headers });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText}`);
  }
  return await response.json() as TResponse;
}
