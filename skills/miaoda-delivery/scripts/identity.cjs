'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {assert} = require('./lib.cjs');
function readCommit(root) {
  try {
    const directory = path.join(root, '.git');
    if (!fs.statSync(directory).isDirectory()) return null;
    const head = fs.readFileSync(path.join(directory, 'HEAD'), 'utf8').trim();
    if (/^[a-f0-9]{40}$/.test(head)) return head;
    const ref = head.replace(/^ref: /, '');
    if (!/^refs\/(?:heads|remotes)\/[A-Za-z0-9._/-]+$/.test(ref) || ref.includes('..')) return null;
    if (fs.existsSync(path.join(directory, ref))) {
      const value = fs.readFileSync(path.join(directory, ref), 'utf8').trim();
      return /^[a-f0-9]{40}$/.test(value) ? value : null;
    }
    const line = fs.readFileSync(path.join(directory, 'packed-refs'), 'utf8').split('\n').find(value => value.endsWith(' ' + ref));
    return line && /^[a-f0-9]{40} /.test(line) ? line.slice(0, 40) : null;
  } catch {return null;}
}
function identity(root) {
  for (const item of ['client/src','server','shared','.spark/meta.json','client/src/preview-probe.json']) {
    assert(fs.existsSync(path.join(root, item)), 'unsupported_layout', 'Project does not match the tested source layout');
    assert(!fs.lstatSync(path.join(root, item)).isSymbolicLink(), 'unsupported_layout', 'Source roots must not be symbolic links');
  }
  const paths = ['client/index.html','vite.config.ts','package.json','package-lock.json'].filter(item => fs.existsSync(path.join(root, item)));
  function walk(directory) {
    for (const entry of fs.readdirSync(directory, {withFileTypes:true})) {
      if (entry.name.startsWith('.') || ['node_modules','dist','logs','tmp'].includes(entry.name) || entry.isSymbolicLink()) continue;
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(absolute);
      else if (entry.isFile() && /\.(?:ts|tsx|js|jsx|mjs|cjs|json|css|html)$/.test(entry.name)) paths.push(path.relative(root, absolute).replace(/\\/g, '/'));
      assert(paths.length <= 5000, 'source_limit', 'Source file limit reached');
    }
  }
  ['client/src','server','shared'].forEach(item => walk(path.join(root,item)));
  const hash = crypto.createHash('sha256');
  let total = 0;
  for (const item of paths.sort()) {
    assert(!fs.lstatSync(path.join(root,item)).isSymbolicLink(), 'unsupported_layout', 'Fixed source files must not be symbolic links');
    const bytes = Buffer.from(fs.readFileSync(path.join(root,item), 'utf8').replace(/\r\n/g, '\n'), 'utf8');
    total += bytes.length;
    assert(total <= 30 * 1024 * 1024, 'source_limit', 'Source size limit reached');
    hash.update(item + '\0' + bytes.length + '\0'); hash.update(bytes);
  }
  const meta = JSON.parse(fs.readFileSync(path.join(root,'.spark/meta.json'),'utf8'));
  const probe = JSON.parse(fs.readFileSync(path.join(root,'client/src/preview-probe.json'),'utf8'));
  assert(typeof meta.app_id === 'string' && typeof probe.id === 'string' && probe.id, 'unsupported_layout', 'Missing app identity or probe');
  return {schemaVersion:1, appId:meta.app_id, probe:probe.id, gitCommit:readCommit(root), sourceHash:hash.digest('hex'), fileCount:paths.length};
}
function compareIdentity(expected, actual) {
  for (const item of [expected,actual]) {
    assert(item && item.schemaVersion === 1 && typeof item.appId === 'string' && item.appId && typeof item.probe === 'string' && item.probe &&
      /^[a-f0-9]{40}$/.test(item.gitCommit || '') && /^[a-f0-9]{64}$/.test(item.sourceHash || '') && Number.isInteger(item.fileCount) && item.fileCount > 0,
    'identity_incomplete','Identity requires a real readable commit, source hash, app, probe and file count');
  }
  const mismatches = ['appId','probe','gitCommit','sourceHash','fileCount'].filter(key => expected[key] !== actual[key]);
  assert(!mismatches.length, 'identity_mismatch', 'Different identity fields: ' + mismatches.join(', '));
  return {status:'passed',scope:'source_identity_only',commit:actual.gitCommit,sourceHash:actual.sourceHash,
    previewAccepted:false,next:'Verify the browser module probe and required business behavior separately'};
}
module.exports = {identity,readCommit,compareIdentity};
