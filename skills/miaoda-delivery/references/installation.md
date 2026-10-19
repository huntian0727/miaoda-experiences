# 安装时检查并更新飞书 CLI

从仓库根目录：

```text
npm run install:skill
```

从解压后的技能包：

```text
node miaoda-delivery/scripts/install.cjs --execute
```

默认安装到 CODEX_HOME/skills/miaoda-delivery，CODEX_HOME 未设置时为用户目录 .codex/skills/miaoda-delivery。其他 AI 工具可用 `--target <该工具的技能父目录>` 指定安装位置。已有同名技能先完整保存在技能父目录旁的 `<父目录名>.miaoda-delivery-backups/`，再换入新版；备份不进入技能扫描目录，避免旧版被重复加载。不自动清理备份，不改登录或环境配置。

不加 --execute 时仅检查和预览，不安装、不更新。独立检查命令为 `node scripts/miaoda.cjs ensure-lark-cli`；授权更新加 --execute。

## 执行顺序

1. 确认源目录与目标属于 miaoda-delivery，拒绝符号链接、嵌套复制及不相关目标。
2. 读取实际 `lark-cli --version`，调用官方 `lark-cli update --check --json`；按 ok=true、current_version、latest_version 和 skills_status.in_sync 判断，不做字符串大小比较。
3. CLI 落后或版本相同但官方 skills 不同步时，运行 `lark-cli update --json`。官方 updater 会同时管理 CLI 与官方飞书技能；不替换为 npm upgrade、私有接口或远程 shell 安装脚本。
4. 更新后重新启动 CLI，回读版本并再次查询更新源。仍落后、PATH 指向不一致、官方 skills 仍不同步或结构化结果异常时，安装失败，不覆盖当前技能。当前 CLI 高于更新源时不降级。
5. 核验成功后复制技能；同内容重复安装不重复备份，仍执行 CLI 核验。安装结果记录在本机 .installation.json，只保存版本、状态与时间，不保存凭证或 updater 原始日志。

“最新”以当前 CLI 配置的正式更新源为准，不硬编码某个版本。网络故障时明确失败，不能报告“已经最新”。CLI 未安装时提示通过官方渠道安装后重试；本版不猜测首次安装分发方式。官方 updater 要求额外确认时停止，不自动拼接确认 flag。

不同 AI 工具没有通用的自动安装钩子；手动复制文件夹无法保证执行代码。因此 README 将安装脚本作为标准入口，SKILL.md 同时要求外部技能管理器在安装流程中调用它。未调用时必须如实标记“CLI 尚未核验”。

## 本轮实测

2026-10-19，本机安装前 CLI 与当前更新源均为 1.0.98，官方技能为 1.0.68 → 1.0.98、in_sync=false。实际运行安装器调用官方 updater 后，CLI 保持 1.0.98，官方技能回读 in_sync=true，再成功安装本技能 0.3.0。CLI 二进制跨版本升级由测试桩覆盖；本次实机没有出现更高版本，因此不宣称完成了跨版本二进制升级。
