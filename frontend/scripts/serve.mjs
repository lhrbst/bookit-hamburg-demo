import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';

const directory = resolve(process.argv[2] ?? 'dist');
const port = Number(process.env.PORT ?? 5173);
const policy = JSON.parse(await readFile(resolve(directory, 'staticwebapp.config.json'), 'utf8'));
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.png': 'image/png' };

createServer(async (req, res) => {
  try {
    const path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    let file = resolve(directory, `.${path}`);
    if (!file.startsWith(`${directory}${sep}`) && file !== directory) {
      res.writeHead(403).end();
      return;
    }
    let exists = false;
    try { exists = (await stat(file)).isFile(); } catch (error) {
      if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') throw error;
    }
    if (!exists) {
      if (path.startsWith('/assets/') || extname(path)) {
        res.writeHead(404).end('Not found');
        return;
      }
      file = resolve(directory, 'index.html');
    }
    const headers = { ...policy.globalHeaders, 'Content-Type': types[extname(file)] ?? 'application/octet-stream' };
    for (const route of policy.routes ?? []) {
      if (route.route === path || (route.route.endsWith('*') && path.startsWith(route.route.slice(0, -1)))) {
        Object.assign(headers, route.headers);
      }
    }
    const content = await readFile(file);
    res.writeHead(200, headers).end(content);
  } catch (error) {
    console.error('Static artifact request failed', error);
    res.writeHead(500).end('Static artifact request failed');
  }
}).listen(port, '127.0.0.1', () => console.log(`Artifact server listening on http://localhost:${port}`));
