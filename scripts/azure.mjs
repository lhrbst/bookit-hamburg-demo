import { spawnSync } from 'node:child_process';

export function blobUrl(account, container, key) {
  if (!/^[a-z0-9]{3,24}$/.test(account) || !/^[a-z0-9-]+$/.test(container)) {
    throw new Error('Invalid state storage location');
  }
  return `https://${account}.blob.core.windows.net/${container}/${key.split('/').map(encodeURIComponent).join('/')}`;
}

export function azureClient({ fetchImpl = fetch, execute = spawnSync } = {}) {
  const tokens = new Map();
  return async (url, options = {}) => {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' ||
        !(parsed.hostname === 'management.azure.com' || /^[a-z0-9]{3,24}\.blob\.core\.windows\.net$/.test(parsed.hostname))) {
      throw new Error('Refusing to send Azure credentials to an unexpected endpoint');
    }
    const storage = parsed.hostname.endsWith('.blob.core.windows.net');
    const resource = storage ? 'https://storage.azure.com/' : 'https://management.azure.com/';
    let token = tokens.get(resource);
    if (!token || token.expires_on * 1000 < Date.now() + 60_000) {
      const result = execute('az', ['account', 'get-access-token', '--resource', resource, '-o', 'json'], { encoding: 'utf8' });
      if (result.status !== 0) throw new Error(`Azure token lookup failed: ${result.stderr}`);
      token = JSON.parse(result.stdout);
      if (!token.accessToken || !Number.isFinite(Number(token.expires_on))) throw new Error('Invalid Azure token response');
      tokens.set(resource, token);
    }
    const response = await fetchImpl(url, {
      ...options, redirect: 'error', signal: AbortSignal.timeout(30_000),
      headers: {
        Authorization: `Bearer ${token.accessToken}`,
        ...(storage ? { 'x-ms-version': '2023-11-03', 'x-ms-date': new Date().toUTCString() } : {}),
        ...options.headers,
      },
    });
    if (!response.ok && !(options.allowNotFound && response.status === 404)) {
      throw new Error(`Azure ${options.method ?? 'GET'} ${parsed.pathname} failed: HTTP ${response.status}; inspect Azure diagnostics`);
    }
    return response;
  };
}
