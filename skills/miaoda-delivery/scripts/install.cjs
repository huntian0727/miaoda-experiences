#!/usr/bin/env node
'use strict';
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const crypto=require('node:crypto');
const {assert,Failure}=require('./lib.cjs');
const {ensureLarkCli}=require('./lark-update.cjs');

function files(root) {
  const result=[];
  function walk(directory) {for(const entry of fs.readdirSync(directory,{withFileTypes:true})) {
    if(entry.name==='.installation.json')continue;
    assert(!entry.isSymbolicLink(),'unsafe_skill_source','Skill files must not be symbolic links');
    const absolute=path.join(directory,entry.name);
    if(entry.isDirectory())walk(absolute);else if(entry.isFile())result.push(path.relative(root,absolute));
  }}
  walk(root);return result.sort();
}
function skillDirectory(directory) {
  const stat=fs.lstatSync(directory);
  assert(stat.isDirectory()&&!stat.isSymbolicLink(),'invalid_skill_target','Expected a regular skill directory');
  assert(/^name:\s*miaoda-delivery\s*$/m.test(fs.readFileSync(path.join(directory,'SKILL.md'),'utf8')),
    'invalid_skill_target','Refusing to replace a directory that is not miaoda-delivery');
}
function within(root,child) {
  const relative=path.relative(root,child);
  assert(relative && !path.isAbsolute(relative) && relative!=='..' && !relative.startsWith('..'+path.sep),
    'unsafe_install_path','Installation paths must remain inside the selected skills directory');
}
function sameSkill(source,target) {
  const left=files(source),right=files(target);
  return JSON.stringify(left)===JSON.stringify(right) && left.every(item=>fs.readFileSync(path.join(source,item)).equals(fs.readFileSync(path.join(target,item))));
}
function installSkill({targetRoot,execute=false,sourceRoot=path.resolve(__dirname,'..')}={},ensure=ensureLarkCli) {
  sourceRoot=fs.realpathSync(sourceRoot);skillDirectory(sourceRoot);files(sourceRoot);
  targetRoot=path.resolve(targetRoot||path.join(process.env.CODEX_HOME||path.join(os.homedir(),'.codex'),'skills'));
  if(fs.existsSync(targetRoot))targetRoot=fs.realpathSync(targetRoot);
  assert(path.dirname(targetRoot)!==targetRoot,'unsafe_install_path','Choose a skills directory, not a filesystem root');
  const destination=path.join(targetRoot,'miaoda-delivery');within(targetRoot,destination);
  const backupRoot=path.join(path.dirname(targetRoot),path.basename(targetRoot)+'.miaoda-delivery-backups');
  if(fs.existsSync(destination))skillDirectory(destination);
  const relativeRoot=path.relative(sourceRoot,targetRoot);
  assert(relativeRoot==='..' || relativeRoot.startsWith('..'+path.sep) || path.isAbsolute(relativeRoot),
    'unsafe_install_path','Do not install into a skills directory nested inside the source skill');
  // CLI check/update succeeds before any skill file is replaced.
  const cli=ensure({execute});
  if(!execute)return {status:'dry_run',destination,cli,installed:false,next:'Run with --execute to update Feishu CLI if necessary and install the skill'};
  assert(cli.latestVerified===true,'cli_not_ready','Latest CLI was not verified; installation stopped');
  const version=JSON.parse(fs.readFileSync(path.join(sourceRoot,'channel.json'),'utf8')).skillVersion;
  if(sourceRoot===destination || fs.existsSync(destination)&&sameSkill(sourceRoot,destination))return {status:'already_installed',version,destination,cli,installed:true};
  fs.mkdirSync(targetRoot,{recursive:true});
  const resolvedRoot=fs.realpathSync(targetRoot);assert(resolvedRoot===targetRoot,'unsafe_install_path','Selected skills directory changed during installation');
  const lockPath=path.join(targetRoot,'.miaoda-delivery.install.lock');within(targetRoot,lockPath);
  let lock;try{lock=fs.openSync(lockPath,'wx',0o600);}catch(error){if(error.code==='EEXIST')throw new Failure('installation_busy','Another installer holds the skill directory lock');throw error;}
  let staging,backup=null;
  try {
    staging=fs.mkdtempSync(path.join(targetRoot,'.miaoda-delivery-install-'));within(targetRoot,staging);
    const candidate=path.join(staging,'miaoda-delivery');within(targetRoot,candidate);
    fs.cpSync(sourceRoot,candidate,{recursive:true,errorOnExist:true,force:false});skillDirectory(candidate);
    fs.writeFileSync(path.join(candidate,'.installation.json'),JSON.stringify({schemaVersion:1,version,installedAt:new Date().toISOString(),cli},null,2)+'\n');
    if(fs.existsSync(destination)) {
      skillDirectory(destination);
      // Keep backups outside the active discovery directory to avoid loading duplicate skills.
      fs.mkdirSync(backupRoot,{recursive:true});
      assert(fs.realpathSync(backupRoot)===backupRoot,'unsafe_install_path','Backup directory must not redirect outside its selected location');
      backup=path.join(backupRoot,'miaoda-delivery.backup-'+crypto.randomUUID());within(backupRoot,backup);
      fs.renameSync(destination,backup);
    }
    try {fs.renameSync(candidate,destination);}catch(error){if(backup&&!fs.existsSync(destination))fs.renameSync(backup,destination);throw error;}
    fs.rmdirSync(staging); // Empty staging directory only; backups are never recursively deleted.
    return {status:'installed',version,destination,backup,cli,installed:true};
  } finally {fs.closeSync(lock);fs.unlinkSync(lockPath);}
}
function parse(argv) {
  const options={};
  while(argv.length){const arg=argv.shift();if(arg==='--execute'){assert(!options.execute,'invalid_argument','Duplicate --execute');options.execute=true;}
    else if(arg==='--target'){assert(!options.targetRoot&&argv.length&&!argv[0].startsWith('--'),'invalid_argument','Supply one skills parent directory');options.targetRoot=argv.shift();}
    else throw new Failure('invalid_argument','Supported installation options: --target <skills-parent-directory> --execute');}
  return options;
}
if(require.main===module){try{console.log(JSON.stringify(installSkill(parse(process.argv.slice(2))),null,2));}
  catch(error){console.log(JSON.stringify({status:'failed',code:error.code||'installation_failed',message:error instanceof Failure?error.message:'Skill installation failed; existing backup/staging files are preserved for inspection'}));process.exitCode=1;}}
module.exports={installSkill,parse};
