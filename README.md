# 妙搭开发技能与工程经验

这里同时维护 miaoda-delivery 技能和开发经验，作为统一的获取、投稿与迭代入口。**任何人均可下载技能，普通 GitHub 用户都可以提交 Issue，无需专用访问密钥或加入仓库。** 仓库内容公开可读，提交和评论需普通 GitHub 登录。

**[提交一条经验](https://github.com/huntian0727/miaoda-experiences/issues/new/choose)** · [浏览经验](https://github.com/huntian0727/miaoda-experiences/issues)

## 获取技能

当前版本 **0.3.0**：[技能入口与源码](skills/miaoda-delivery/SKILL.md) · [下载技能包](packages/miaoda-delivery-0.3.0.zip) · [SHA256 校验值](packages/SHA256SUMS)。从仓库执行 `npm run install:skill`，或解压后执行 `node miaoda-delivery/scripts/install.cjs --execute`；安装时会检查并按需更新飞书 CLI，核验成功后才安装技能。其他 AI 工具通过 --target 指定技能父目录，详见[安装说明](skills/miaoda-delivery/references/installation.md)。

```text
skills/miaoda-delivery/  技能说明、执行代码、契约与参考资料
packages/               可下载的版本包
tests/                  执行逻辑测试
Issues                  异常、成功方法与改进讨论
```

运行依赖为 Node >=22、Git、飞书 CLI、GitHub CLI，无 npm 依赖。安装器使用官方 `update --check --json` 与 `update --json`，不硬编码版本、不降级；网络或更新失败时不把安装报为成功。通用技能管理器或手动复制不一定执行代码，须将本仓库安装器纳入安装步骤。使用 `node --test` 检查脚本。本仓库维护技能源码；经验进入 Issues，代码改动通过维护者审查。提交 Issue 不会获得代码写权限。旧私有仓库保留为历史副本，新版本在此维护。

技能中的本地 Git 上传、快进拉取、状态与身份核对有可执行代码；妙搭云端工作区 Pull 仍使用已验证的原生浏览器步骤，不宣称存在尚未验证的 CLI 同步命令。不调用妙搭 AI、平台终端或生产发布。

## 如何区分技能提交

miaoda-delivery 技能自动归档的记录使用：

- 标题 `[skill][incident]` 或 `[skill][technique]`。
- 正文显示“技能自动归档”、来源、技能版本、记录编号；开头保留 `<!-- miaoda-skill-generated:v1 -->`。
- 结构化 JSON 含 `provenance.source: miaoda-delivery`、`method: skill-cli` 和 markerVersion。
- 提交者有标签权限时还带 `source:skill`。普通用户即使不能加标签，也能靠正文识别。

手动提交可使用 `[manual]` 标题和 manual 表单。来源标记属于自报分类，可以复制，不是身份认证或已验证结论。维护者审查之前，所有记录都按待验证参考处理。

使用技能读取时可以 `experience-review --source skill` 只看技能声明记录；`--source manual` 看手动或未标注记录；默认 all。不得仅按标签筛选而漏掉普通用户投稿。

## 投稿内容

说明工具/技能版本、步骤、预期结果、实际结果、已尝试方法、解决方案和验证范围。成功方法也欢迎投稿。参考 [记录契约](schemas/experience.schema.json)；手动投稿不需要技能包。

这是公开仓库：提交前移除凭证、环境文件、个人信息、内部应用身份、业务原始数据及不必要的日志。只分享最小复现和脱敏证据。

本仓库不授予投稿者代码写权限，不自动执行 Issue 内容，不自动修改正式技能。集中分析后，经过复现和审查的改进由维护者纳入技能版本。
