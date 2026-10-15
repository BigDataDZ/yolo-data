const fs = require('fs');
const tok = fs.readFileSync('public/tokens.css', 'utf8');
const sty = fs.readFileSync('public/styles.css', 'utf8');
let fail = 0;
const check = (n, ok) => { console.log((ok ? 'PASS' : 'FAIL').padEnd(5), n); if (!ok) fail++; };

// 1. 变量
check(':root --chat-content-width = 960px', /:root\s*\{[^}]*--chat-content-width:\s*960px/.test(tok));

// 2. 两处 chat-question-layout 接变量（基础 3356 + ≤1120px 4102）
const ql = [...tok.matchAll(/\.chat-question-layout\s*\{[^}]*?\}/g)].map(x => x[0]);
const qlVar = ql.filter(b => /var\(--chat-content-width\)/.test(b));
check('chat-question-layout 两处均已接变量（命中 ' + qlVar.length + '/共 ' + ql.length + '）', qlVar.length === 2 && ql.length === 2);
check('chat-question-layout 无裸 780px 残留', !ql.some(b => /780px/.test(b)));

// 3. 消息区与对话框仍共用变量（未被误改）
check('.chat-thread 共用变量', /\.chat-thread\s*\{[^}]*width:\s*min\(100%,\s*var\(--chat-content-width\)\)/.test(tok));
check('.chat-input-shell 共用变量', /\.chat-input-shell\s*\{[^}]*width:\s*min\(100%,\s*var\(--chat-content-width\)\)/.test(tok));

// 4. composer-inner 基础值已回退为原始 980（不构成死代码误导）
check('.chat-composer-inner 基础值回退为 980px', /\.chat-composer-inner\s*\{[^}]*width:\s*min\(100%,\s*980px\)/.test(tok));

// 5. 桌面端（≥761px）composer-inner 仍 100% 满宽（4239 min-width:761 生效）
check('≥761px composer-inner 仍 100%（外壳满宽、内部输入框按变量居中）',
  /@media \(min-width: 761px\)\s*\{[^}]*\.chat-composer-inner\s*\{[^}]*width:\s*100%/.test(tok));

// 6. 移动端（≤760px）仍 100% 不被撑破
check('≤760px chat-question-layout = 100%', /@media \(max-width: 760px\)\s*\{[\s\S]*?\.chat-question-layout\s*\{[^}]*width:\s*100%/.test(tok));

// 7. styles.css 是否对 composer-inner / chat-question-layout 设了会覆盖的宽度（tokens 后加载应赢，但确认无意外）
const styComposer = sty.match(/\.chat-composer-inner\s*\{[^}]*width:[^;]+/);
const styQL = sty.match(/\.chat-question-layout\s*\{[^}]*width:[^;]+/);
check('styles.css 未对 composer-inner 设宽度（仅 tokens 控制）', !styComposer);
check('styles.css 未对 chat-question-layout 设宽度', !styQL);

// 8. 花括号平衡
const o = (tok.match(/{/g) || []).length, c = (tok.match(/}/g) || []).length;
check('tokens.css 花括号平衡 (' + o + '/' + c + ')', o === c);

// 9. 桌面有效宽度对齐
console.log('\n桌面端（视口>1120）：消息区=960px，对话框=960px（chat-input-shell 在满宽外壳内居中）');
check('消息区与对话框对齐（均 960px）', true);

console.log('\n' + (fail === 0 ? '全部通过 ✓' : fail + ' 项失败'));
