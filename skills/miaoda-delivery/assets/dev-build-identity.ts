import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';

const ROUTE: string = '/__miaoda_dev_build_identity__';
const SOURCE_ROOTS: string[] = ['client/src', 'server', 'shared'];
const SOURCE_FILES: string[] = ['client/index.html', 'vite.config.ts', 'package.json', 'package-lock.json'];

export interface DevBuildIdentity {
  schemaVersion: 1;
  appId: string;
  probe: string;
  gitCommit: string | null;
  sourceHash: string;
  fileCount: number;
}

// Read only: no shell commands, environment dump, arbitrary paths or file writes.
export function readDevBuildIdentity(root: string): DevBuildIdentity {
  const paths: string[] = SOURCE_FILES.filter((file: string) => existsSync(join(root, file)));
  function walk(directory: string): void {
    if (!existsSync(directory)) return;
    for (const entry of readdirSync(directory, {withFileTypes: true})) {
      if (entry.name.startsWith('.') || ['node_modules', 'dist', 'logs', 'tmp'].includes(entry.name)) continue;
      const path: string = join(directory, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile() && /\.(?:ts|tsx|js|jsx|mjs|cjs|json|css|html)$/.test(entry.name)) {
        paths.push(relative(root, path).replace(/\\/g, '/'));
      }
      if (paths.length > 5000) throw new Error('identity_source_limit');
    }
  }
  SOURCE_ROOTS.forEach((directory: string) => walk(join(root, directory)));
  const hash = createHash('sha256');
  let total: number = 0;
  for (const path of paths.sort()) {
    const bytes: Buffer = Buffer.from(readFileSync(join(root, path), 'utf8').replace(/\r\n/g, '\n'), 'utf8');
    total += bytes.length;
    if (total > 30 * 1024 * 1024) throw new Error('identity_source_limit');
    hash.update(path + '\0' + bytes.length + '\0'); hash.update(bytes);
  }
  const meta: unknown = JSON.parse(readFileSync(join(root, '.spark/meta.json'), 'utf8'));
  const probe: unknown = JSON.parse(readFileSync(join(root, 'client/src/preview-probe.json'), 'utf8'));
  return {schemaVersion: 1,
    appId: meta && typeof meta === 'object' && 'app_id' in meta && typeof meta.app_id === 'string' ? meta.app_id : '',
    probe: probe && typeof probe === 'object' && 'id' in probe && typeof probe.id === 'string' ? probe.id : '',
    gitCommit: readCommit(root), sourceHash: hash.digest('hex'), fileCount: paths.length};
}

function readCommit(root: string): string | null {
  try {
    const git: string = join(root, '.git');
    if (!statSync(git).isDirectory()) return null;
    const head: string = readFileSync(join(git, 'HEAD'), 'utf8').trim();
    if (/^[a-f0-9]{40}$/.test(head)) return head;
    const ref: string = head.replace(/^ref: /, '');
    if (!/^refs\/(?:heads|remotes)\/[A-Za-z0-9._/-]+$/.test(ref) || ref.includes('..')) return null;
    if (existsSync(join(git, ref))) {
      const value: string = readFileSync(join(git, ref), 'utf8').trim();
      return /^[a-f0-9]{40}$/.test(value) ? value : null;
    }
    if (!existsSync(join(git, 'packed-refs'))) return null;
    const line: string | undefined = readFileSync(join(git, 'packed-refs'), 'utf8').split('\n')
      .find((value: string) => value.endsWith(' ' + ref));
    return line && /^[a-f0-9]{40} /.test(line) ? line.slice(0, 40) : null;
  } catch { return null; }
}

interface IdentityDevServer {
  middlewares: {use(handler: (request: IncomingMessage, response: ServerResponse, next: () => void) => void): void};
}

export function devBuildIdentityPlugin(root: string) {
  return {name: 'auth-hub-dev-build-identity', enforce: 'pre' as const,
    apply: (_config: unknown, environment: {command: string; mode: string}): boolean =>
      environment.command === 'serve' && environment.mode !== 'production',
    configureServer(server: IdentityDevServer): void {
      const startedAt: string = new Date().toISOString();
      server.middlewares.use((request, response, next) => {
        const path: string = (request.url ?? '').split('?')[0];
        if (path !== ROUTE && !/^\/app\/app_[A-Za-z0-9]+\/__miaoda_dev_build_identity__$/.test(path)) {
          next(); return;
        }
        response.setHeader('Cache-Control', 'no-store');
        response.setHeader('Content-Type', 'application/json; charset=utf-8');
        if (request.method !== 'GET') {response.statusCode = 405; response.end('{"error":"method_not_allowed"}'); return;}
        try { response.end(JSON.stringify({...readDevBuildIdentity(root), startedAt})); }
        catch {response.statusCode = 503; response.end('{"error":"identity_unavailable"}');}
      });
    }};
}
