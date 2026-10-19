'use strict';
const {spawnSync} = require('node:child_process');
const {Failure,assert} = require('./lib.cjs');

function runLark(args) {
  return spawnSync('lark-cli',args,{encoding:'utf8',shell:false,windowsHide:true,
    timeout:args.includes('--check')?45000:180000,maxBuffer:2*1024*1024,
    env:{...process.env,LARKSUITE_CLI_NO_UPDATE_NOTIFIER:'1',LARKSUITE_CLI_NO_SKILLS_NOTIFIER:'1'}});
}
function resultOK(result,phase) {
  if(result.error?.code==='ENOENT')throw new Failure('lark_cli_missing','Install Feishu CLI from its official distribution, then rerun skill installation');
  if(result.status===10)throw new Failure('lark_cli_confirmation_required','Official CLI requires confirmation; complete the authorized update manually, then retry installation');
  assert(!result.error && result.status===0,'lark_cli_'+phase+'_failed',`Official CLI ${phase} failed; installation stopped (exit ${Number.isInteger(result.status)?result.status:'unavailable'})`);
}
function versionParts(value) {
  assert(typeof value==='string','invalid_cli_version','Missing CLI version');
  const match=/^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(value.trim());
  assert(match,'invalid_cli_version','Unrecognized CLI version');
  return {numbers:match.slice(1,4).map(Number),pre:match[4]?.split('.')||[]};
}
function compareVersions(a,b) {
  const left=versionParts(a),right=versionParts(b);
  for(let i=0;i<3;i++)if(left.numbers[i]!==right.numbers[i])return Math.sign(left.numbers[i]-right.numbers[i]);
  if(!left.pre.length || !right.pre.length)return left.pre.length===right.pre.length?0:left.pre.length?-1:1;
  for(let i=0;i<Math.max(left.pre.length,right.pre.length);i++) {
    if(left.pre[i]===undefined)return -1;if(right.pre[i]===undefined)return 1;
    if(left.pre[i]===right.pre[i])continue;
    const ln=/^\d+$/.test(left.pre[i]),rn=/^\d+$/.test(right.pre[i]);
    if(ln&&rn)return Math.sign(Number(left.pre[i])-Number(right.pre[i]));
    if(ln!==rn)return ln?-1:1;
    return left.pre[i]<right.pre[i]?-1:1;
  }
  return 0;
}
function executableVersion(run) {
  const result=run(['--version']);resultOK(result,'version');
  const match=/^lark-cli(?: version)?\s+(v?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?)/m.exec(result.stdout||'');
  assert(match,'invalid_cli_version','Cannot identify the active lark-cli executable version');
  versionParts(match[1]);return match[1].replace(/^v/,'');
}
function updateEnvelope(result,phase) {
  resultOK(result,phase);
  let envelope;try{envelope=JSON.parse(result.stdout);}catch{throw new Failure('invalid_update_response','Official updater did not return structured JSON; installation stopped');}
  assert(envelope.ok===true,'lark_cli_'+phase+'_failed','Official updater did not confirm success; installation stopped');
  const data=envelope.current_version?envelope:envelope.data;
  assert(data && typeof data==='object','invalid_update_response','Missing official update result');
  versionParts(data.current_version);versionParts(data.latest_version);
  return data;
}
function check(run) {
  const active=executableVersion(run);
  const report=updateEnvelope(run(['update','--check','--json']),'check');
  assert(compareVersions(active,report.current_version)===0,'cli_path_mismatch','Active executable differs from official update check; inspect PATH before installing');
  return {currentVersion:active,latestVersion:report.latest_version.replace(/^v/,''),
    skillsInSync:typeof report.skills_status?.in_sync==='boolean'?report.skills_status.in_sync:null};
}
function ensureLarkCli({execute=false,run=runLark}={}) {
  const before=check(run);
  const comparison=compareVersions(before.currentVersion,before.latestVersion);
  const needsUpdate=comparison<0 || comparison===0 && before.skillsInSync===false;
  if(!needsUpdate)return {status:comparison>0?'newer_than_update_source':'up_to_date',...before,updated:false,latestVerified:true,source:'official_active_update_source'};
  if(!execute)return {status:'update_required',...before,updated:false,latestVerified:false,command:['lark-cli','update','--json']};
  // No --force, downgrade, shell pipeline, arbitrary installer URL or confirmation bypass.
  updateEnvelope(run(['update','--json']),'update');
  const after=check(run);
  assert(compareVersions(after.currentVersion,after.latestVersion)>=0,'cli_still_outdated','CLI remains behind the current update source; retry installation after resolving the updater');
  assert(after.skillsInSync!==false,'cli_skills_out_of_sync','Official CLI skills remain out of sync; installation stopped');
  return {status:'updated',previousVersion:before.currentVersion,...after,updated:true,
    cliVersionChanged:compareVersions(before.currentVersion,after.currentVersion)!==0,latestVerified:true,source:'official_active_update_source'};
}
module.exports={runLark,compareVersions,ensureLarkCli};
