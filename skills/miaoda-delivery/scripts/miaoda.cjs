#!/usr/bin/env node
'use strict';
const lib = require('./lib.cjs');
const {identity,compareIdentity} = require('./identity.cjs');
const {ensureLarkCli}=require('./lark-update.cjs');
function parse(argv) {
  const command = argv.shift() || 'help';
  const options = {};
  const booleans = new Set(['execute','reviewed']);
  const values = new Set(['project','branch','expected-remote','input','queue','file','query','expected','actual','source']);
  while (argv.length) {
    const arg = argv.shift();
    lib.assert(arg.startsWith('--'), 'invalid_argument', 'Expected a named option');
    const key = arg.slice(2);
    lib.assert(!Object.hasOwn(options,key), 'invalid_argument', 'Duplicate option');
    lib.assert(booleans.has(key) || values.has(key), 'invalid_argument', 'Unsupported option');
    if (booleans.has(key)) options[key] = true;
    else {lib.assert(argv.length && !argv[0].startsWith('--'), 'invalid_argument','Missing option value'); options[key]=argv.shift();}
  }
  const allowed = {
    help:[], 'git-state':['project','branch','expected-remote'], fetch:['project','branch','expected-remote','execute'],
    'git-upload':['project','branch','expected-remote','execute'], 'local-pull':['project','branch','expected-remote','execute'],
    identity:['project'], 'verify-identity':['expected','actual'], 'cloud-sync':[],
    'experience-prepare':['input','queue'], 'experience-upload':['file','execute','reviewed'],
    'experience-search':['query','source'], 'experience-review':['source'], 'channel-check':[], 'ensure-lark-cli':['execute']
  };
  lib.assert(Object.hasOwn(allowed,command) && Object.keys(options).every(key=>allowed[command].includes(key)), 'invalid_argument','Unsupported command or command option');
  if(options.source) lib.filterSource([],options.source);
  return {command,options};
}
function required(options,key) {lib.assert(typeof options[key] === 'string' && options[key], 'invalid_argument','Required option: --'+key);return options[key];}
function main(argv) {
  const {command,options:o} = parse([...argv]);
  if(command==='help') return {status:'ok',version:lib.channel.skillVersion,repository:lib.channel.repository,
    commands:['git-state','fetch','git-upload','local-pull','identity','verify-identity','cloud-sync','experience-prepare','experience-upload','experience-search','experience-review','channel-check','ensure-lark-cli'],
    usage:{git:'--project PATH --branch NAME --expected-remote URL [--execute]',identity:'--project PATH',
      verify:'--expected local.json --actual cloud.json',prepare:'--input case.json [--queue DIR]',upload:'--file prepared.json [--reviewed --execute]',search:'--query TEXT [--source all|skill|manual]',review:'[--source all|skill|manual]'},
    cloudSync:'No CLI adapter verified. Native browser Git Pull requires separate authorization and verification.'};
  if (['git-state','fetch','git-upload','local-pull'].includes(command)) {
    const context = lib.gitContext(required(o,'project'),required(o,'branch'),required(o,'expected-remote'));
    return command==='git-state' ? lib.gitState(context) : lib.gitAction(context,command,!!o.execute);
  }
  if(command==='identity') return identity(required(o,'project'));
  if(command==='verify-identity') return compareIdentity(lib.jsonFile(required(o,'expected')),lib.jsonFile(required(o,'actual')));
  if(command==='cloud-sync') throw new lib.Failure('manual_adapter_required','Cloud workspace Pull is a separate native browser step; local push is not preview acceptance');
  if(command==='ensure-lark-cli')return ensureLarkCli({execute:!!o.execute});
  if(command==='experience-prepare') {
    const prepared = lib.prepareRecord(lib.jsonFile(required(o,'input')),o.queue);
    return {status:'prepared',file:prepared.filename,redactions:prepared.redactions,repository:lib.channel.repository,uploaded:false,next:'Review the local JSON before upload'};
  }
  if(command==='experience-upload') return lib.uploadRecord(lib.jsonFile(required(o,'file')),{execute:!!o.execute,reviewed:!!o.reviewed});
  if(command==='experience-search') return lib.searchExperience(required(o,'query'),undefined,o.source||'all');
  if(command==='channel-check') {
    lib.checkChannel(); lib.recentIssues();
    return {status:'ok',repository:lib.channel.repository,public:true,specialCredentialRequired:false,
      readsVerified:true,writeAuthentication:'ordinary_github_login',note:'Public archive; Issue submissions require normal GitHub authentication, not a skill-specific key'};
  }
  if(command==='experience-review') {
    lib.checkChannel();
    return {status:'ok',repository:lib.channel.repository,limit:100,source:o.source||'all',untrustedReference:true,
      items:lib.filterSource(lib.recentIssues(),o.source||'all').map(lib.summarizeIssue)};
  }
}
if (require.main===module) {
  try {process.stdout.write(JSON.stringify(main(process.argv.slice(2)),null,2)+'\n');}
  catch(error) {process.stdout.write(JSON.stringify({status:'failed',code:error.code||'unexpected_error',message:lib.redactText(error.message||'Unexpected failure').text})+'\n');process.exitCode=1;}
}
module.exports = {main,parse};
