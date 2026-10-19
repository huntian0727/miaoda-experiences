'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const lib = require('../skills/miaoda-delivery/scripts/lib.cjs');
const {identity,compareIdentity} = require('../skills/miaoda-delivery/scripts/identity.cjs');
const {main,parse} = require('../skills/miaoda-delivery/scripts/miaoda.cjs');
const example = require('../skills/miaoda-delivery/examples/html-proxy-case.json');

function temporary(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),'miaoda-skill-test-'));
  t.after(()=>{
    assert.equal(path.dirname(dir),fs.realpathSync(os.tmpdir()));
    assert.ok(path.basename(dir).startsWith('miaoda-skill-test-'));
    fs.rmSync(dir,{recursive:true,force:true});
  });
  return dir;
}
function gitFixture(t) {
  const root=temporary(t), project=path.join(root,'project'), remote=path.join(root,'remote.git');
  fs.mkdirSync(project);
  const git=(...args)=>lib.command('git',args,{cwd:project});
  lib.command('git',['init','--bare','--initial-branch=main',remote]);
  git('init','--initial-branch=main'); git('config','user.name','Skill Test'); git('config','user.email','skill-test@example.invalid');
  git('remote','add','origin',remote);
  fs.writeFileSync(path.join(project,'app.txt'),'initial\n');
  git('add','app.txt');git('commit','-m','initial');git('push','-u','origin','main');
  const clone=path.join(root,'other');
  lib.command('git',['clone',remote,clone]);
  const other=(...args)=>lib.command('git',args,{cwd:clone});
  other('config','user.name','Skill Test');other('config','user.email','skill-test@example.invalid');
  const remoteCommit=()=>{fs.writeFileSync(path.join(clone,'remote.txt'),'remote\n');other('add','remote.txt');other('commit','-m','remote');other('push','origin','main');return other('rev-parse','HEAD');};
  return {project,remote,git,other,remoteCommit,context:lib.gitContext(project,'main',remote)};
}

test('CLI distinguishes cloud sync from local operations and rejects unrelated flags',()=>{
  assert.throws(()=>main(['cloud-sync']),{code:'manual_adapter_required'});
  assert.throws(()=>parse(['experience-search','--query','safe','--execute']),{code:'invalid_argument'});
  assert.throws(()=>parse(['fetch','--execute','--execute']),{code:'invalid_argument'});
  assert.throws(()=>parse(['fetch','--project']),{code:'invalid_argument'});
  assert.equal(main(['help']).version,'0.2.1');
});
test('preparation redacts nested credentials, contacts and paths, then becomes idempotent',t=>{
  const dir=temporary(t);
  const input=structuredClone(example);
  input.actual='APP_SECRET=mock-value Authorization: Bearer fake-bearer-value https://preview.invalid/path?access_token=mock-query&state=mock-state person@example.invalid';
  input.attempts[0].result='github_pat_'+'A'.repeat(35);
  input.evidence=['C:\\Users\\Example\\project\\.env.local','/home/example/runtime/.env'];
  const result=lib.prepareRecord(input,dir);
  assert.ok(result.redactions>=7);
  assert.equal(lib.redact(result.record).count,0);
  const text=fs.readFileSync(result.filename,'utf8');
  for(const fragment of ['mock-value','fake-bearer-value','mock-query','mock-state','person@example.invalid','A'.repeat(35),'Users\\\\Example']) assert.ok(!text.includes(fragment));
  assert.match(lib.issueBody(result.record),/experience-fingerprint:/);
  assert.equal(lib.jsonFile(result.filename).title,example.title);
});
test('record contract rejects unknown fields, oversize and invalid shapes',()=>{
  assert.throws(()=>lib.validateRecord({...example,env:{SECRET:'mock'}},false),{code:'invalid_record'});
  assert.throws(()=>lib.validateRecord({...example,title:'x'.repeat(121)},false),{code:'invalid_record'});
  assert.throws(()=>lib.validateRecord({...example,attempts:[{action:'x',result:'x',command:'extra'}]},false),{code:'invalid_record'});
  assert.throws(()=>lib.validateRecord({...example,verification:{state:'globally-approved',details:'x'}},false),{code:'invalid_record'});
});
test('dry-run and missing review never contact GitHub; failed upload preserves queue',t=>{
  const prepared=lib.prepareRecord(example,temporary(t));
  let calls=0;
  const noNetwork=()=>{calls++;throw Error('network');};
  assert.equal(lib.uploadRecord(prepared.record,{exec:noNetwork}).status,'dry_run');
  assert.throws(()=>lib.uploadRecord(prepared.record,{execute:true,exec:noNetwork}),{code:'review_required'});
  assert.equal(calls,0);
  assert.throws(()=>lib.uploadRecord(prepared.record,{execute:true,reviewed:true,exec:noNetwork}));
  assert.equal(calls,1);
  assert.ok(fs.existsSync(prepared.filename));
});
test('channel pins public destination and marks unreviewed skill submissions; duplicates do not write',t=>{
  const prepared=lib.prepareRecord(example,temporary(t));
  const calls=[];
  function exec(bin,args,options){
    calls.push({bin,args,input:options.input});
    assert.equal(bin,'gh');assert.ok(args.includes('github.com'));
    const endpoint=args[args.indexOf('--method')+2];
    if(endpoint===`repos/${lib.channel.repository}`) return JSON.stringify({private:false,visibility:'public',full_name:lib.channel.repository,has_issues:true,permissions:{push:true}});
    if(endpoint.includes('issues?')) return '[]';
    return JSON.stringify({number:1,html_url:'https://github.com/'+lib.channel.repository+'/issues/1'});
  }
  assert.equal(lib.uploadRecord(prepared.record,{execute:true,reviewed:true,exec}).status,'created');
  const payload=JSON.parse(calls.at(-1).input);
  assert.deepEqual(payload.labels,['experience','unreviewed','source:skill']);
  assert.match(payload.title,/^\[skill\]\[technique\]/);
  assert.ok(payload.body.startsWith(lib.SKILL_MARKER+'\n'));
  assert.ok(calls.every(item=>!item.args.some(arg=>/mock-token/.test(arg))));
  const duplicateExec=(bin,args,options)=>args.some(arg=>arg.includes('issues?'))
    ? JSON.stringify([{number:5,html_url:'https://github.com/'+lib.channel.repository+'/issues/5',body:lib.issueBody(prepared.record)}])
    : exec(bin,args,options);
  const before=calls.length;
  assert.equal(lib.uploadRecord(prepared.record,{execute:true,reviewed:true,exec:duplicateExec}).status,'duplicate');
  assert.equal(calls.length,before+1);
  assert.throws(()=>lib.uploadRecord(prepared.record,{execute:true,reviewed:true,exec:()=>JSON.stringify({private:true,visibility:'private',full_name:lib.channel.repository,has_issues:true})}),{code:'channel_access_denied'});
});
test('dedupe ignores identity/time while distinguishing changed resolution',t=>{
  const dir=temporary(t),a=lib.prepareRecord(example,dir).record,b=lib.prepareRecord(example,dir).record;
  assert.notEqual(a.id,b.id);assert.equal(lib.fingerprint(a),lib.fingerprint(b));
  b.resolution+=' Different fix.';assert.notEqual(lib.fingerprint(a),lib.fingerprint(b));
});
test('ordinary GitHub login remains intact and old skill-specific credential variables are unused',()=>{
  const env={MIAODA_EXPERIENCE_GITHUB_TOKEN:'mock-only-test',GH_TOKEN:'broad-test-value',GH_DEBUG:'api'};
  const child=lib.ghEnvironment(env);
  assert.equal(child.GH_TOKEN,'broad-test-value');assert.ok(!Object.hasOwn(child,'MIAODA_EXPERIENCE_GITHUB_TOKEN'));
  assert.ok(!Object.hasOwn(child,'GH_DEBUG'));assert.equal(env.GH_TOKEN,'broad-test-value');
});
test('outside contributor creates an identifiable skill Issue without label permissions',t=>{
  const prepared=lib.prepareRecord(example,temporary(t));
  let payload;
  const exec=(_bin,args,options)=>{
    const endpoint=args[args.indexOf('--method')+2];
    if(endpoint===`repos/${lib.channel.repository}`)return JSON.stringify({private:false,visibility:'public',full_name:lib.channel.repository,has_issues:true,permissions:{push:false}});
    if(endpoint.includes('issues?'))return '[]';
    payload=JSON.parse(options.input);return JSON.stringify({number:2,html_url:'https://github.com/'+lib.channel.repository+'/issues/2'});
  };
  const result=lib.uploadRecord(prepared.record,{execute:true,reviewed:true,exec});
  assert.equal(result.labelsRequested,false);assert.ok(!Object.hasOwn(payload,'labels'));
  const summary=lib.summarizeIssue({number:2,title:payload.title,body:payload.body,labels:[],user:{login:'outside-user'}});
  assert.equal(summary.submissionSource,'skill');assert.equal(summary.skillVersion,'0.2.1');
  assert.equal(summary.author,'outside-user');assert.equal(summary.sourceVerified,false);
});
test('source filtering uses body provenance even without labels, and never authenticates claims',t=>{
  const prepared=lib.prepareRecord(example,temporary(t)).record;
  assert.deepEqual(prepared.provenance,{source:'miaoda-delivery',method:'skill-cli',markerVersion:1});
  const skill={number:1,body:lib.issueBody(prepared),labels:[]};
  const manual={number:2,body:'Manual note mentions '+lib.SKILL_MARKER,labels:[{name:'source:skill'}]};
  assert.deepEqual(lib.filterSource([skill,manual],'skill'),[skill]);
  assert.deepEqual(lib.filterSource([skill,manual],'manual'),[manual]);
  assert.deepEqual(lib.filterSource([skill,manual]),[skill,manual]);
  assert.equal(lib.summarizeIssue(manual).sourceVerified,false);
  assert.throws(()=>lib.filterSource([],'verified'),{code:'invalid_source'});
  assert.throws(()=>lib.validateRecord({...prepared,provenance:{source:'other',method:'skill-cli',markerVersion:1}}),{code:'invalid_record'});
});
test('search pins the public repository and filters source metadata without requiring labels',t=>{
  const prepared=lib.prepareRecord(example,temporary(t)).record;
  const calls=[];
  const exec=(_bin,args)=>{
    const endpoint=args[args.indexOf('--method')+2];calls.push(endpoint);
    if(endpoint===`repos/${lib.channel.repository}`)return JSON.stringify({private:false,visibility:'public',full_name:lib.channel.repository,has_issues:true});
    return JSON.stringify({total_count:2,items:[{number:1,body:lib.issueBody(prepared),labels:[]},{number:2,body:'manual',labels:[]}]});
  };
  const result=lib.searchExperience('HTML',exec,'skill');
  assert.equal(result.items.length,1);assert.equal(result.items[0].submissionSource,'skill');
  assert.equal(result.totalBeforeLocalFilter,2);
  const query=new URL('https://api.github.com/'+calls.at(-1)).searchParams.get('q');
  assert.ok(query.includes('repo:'+lib.channel.repository));assert.ok(query.includes('miaoda-skill-generated-v1'));
});
test('upload rejects a record containing an unprepared credential pattern',t=>{
  const prepared=lib.prepareRecord(example,temporary(t)).record;
  prepared.actual='APP_SECRET=mock-only-test';
  assert.throws(()=>lib.uploadRecord(prepared),{code:'review_required'});
});
test('clean project dry-run leaves refs unchanged and wrong identities fail',t=>{
  const f=gitFixture(t),before=f.git('rev-parse','HEAD');
  assert.equal(lib.gitState(f.context).dirty,false);
  assert.equal(lib.gitState(f.context).freshRemote,false);
  assert.equal(lib.gitAction(f.context,'git-upload').status,'dry_run');
  assert.equal(f.git('rev-parse','HEAD'),before);
  assert.throws(()=>lib.gitContext(f.project,'other',f.remote),{code:'wrong_branch'});
  assert.throws(()=>lib.gitContext(f.project,'main','https://example.invalid/wrong.git'),{code:'wrong_remote'});
  assert.throws(()=>lib.normalizedRemote('https://user:mock@example.invalid/repo'),{code:'credential_in_remote'});
});
test('unknown untracked files and existing operation lock block writes',t=>{
  const f=gitFixture(t),local=path.join(f.project,'unknown.txt');
  fs.writeFileSync(local,'preserve this');
  assert.throws(()=>lib.gitAction(f.context,'local-pull',true),{code:'worktree_not_clean'});
  assert.equal(fs.readFileSync(local,'utf8'),'preserve this');
  fs.unlinkSync(local);
  const lock=path.join(f.project,'.git','miaoda-delivery.lock');fs.writeFileSync(lock,'existing');
  assert.throws(()=>lib.gitAction(f.context,'fetch',true),{code:'project_busy'});
  assert.equal(fs.readFileSync(lock,'utf8'),'existing');
});
test('real local fast-forward preserves files and never claims cloud sync',t=>{
  const f=gitFixture(t),target=f.remoteCommit();
  const result=lib.gitAction(f.context,'local-pull',true);
  assert.equal(result.commit,target);assert.equal(result.cloudSynced,false);
  assert.equal(fs.readFileSync(path.join(f.project,'app.txt'),'utf8'),'initial\n');
  assert.equal(fs.readFileSync(path.join(f.project,'remote.txt'),'utf8').replace(/\r\n/g,'\n'),'remote\n');
  assert.ok(!fs.existsSync(path.join(f.project,'.git','miaoda-delivery.lock')));
});
test('real divergence blocks push and local-pull without overwriting either history',t=>{
  const f=gitFixture(t),remoteHead=f.remoteCommit();
  fs.writeFileSync(path.join(f.project,'local.txt'),'local\n');f.git('add','local.txt');f.git('commit','-m','local');
  const localHead=f.git('rev-parse','HEAD');
  assert.throws(()=>lib.gitAction(f.context,'git-upload',true),{code:'diverged'});
  assert.throws(()=>lib.gitAction(f.context,'local-pull',true),{code:'diverged'});
  assert.equal(f.git('rev-parse','HEAD'),localHead);
  assert.equal(f.other('rev-parse','HEAD'),remoteHead);
  assert.equal(f.git('ls-remote','origin','refs/heads/main').split(/\s/)[0],remoteHead);
  assert.equal(fs.readFileSync(path.join(f.project,'local.txt'),'utf8'),'local\n');
  assert.ok(!fs.existsSync(path.join(f.project,'.git','miaoda-delivery.lock')));
});
test('real push uploads a reviewed clean commit to expected remote',t=>{
  const f=gitFixture(t);
  fs.writeFileSync(path.join(f.project,'feature.txt'),'feature\n');f.git('add','feature.txt');f.git('commit','-m','feature');
  const result=lib.gitAction(f.context,'git-upload',true);
  assert.equal(result.cloudSynced,false);
  assert.equal(f.git('ls-remote','origin','refs/heads/main').split(/\s/)[0],result.commit);
});
test('identity follows source, normalizes CRLF and excludes runtime config; never implies page acceptance',t=>{
  const root=temporary(t);
  for(const dir of ['client/src','server','shared','.spark','.git/refs/heads'])fs.mkdirSync(path.join(root,dir),{recursive:true});
  fs.writeFileSync(path.join(root,'.spark/meta.json'),'{"app_id":"app_test"}');
  fs.writeFileSync(path.join(root,'client/src/preview-probe.json'),'{"id":"probe-a"}');
  fs.writeFileSync(path.join(root,'.git/HEAD'),'ref: refs/heads/main\n');
  fs.writeFileSync(path.join(root,'.git/refs/heads/main'),'a'.repeat(40)+'\n');
  const source=path.join(root,'server/feature.ts');fs.writeFileSync(source,'export const n=1;\r\n');
  const a=identity(root);fs.writeFileSync(source,'export const n=1;\n');
  assert.equal(identity(root).sourceHash,a.sourceHash);
  fs.writeFileSync(path.join(root,'.env.local'),'SECRET=mock-only-test');assert.equal(identity(root).sourceHash,a.sourceHash);
  assert.equal(compareIdentity(a,a).previewAccepted,false);
  fs.writeFileSync(source,'export const n=2;\n');assert.throws(()=>compareIdentity(a,identity(root)),{code:'identity_mismatch'});
  assert.throws(()=>compareIdentity(a,{...a,gitCommit:null}),{code:'identity_incomplete'});
});
