export function validateRuntimeConfig(value) {
  if (!value || typeof value !== 'object' || typeof value.apiBaseUrl !== 'string') {
    throw new Error('Runtime configuration must contain apiBaseUrl.');
  }
  const url = new URL(value.apiBaseUrl);
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) ||
      url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error('apiBaseUrl must be an HTTPS origin (HTTP is allowed only on localhost).');
  }
  return { apiBaseUrl: url.origin };
}
