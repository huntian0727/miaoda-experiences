'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {ensureLarkCli,compareVersions}=require('../skills/miaoda-delivery/scripts/lark-update.cjs');
const {installSkill,parse}=require('../skills/miaoda-delivery/scripts/install.cjs');
function output(value){return {status:0,stdout:JSON.stringify(value),stderr:''};}
function report(current,latest,inSync=true){return {ok:true,current_version:current,latest_version:latest,skills_status:{in_sync:inSync}};}
function runner({before='1.0.98',latest='1.0.98',inSync=true,after=latest,afterSync=true,updateFailure}={}) {
  let updated=false;const calls=[];
  const run=args=>{calls.push([...args]);if(args[0]==='--version')return {status:0,stdout:'lark-cli version '+(updated?after:before)};
    if(args.includes('--check'))return output(report(updated?after:before,latest,updated?afterSync:inSync));
    if(updateFailure)return updateFailure;
    updated=true;return output(report(after,latest,afterSync));};
  return {run,calls};
}
function fixture(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'miaoda-install-test-'));
  t.after(()=>{assert.equal(path.dirname(root),fs.realpathSync(os.tmpdir()));assert.ok(path.basename(root).startsWith('miaoda-install-test-'));fs.rmSync(root,{recursive:true,force:true});});
  const source=path.join(root,'source');fs.mkdirSync(source);fs.writeFileSync(path.join(source,'SKILL.md'),'---\nname: miaoda-delivery\ndescription: Test installation\n---\n');fs.writeFileSync(path.join(source,'channel.json'),'{"skillVersion":"0.3.0"}');fs.writeFileSync(path.join(source,'feature.cjs'),'new content');
  return {root,source,target:path.join(root,'skills')};}
const ready=()=>({status:'up_to_date',currentVersion:'1.0.98',latestVersion:'1.0.98',latestVerified:true,updated:false});

test('version comparison handles multi-digit patches, prerelease and newer local versions',()=>{
  assert.equal(compareVersions('1.0.100','1.0.99'),1);assert.equal(compareVersions('1.0.98','1.0.98-rc.2'),1);
  assert.equal(compareVersions('1.0.98-rc.10','1.0.98-rc.2'),1);assert.equal(compareVersions('v1.0.98+build','1.0.98'),0);
  assert.throws(()=>compareVersions('unknown','1.0.98'),{code:'invalid_cli_version'});
});
test('current CLI checks official source and avoids unnecessary updates',()=>{
  const r=runner();const result=ensureLarkCli({execute:true,run:r.run});
  assert.equal(result.status,'up_to_date');assert.equal(result.latestVerified,true);assert.equal(r.calls.length,2);
});
test('dry-run reports update without invoking updater',()=>{
  const r=runner({before:'1.0.9',latest:'1.0.98'});const result=ensureLarkCli({run:r.run});
  assert.equal(result.status,'update_required');assert.equal(result.latestVerified,false);assert.equal(r.calls.length,2);
});
test('outdated CLI updates once and rechecks actual executable and official source',()=>{
  const r=runner({before:'1.0.9',latest:'1.0.98'});const result=ensureLarkCli({execute:true,run:r.run});
  assert.equal(result.currentVersion,'1.0.98');assert.equal(result.cliVersionChanged,true);assert.equal(r.calls.length,5);
  assert.deepEqual(r.calls[2],['update','--json']);assert.ok(r.calls.every(args=>!args.includes('--force')&&!args.includes('--yes')));
});
test('same CLI version but stale official skills also invokes official updater',()=>{
  const r=runner({inSync:false});const result=ensureLarkCli({execute:true,run:r.run});
  assert.equal(result.status,'updated');assert.equal(result.cliVersionChanged,false);assert.equal(result.skillsInSync,true);
});
test('does not downgrade an executable newer than the configured update source',()=>{
  const r=runner({before:'1.1.0',latest:'1.0.98'});const result=ensureLarkCli({execute:true,run:r.run});
  assert.equal(result.status,'newer_than_update_source');assert.equal(r.calls.length,2);
});
test('missing CLI, network failure, malformed JSON and confirmation gates stop without leaking logs',()=>{
  assert.throws(()=>ensureLarkCli({run:()=>({error:{code:'ENOENT'},status:null})}),{code:'lark_cli_missing'});
  assert.throws(()=>ensureLarkCli({run:args=>args[0]==='--version'?{status:0,stdout:'lark-cli version 1.0.98'}:{status:1,stderr:'APP_SECRET=mock-private'}}),error=>error.code==='lark_cli_check_failed'&&!error.message.includes('mock-private'));
  assert.throws(()=>ensureLarkCli({run:args=>args[0]==='--version'?{status:0,stdout:'lark-cli version 1.0.98'}:{status:0,stdout:'not JSON'}}),{code:'invalid_update_response'});
  const r=runner({before:'1.0.9',updateFailure:{status:10,stderr:'confirmation_required'}});
  assert.throws(()=>ensureLarkCli({execute:true,run:r.run}),{code:'lark_cli_confirmation_required'});assert.equal(r.calls.length,3);
});
test('updater success is insufficient if actual version remains old or official skills remain stale',()=>{
  const old=runner({before:'1.0.9',latest:'1.0.98',after:'1.0.9'});
  assert.throws(()=>ensureLarkCli({execute:true,run:old.run}),{code:'cli_still_outdated'});
  const stale=runner({inSync:false,afterSync:false});assert.throws(()=>ensureLarkCli({execute:true,run:stale.run}),{code:'cli_skills_out_of_sync'});
});
test('installation checks CLI before replacing files and retains a complete previous copy',t=>{
  const f=fixture(t),destination=path.join(f.target,'miaoda-delivery');fs.mkdirSync(destination,{recursive:true});
  fs.writeFileSync(path.join(destination,'SKILL.md'),'---\nname: miaoda-delivery\n---\n');fs.writeFileSync(path.join(destination,'local-note.txt'),'preserve');
  let checked=false;const result=installSkill({sourceRoot:f.source,targetRoot:f.target,execute:true},options=>{assert.equal(options.execute,true);assert.equal(fs.readFileSync(path.join(destination,'local-note.txt'),'utf8'),'preserve');checked=true;return ready();});
  assert.ok(checked);assert.equal(result.status,'installed');assert.equal(fs.readFileSync(path.join(result.backup,'local-note.txt'),'utf8'),'preserve');
  assert.ok(path.relative(f.target,result.backup).startsWith('..'+path.sep));
  assert.deepEqual(fs.readdirSync(f.target),['miaoda-delivery']);
  assert.equal(fs.readFileSync(path.join(destination,'feature.cjs'),'utf8'),'new content');assert.equal(JSON.parse(fs.readFileSync(path.join(destination,'.installation.json'),'utf8')).cli.latestVerified,true);
});
test('failed CLI check leaves active skill intact; dry-run creates no installation',t=>{
  const f=fixture(t),destination=path.join(f.target,'miaoda-delivery');fs.mkdirSync(destination,{recursive:true});fs.writeFileSync(path.join(destination,'SKILL.md'),'---\nname: miaoda-delivery\n---\n');
  assert.throws(()=>installSkill({sourceRoot:f.source,targetRoot:f.target,execute:true},()=>{throw Error('network');}));assert.equal(fs.readdirSync(f.target).length,1);
  const result=installSkill({sourceRoot:f.source,targetRoot:path.join(f.root,'new-target')},ready);assert.equal(result.installed,false);assert.equal(fs.existsSync(path.join(f.root,'new-target')),false);
  assert.throws(()=>installSkill({sourceRoot:f.source,targetRoot:f.target,execute:true},()=>({latestVerified:false})),{code:'cli_not_ready'});
});
test('repeat installation remains idempotent while checking CLI each time',t=>{
  const f=fixture(t);let checks=0;const ensure=()=>{checks++;return ready();};
  installSkill({sourceRoot:f.source,targetRoot:f.target,execute:true},ensure);
  const repeat=installSkill({sourceRoot:f.source,targetRoot:f.target,execute:true},ensure);
  assert.equal(repeat.status,'already_installed');assert.equal(checks,2);assert.deepEqual(fs.readdirSync(f.target),['miaoda-delivery']);
});
test('unrelated target, nested target and unknown installation flags are rejected',t=>{
  const f=fixture(t),destination=path.join(f.target,'miaoda-delivery');fs.mkdirSync(destination,{recursive:true});fs.writeFileSync(path.join(destination,'SKILL.md'),'name: other-skill');
  assert.throws(()=>installSkill({sourceRoot:f.source,targetRoot:f.target,execute:true},ready),{code:'invalid_skill_target'});
  assert.throws(()=>installSkill({sourceRoot:f.source,targetRoot:path.join(f.source,'nested'),execute:true},ready),{code:'unsafe_install_path'});
  assert.throws(()=>parse(['--force']),{code:'invalid_argument'});
});
