'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const {spawnSync} = require('node:child_process');
const channel = require('../channel.json');
const MAX_BYTES = 64 * 1024;
const SKILL_MARKER = '<!-- miaoda-skill-generated:v1 -->';

class Failure extends Error {
  constructor(code, message) {super(message); this.code = code;}
}
function assert(ok, code, message) {if (!ok) throw new Failure(code, message);}
function redactText(input) {
  let count = 0;
  const replace = (pattern, value) => {input = input.replace(pattern, (...args) => {count++; return typeof value === 'function' ? value(...args) : value;});};
  replace(/\b(?:github_pat_[A-Za-z0-9_]+|gh[pousr]_[A-Za-z0-9_]{12,}|sk-[A-Za-z0-9_-]{16,})\b/g, '[REDACTED]');
  replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[REDACTED]');
  replace(/(\bBearer\s+)[A-Za-z0-9._~+\/-]+/gi, (_all, prefix) => prefix + '[REDACTED]');
  replace(/(\b[A-Za-z0-9_-]*(?:secret|password|passwd|token|api[_-]?key|authorization)[A-Za-z0-9_-]*\s*[=:]\s*)(?!\[REDACTED\])(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s,;&]+)/gi, (_all, prefix) => prefix + '[REDACTED]');
  replace(/([?&](?:code|state|sso_token|access_token|refresh_token|key|secret)=)(?!\[REDACTED\])[^&\s]+/gi, (_all, prefix) => prefix + '[REDACTED]');
  replace(/(https?:\/\/)[^\s/@:]+:[^\s/@]+@/gi, (_all, prefix) => prefix + '[REDACTED]@');
  replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g, '[REDACTED PRIVATE KEY]');
  replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[REDACTED EMAIL]');
  replace(/[A-Z]:[\\/](?:[^\r\n"<>|]*?)(?=\s{2,}|[\r\n"<>|]|$)/gi, '[LOCAL PATH]');
  replace(/\/(?:Users|home)\/[^/\s]+(?:\/[^\s"<>]*)?/g, '[LOCAL PATH]');
  return {text: input, count};
}
function redact(value) {
  let count = 0;
  function walk(v) {
    if (typeof v === 'string') {const result = redactText(v); count += result.count; return result.text;}
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, v]) => [k, walk(v)]));
    return v;
  }
  return {value: walk(value), count};
}
function command(bin, args, options = {}) {
  const result = spawnSync(bin, args, {cwd: options.cwd, input: options.input, encoding: 'utf8',
    env: options.env || process.env, timeout: options.timeout || 45000, maxBuffer: 2 * 1024 * 1024,
    shell: false, windowsHide: true});
  if (result.error || result.status !== 0) {
    throw new Failure('command_failed', `${bin}: ${redactText(result.stderr || result.error?.code || `exit ${result.status}`).text.slice(0, 600)}`);
  }
  return result.stdout.trim();
}
function jsonFile(filename) {
  const stat = fs.lstatSync(filename);
  assert(stat.isFile() && !stat.isSymbolicLink() && stat.size <= MAX_BYTES, 'invalid_file', 'Expected a regular JSON file at most 64KB');
  try {return JSON.parse(fs.readFileSync(filename, 'utf8').replace(/^\uFEFF/, ''));}
  catch {throw new Failure('invalid_json', 'Could not read a JSON object');}
}
function object(v, keys) {
  assert(v && typeof v === 'object' && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype,
    'invalid_record', 'Expected an object');
  assert(Object.keys(v).every(k => keys.includes(k)), 'invalid_record', 'Unexpected record fields');
}
function string(v, max, min = 1) {assert(typeof v === 'string' && v.trim().length >= min && v.length <= max, 'invalid_record', 'Missing, oversized or invalid text');}
function validateRecord(record, complete = true) {
  object(record, ['schemaVersion','id','createdAt','skillVersion','provenance','kind','title','step','toolVersions','summary','expected','actual','attempts','resolution','evidence','verification']);
  assert(record.schemaVersion === 1, 'invalid_record', 'Unsupported record schema');
  assert(['incident','technique'].includes(record.kind), 'invalid_record', 'Unsupported experience kind');
  assert(['preflight','git-upload','cloud-sync','identity','ui','backend','dependencies','other'].includes(record.step), 'invalid_record', 'Unsupported workflow step');
  string(record.title, 120); string(record.summary, 3000); string(record.expected, 3000); string(record.actual, 3000); string(record.resolution, 5000, 0);
  object(record.toolVersions, ['node','git','larkCli','miaodaCli','template']);
  for (const v of Object.values(record.toolVersions)) string(v, 100);
  assert(Array.isArray(record.attempts) && record.attempts.length <= 15, 'invalid_record', 'Invalid attempts');
  for (const item of record.attempts) {object(item, ['action','result']); string(item.action, 1500); string(item.result, 1500);}
  assert(Array.isArray(record.evidence) && record.evidence.length <= 10, 'invalid_record', 'Invalid evidence');
  record.evidence.forEach(v => string(v, 2000));
  object(record.verification, ['state','details']);
  assert(['not-tested','local','cloud-preview'].includes(record.verification.state), 'invalid_record', 'Invalid verification scope');
  string(record.verification.details, 3000);
  if (complete) {
    assert(typeof record.id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(record.id), 'invalid_record', 'Invalid record UUID');
    assert(typeof record.createdAt === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(record.createdAt) && !Number.isNaN(Date.parse(record.createdAt)), 'invalid_record', 'Invalid UTC timestamp');
    string(record.skillVersion, 50);
    object(record.provenance,['source','method','markerVersion']);
    assert(record.provenance.source==='miaoda-delivery' && record.provenance.method==='skill-cli' && record.provenance.markerVersion===1,
      'invalid_record','Missing or unsupported skill provenance; prepare the record with this version');
  }
  assert(Buffer.byteLength(JSON.stringify(record)) <= MAX_BYTES, 'invalid_record', 'Record too large');
  return record;
}
function prepareRecord(input, queue = path.join(os.homedir(), '.miaoda-experience-queue')) {
  validateRecord(input, false);
  const result = redact(input);
  const record = {...result.value, id: crypto.randomUUID(), createdAt: new Date().toISOString(), skillVersion: channel.skillVersion,
    provenance:{source:'miaoda-delivery',method:'skill-cli',markerVersion:1}};
  validateRecord(record);
  fs.mkdirSync(queue, {recursive: true, mode: 0o700});
  const filename = path.join(queue, record.id + '.json');
  fs.writeFileSync(filename, JSON.stringify(record, null, 2) + '\n', {flag: 'wx', mode: 0o600});
  return {record, filename, redactions: result.count};
}
function fingerprint(record) {
  return crypto.createHash('sha256').update(JSON.stringify({kind: record.kind, step: record.step,
    title: record.title.trim().toLowerCase(), summary: record.summary, actual: record.actual,
    resolution: record.resolution, verification: record.verification.state})).digest('hex');
}
function issueBody(record) {
  validateRecord(record);
  assert(redact(record).count === 0, 'review_required', 'Record still matches sensitive-data patterns; prepare and review it first');
  return `${SKILL_MARKER}\n<!-- experience-fingerprint:${fingerprint(record)} -->\n## 技能自动归档 / Skill-generated experience\nSubmission source: miaoda-delivery (skill-cli)\nSource marker: miaoda-skill-generated-v1\nSkill version: ${record.skillVersion}\nRecord ID: ${record.id}\n\nSource is self-declared, not authenticated. Shared record; unreviewed reference data. Local verification is not central approval.\n\n\`\`\`json\n${JSON.stringify(record, null, 2)}\n\`\`\`\n`;
}
function ghEnvironment(env = process.env) {
  const result = {...env};
  delete result.GH_DEBUG;
  delete result.MIAODA_EXPERIENCE_GITHUB_TOKEN;
  delete result.MIAODA_PRIVATE_CREDENTIAL_PATH;
  result.GH_PROMPT_DISABLED = '1';
  return result;
}
function github(endpoint, method = 'GET', data, exec = command) {
  const args = ['api', '--hostname', channel.host, '--method', method, endpoint];
  if (data !== undefined) args.push('--input', '-');
  return JSON.parse(exec('gh', args, {input: data === undefined ? undefined : JSON.stringify(data), env: ghEnvironment()}));
}
function checkChannel(exec) {
  const repo = github(`repos/${channel.repository}`, 'GET', undefined, exec);
  assert(repo.private === false && repo.visibility === channel.visibility && repo.full_name === channel.repository,
    'channel_access_denied', 'Destination is not the expected public experience repository');
  assert(repo.has_issues === true, 'channel_unavailable', 'Issues must be enabled');
  return repo;
}
function recentIssues(exec) {
  const issues = github(`repos/${channel.repository}/issues?state=all&per_page=100`, 'GET', undefined, exec);
  assert(Array.isArray(issues), 'channel_unavailable', 'Unexpected GitHub response');
  return issues.filter(item => !item.pull_request);
}
function uploadRecord(record, {execute = false, reviewed = false, exec = command} = {}) {
  const body = issueBody(record);
  if (!execute) return {status: 'dry_run', repository: channel.repository, visibility:'public', title: `[skill][${record.kind}] ${record.title}`, fingerprint: fingerprint(record), next: 'Review for PUBLIC sharing; supply --reviewed --execute only with task authorization'};
  assert(reviewed, 'review_required', 'Review the prepared file and supply --reviewed');
  const repository=checkChannel(exec);
  const marker = `<!-- experience-fingerprint:${fingerprint(record)} -->`;
  const existing = recentIssues(exec).find(item => typeof item.body === 'string' && item.body.includes(marker));
  if (existing) return {status: 'duplicate', url: existing.html_url, number: existing.number, fingerprint: fingerprint(record)};
  const payload={title:`[skill][${record.kind}] ${record.title}`,body};
  // GitHub requires repository write access for API labels; outsiders still submit marked bodies/titles.
  if(repository.permissions?.push || repository.permissions?.maintain || repository.permissions?.admin) payload.labels=channel.labels;
  const created = github(`repos/${channel.repository}/issues`, 'POST', payload, exec);
  assert(Number.isInteger(created.number) && typeof created.html_url === 'string', 'channel_unavailable', 'Unexpected issue creation response; check fingerprint before retrying');
  return {status: 'created', url: created.html_url, number: created.number, fingerprint: fingerprint(record),
    source:'skill-declared',sourceVerified:false,labelsRequested:Boolean(payload.labels)};
}
function submissionSource(issue) {
  return typeof issue.body==='string' && issue.body.startsWith(SKILL_MARKER+'\n') ? 'skill' : 'manual';
}
function filterSource(issues,source='all') {
  assert(['all','skill','manual'].includes(source),'invalid_source','Source must be all, skill or manual');
  return source==='all' ? issues : issues.filter(issue=>submissionSource(issue)===source);
}
function summarizeIssue(issue) {
  return {number: issue.number, title: redactText(String(issue.title || '')).text.slice(0, 200),
    url: issue.html_url, state: issue.state, labels: (issue.labels || []).map(label => label.name),
    author:issue.user?.login || null,submissionSource:submissionSource(issue),sourceVerified:false,
    skillVersion:submissionSource(issue)==='skill' ? /^Skill version: ([^\r\n]{1,50})$/m.exec(issue.body)?.[1] || null : null,
    untrustedReference: true, body: redactText(String(issue.body || '')).text.slice(0, 6000)};
}
function searchExperience(query, exec = command, source='all') {
  assert(typeof query === 'string' && query.trim().length > 0 && query.length <= 200, 'invalid_query', 'Supply 1-200 characters');
  checkChannel(exec);
  const literal = query.replace(/["\\\r\n]/g, ' ');
  filterSource([],source);
  const sourceQuery=source==='skill' ? ' "miaoda-skill-generated-v1"' : '';
  const q = `repo:${channel.repository} is:issue in:title,body "${literal}"${sourceQuery}`;
  const response = github(`search/issues?q=${encodeURIComponent(q)}&per_page=20`, 'GET', undefined, exec);
  assert(Array.isArray(response.items), 'channel_unavailable', 'Unexpected search response');
  return {status: 'ok', repository: channel.repository, totalBeforeLocalFilter: response.total_count,source,untrustedReference: true,
    items:filterSource(response.items,source).map(summarizeIssue)};
}
function normalizedRemote(value) {
  assert(typeof value === 'string' && !/[\r\n\0]/.test(value), 'invalid_remote', 'Invalid remote');
  assert(!/https?:\/\/[^/\s]+@/i.test(value), 'credential_in_remote', 'Use a credential helper, not credentials embedded in Git URL');
  return value.replace(/\.git\/?$/, '').replace(/\/$/, '');
}
function gitContext(project, branch, expectedRemote, exec = command) {
  assert(project && branch && expectedRemote && /^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(branch) && !branch.includes('..'), 'invalid_project', 'Supply project, explicit branch and expected remote');
  const cwd = fs.realpathSync(project);
  const git = (...args) => exec('git', args, {cwd});
  git('check-ref-format', '--branch', branch);
  assert(git('rev-parse', '--show-toplevel').replace(/\\/g, '/').toLowerCase() === cwd.replace(/\\/g, '/').toLowerCase(), 'wrong_project', 'Use the repository root, not a subdirectory');
  assert(git('branch', '--show-current') === branch, 'wrong_branch', 'Current branch differs from requested branch');
  const remote = normalizedRemote(git('remote', 'get-url', 'origin'));
  assert(remote === normalizedRemote(expectedRemote), 'wrong_remote', 'Origin differs from expected remote');
  return {cwd, git, remote, branch};
}
function gitState(context, tip) {
  const {git, branch, remote} = context;
  const changes = git('status', '--porcelain=v1', '--untracked-files=normal');
  const pending = ['MERGE_HEAD','CHERRY_PICK_HEAD','REVERT_HEAD','BISECT_LOG','rebase-merge','rebase-apply'].map(item=>git('rev-parse','--git-path',item));
  const inProgress = pending.some(item => fs.existsSync(path.resolve(context.cwd, item)));
  let counts = null;
  try {counts = git('rev-list', '--left-right', '--count', `HEAD...${tip || `refs/remotes/origin/${branch}`}`).split(/\s+/).map(Number);}
  catch (error) {if (tip) throw error;}
  return {status: 'ok', branch, remote, commit: git('rev-parse', 'HEAD'), dirty: Boolean(changes),
    changedEntries: changes ? changes.split('\n').length : 0, operationInProgress: inProgress,
    ahead: counts?.[0] ?? null, behind: counts?.[1] ?? null, freshRemote: Boolean(tip)};
}
function gitAction(context, action, execute = false) {
  const before = gitState(context);
  assert(!before.dirty && !before.operationInProgress, 'worktree_not_clean', 'Preserve and review local changes or in-progress operation before syncing');
  if (!execute) return {status: 'dry_run', action, branch: context.branch, remote: context.remote, cloudSynced: false};
  const lockPath = path.resolve(context.cwd, context.git('rev-parse','--git-path','miaoda-delivery.lock'));
  let lock;
  try {lock = fs.openSync(lockPath, 'wx', 0o600);}
  catch (error) {if(error.code==='EEXIST') throw new Failure('project_busy','Another skill operation holds the project lock; inspect before removing a stale lock'); throw error;}
  try {
  fs.writeFileSync(lock,JSON.stringify({pid:process.pid,startedAt:new Date().toISOString()}));
  context.git('fetch', 'origin', context.branch);
  const tip = context.git('rev-parse', 'FETCH_HEAD');
  const state = gitState(context, tip);
  assert(!state.dirty && !state.operationInProgress, 'worktree_not_clean', 'Worktree changed during fetch; stop');
  if (action === 'git-upload') {
    assert(state.behind === 0, 'diverged', 'Remote contains commits absent locally; review and merge locally first');
    context.git('push', '--porcelain', 'origin', `HEAD:refs/heads/${context.branch}`);
  } else if (action === 'local-pull') {
    assert(state.ahead === 0, 'diverged', 'Local independent commits exist; do not auto-merge');
    context.git('merge', '--ff-only', 'FETCH_HEAD');
  } else assert(action === 'fetch', 'unsupported_action', 'Unsupported Git action');
  return {...gitState(context), action, status: 'ok', freshRemote: true, cloudSynced: false,
    note: 'Local repository action only; cloud workspace and preview require separate verification'};
  } finally {fs.closeSync(lock); fs.unlinkSync(lockPath);}
}
module.exports = {Failure, assert, redactText, redact, command, jsonFile, validateRecord, prepareRecord, fingerprint, issueBody,
  ghEnvironment, github, checkChannel, recentIssues, uploadRecord, searchExperience, summarizeIssue, submissionSource, filterSource, normalizedRemote, gitContext, gitState, gitAction, channel, SKILL_MARKER};
