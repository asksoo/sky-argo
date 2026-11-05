// Evaluation set. Principle: the rewrite must let an AI execute the user's real intent accurately.
// keep: must appear verbatim · resolve: at least one must appear (context was understood)
// maxRatio: output/draft length limit · forbid: patterns that mean the task was answered or drifted
const ctx = (...pairs) => pairs.map(([role, text]) => ({ role, content: text }));

export default [
  // ---- coding / operations ----
  { id: 'c01', kind: 'coding', note: '短而模糊', draft: '修复登录bug', maxRatio: 30 },
  { id: 'c02', kind: 'coding', note: '含路径与参数', draft: '把 src/utils/date.ts 里的 formatDate 改成支持时区参数，默认用 Asia/Shanghai', keep: ['src/utils/date.ts', 'formatDate', 'Asia/Shanghai'], maxRatio: 4 },
  { id: 'c03', kind: 'coding', note: '指代上文', draft: '还是有问题，换行了',
    context: ctx(['user', 'pi-web-ui 提示词优化插件的预览面板里，「填回输入框」按钮文字被截断了'], ['assistant', '原因是宿主 .btn 是固定 30×30px 的图标按钮样式，我已改为宽度随文字变化、左右内边距 12px。']),
    resolve: ['填回输入框'], maxRatio: 30 },
  { id: 'c04', kind: 'coding', note: '已经清晰', draft: '运行 npm test，只修复 tests/auth.test.ts 中失败的用例，不要修改其他测试文件，完成后汇报修改了哪些文件。', keep: ['npm test', 'tests/auth.test.ts'], maxRatio: 1.6 },
  { id: 'c05', kind: 'coding', note: '@ 技能标记', draft: '@skill:debug 排查为什么 /api/models 返回空列表', keep: ['@skill:debug', '/api/models'], maxRatio: 8 },
  { id: 'c06', kind: 'coding', note: '命令原样保留', draft: '用 `git rebase -i HEAD~3` 合并最近三个提交，提交信息用中文', keep: ['git rebase -i HEAD~3'], maxRatio: 5 },
  { id: 'c07', kind: 'coding', note: '指代上文', draft: '把它设为私有',
    context: ctx(['user', '把插件推送到 git@github.com:asksoo/sky-argo.git'], ['assistant', '已推送 main 分支和 v1.0.0 标签到 asksoo/sky-argo。']),
    resolve: ['sky-argo'], maxRatio: 30 },
  { id: 'c08', kind: 'coding', note: '英文保持英文', draft: 'add retry with exponential backoff to fetchUser in api/client.ts, max 3 attempts', keep: ['fetchUser', 'api/client.ts'], forbid: [/[\u4e00-\u9fa5]{3,}/], maxRatio: 5 },
  { id: 'c09', kind: 'coding', note: '极短确认语', draft: '确认方案',
    context: ctx(['assistant', '修改方案：1. 重写优化规则 2. 读取最近对话 3. 清洗输出 4. 问题单独显示 5. 面板交互 6. 评估样例集。请回复“确认方案”，我会先做技术确认，再开始修改。']),
    resolve: ['方案'], maxRatio: 40 },
  { id: 'c10', kind: 'coding', note: '不得扩大范围', draft: '删除 build/ 目录下所有 .map 文件', keep: ['build/', '.map'], forbid: [/rm -rf \/(\s|$)/, /整个项目|所有目录/], maxRatio: 6 },
  // ---- writing / content ----
  { id: 'w01', kind: 'writing', note: '不得直接写出邮件', draft: '写一封请假邮件，明天上午去医院', forbid: [/此致|敬礼|您好，?\n/], maxRatio: 12 },
  { id: 'w02', kind: 'writing', note: '已经清晰', draft: '用 300 字左右、轻松的语气，向小学生介绍光合作用，结尾提一个思考题。', keep: ['300'], maxRatio: 1.6 },
  { id: 'w03', kind: 'writing', note: '原句原样保留', draft: '把下面这段话改得更正式：我们这周搞不完，下周再弄', keep: ['我们这周搞不完，下周再弄'], maxRatio: 5 },
  { id: 'w04', kind: 'writing', note: '指代上文', draft: '再写个结尾',
    context: ctx(['user', '我在写公司年会的主持稿，主题是“向新而行”'], ['assistant', '开场部分已写好：……（略）']),
    resolve: ['年会', '向新而行', '主持'], maxRatio: 30 },
  { id: 'w05', kind: 'writing', note: '不得直接写诗', draft: '写一首关于秋天的诗', forbid: [/(\n[^\n]{3,20}){4,}/], maxRatio: 15 },
  { id: 'w06', kind: 'writing', note: '不得直接翻译', draft: 'Translate to Chinese: The quick brown fox jumps over the lazy dog.', keep: ['The quick brown fox jumps over the lazy dog.'], forbid: [/敏捷的(棕色)?狐狸/], maxRatio: 4 },
  { id: 'w07', kind: 'writing', note: '保留约束', draft: '给我的咖啡店起几个名字，店在大学旁边，主打手冲', keep: ['手冲'], maxRatio: 8 },
  { id: 'w08', kind: 'writing', note: '指代上文', draft: '总结一下上面的内容，给我哥哥看',
    context: ctx(['assistant', '提示词优化插件已发布到 asksoo/sky-argo：用当前模型改写输入框草稿，预览后填回，支持恢复原文，不会自动发送。']),
    resolve: ['插件', '提示词'], maxRatio: 12 },
  { id: 'w09', kind: 'writing', note: '指代上文', draft: '写个小红书文案推广这个',
    context: ctx(['user', '我做了一个 pi-web-ui 的提示词优化插件'], ['assistant', '它可以一键优化输入框里的提示词，预览确认后再填回。']),
    resolve: ['提示词优化', '提示词', '插件'], maxRatio: 12 },
  { id: 'w10', kind: 'writing', note: '不得直接回答', draft: '什么是RAG', forbid: [/检索增强生成(是|指)一种/], maxRatio: 20 },
];
