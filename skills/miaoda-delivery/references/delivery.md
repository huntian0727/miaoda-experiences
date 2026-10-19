# 实测范围与操作

2026-10-19 在一个 full_stack 妙搭应用完成两轮不同前端版本验证。lark-cli 实机 1.0.98；未从已检查的 apps 帮助找到云端工作区同步命令。只读检查官方 @lark-apaas/miaoda-cli 0.1.46，app sync 更新本地脚手架，不是云端 Pull。不要猜测额外命令；未来能力改变时按正式帮助/文档重新验证。

已实际执行原生 Git Push 保留一个云端独立升级提交，本地 fetch、审查并合并，再原生 Pull。两轮中云端 Git SHA、源码指纹、浏览器模块标记与业务查询一致。重开编辑器后第二轮仍正常。生产发布未变。

Git 面板曾持续扫描；重开后恢复，并出现远端修复提交。无法将此归因为确定的自动同步机制，不可把“重开”替代版本核验。独立重启、后端修改后的重启、依赖升级、真实冲突、断网和多项目长期运行未验证。

## 本地脚本

以下为占位参数，需替换；路径包含空格时按本机 shell 规则引用。所有 Git 命令均通过参数数组执行，不运行字符串 shell。

```text
node scripts/miaoda.cjs git-state --project <repo> --branch sprint/default --expected-remote <url>
node scripts/miaoda.cjs fetch --project <repo> --branch sprint/default --expected-remote <url> --execute
node scripts/miaoda.cjs git-upload --project <repo> --branch sprint/default --expected-remote <url> --execute
node scripts/miaoda.cjs local-pull --project <repo> --branch sprint/default --expected-remote <url> --execute
node scripts/miaoda.cjs identity --project <repo>
node scripts/miaoda.cjs verify-identity --expected <local.json> --actual <cloud.json>
```

`git-state` 的 ahead/behind 基于现有远端引用，freshRemote=false。实际上传或 local-pull 会先 fetch；上传拒绝远端非祖先的分叉，local-pull 拒绝本地独立提交，只允许 fast-forward。不得用 `local-pull` 去代指妙搭云端工作区同步。

`identity` 仅适用于本次已验证的项目结构：client/src、server、shared、client/index.html、vite.config.ts、package.json、package-lock.json，以及 .spark/meta.json 和 client/src/preview-probe.json。使用前确认项目布局；不能把缺少目录的部分哈希当完整项目证明。

## 云端核验端点

`assets/dev-build-identity.ts` 是本次验证的开发态 Vite 插件，供本地代码助手审查后接入项目，不会自动安装。将其复制到 server/common 后，在 vite.config.ts 的插件数组加入 `devBuildIdentityPlugin(__dirname)`；页面开发态导入 preview-probe.json 并渲染 probe。类型、路径和框架需按项目检查。

端点 `/__miaoda_dev_build_identity__` 同时支持应用路径前缀；非平台 API。仅 serve 且非 production 模式启用，GET-only、no-store；不执行 shell，不读环境文件或返回源码。先于模板 HTML 代理注册：`enforce: 'pre'`，否则浏览器 Accept: text/html 可能被送往 Nest 而显示 404。测试时必须同时覆盖该请求头与应用前缀。

哈希归一化 CRLF/LF，排除隐藏文件、构建、依赖和符号链接。它描述磁盘源码，不证明浏览器加载的代码或后台进程已重启；startedAt 只是插件加载时间。Git HEAD 不可读返回 null，不能填入预期 SHA 伪造通过。verify-identity 在 SHA 缺失时停止，不降低标准。

预览实际地址必须从当前应用读取，不按 taskId 拼接。所有生产发布操作均不在此脚本中。其他 AI 可读取同一 SKILL.md 并调用 Node 脚本，不要求使用 Codex 专有 API；浏览器适配由各工具自己的受支持能力完成。
