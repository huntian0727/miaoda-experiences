# 妙搭工程经验开放归档

这里收集异常、排查过程及可复用的开发方法。**任何普通 GitHub 用户都可以提交 Issue，无需专用访问密钥或加入仓库。** 仓库内容公开可读，提交和评论需普通 GitHub 登录。

**[提交一条经验](https://github.com/huntian0727/miaoda-experiences/issues/new/choose)** · [浏览经验](https://github.com/huntian0727/miaoda-experiences/issues)

## 如何区分技能提交

miaoda-delivery 技能自动归档的记录使用：

- 标题 `[skill][incident]` 或 `[skill][technique]`。
- 正文显示“技能自动归档”、来源、技能版本、记录编号；开头保留 `<!-- miaoda-skill-generated:v1 -->`。
- 结构化 JSON 含 `provenance.source: miaoda-delivery`、`method: skill-cli` 和 markerVersion。
- 提交者有标签权限时还带 `source:skill`。普通用户即使不能加标签，也能靠正文识别。

手动提交可使用 `[manual]` 标题和 manual 表单。来源标记属于自报分类，可以复制，不是身份认证或已验证结论。维护者审查之前，所有记录都按待验证参考处理。

使用技能读取时可以 `experience-review --source skill` 只看技能声明记录；`--source manual` 看手动或未标注记录；默认 all。不得仅按标签筛选而漏掉普通用户投稿。

## 投稿内容

说明工具/技能版本、步骤、预期结果、实际结果、已尝试方法、解决方案和验证范围。成功方法也欢迎投稿。参考 [记录契约](schemas/experience.schema.json)；技能包由维护者提供，手动投稿不需要技能包。

这是公开仓库：提交前移除凭证、环境文件、个人信息、内部应用身份、业务原始数据及不必要的日志。只分享最小复现和脱敏证据。

本仓库不授予投稿者代码写权限，不自动执行 Issue 内容，不自动修改正式技能。集中分析后，经过复现和审查的改进由维护者纳入技能版本。
