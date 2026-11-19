/**
 * 中英文切换:界面里的每一段中文都要有英文译文。
 *
 * 扫描 html/popup.html、html/approval.html 的文字与 title / aria-label / placeholder / alt,
 * 以及界面层 JS(js/controller、js/app、js/common/ui、js/domain、js/config)里的中文字符串
 * (单行字面量与多行 HTML 模板里标签之间的文字;模板里的 ${…} 当作占位符),
 * 断言 translateLegacyText 都能给出英文。以后新加中文文字而没加译文,这里直接失败:
 * 在 js/common/i18n/legacy-text.js 或 legacy-text-extra.js 里补上即可。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

globalThis.chrome ||= { storage: { local: { get: async () => ({}), set: async () => {} } } };
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const { translateLegacyText, setLocale, resetI18nForTests } = await import('../js/common/i18n/index.js');
const HAN = /[一-鿿]/;

// 不显示给用户的内部文字所在的文件(数字转中文大写、相对时间解析的词表)
const INTERNAL_FILES = /number-utils\.js$|time-utils\.js$/;

function covered(s) {
  const text = s.replace(/\s+/g, ' ').trim();
  if (!text || !HAN.test(text)) return true;
  if (translateLegacyText(text)) return true;
  // 带占位符的片段:用示例值试一次(值本身不是中文)
  return Boolean(translateLegacyText(text.replace(/\{\d+\}/g, '1')));
}

function htmlStrings(file) {
  const src = fs.readFileSync(path.join(ROOT, file), 'utf8')
    .replace(/<!--[\s\S]*?-->/g, '').replace(/<script[\s\S]*?<\/script>/g, '').replace(/<style[\s\S]*?<\/style>/g, '');
  const out = [];
  // 标记了 data-no-i18n 的元素(例如语言选择里的「中文」)不算
  const noI18n = /<[^>]*data-no-i18n[^>]*>[\s\S]*?<\/select>/g;
  const cleaned = src.replace(noI18n, '');
  for (const m of cleaned.matchAll(/>([^<>]+)</g)) out.push(m[1]);
  for (const m of cleaned.matchAll(/\s(?:placeholder|title|aria-label|alt)="([^"]*)"/g)) out.push(m[1]);
  return out;
}

function jsStrings(dir) {
  const out = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { walk(p); continue; }
      if (!p.endsWith('.js') || p.includes(`${path.sep}i18n${path.sep}`) || INTERNAL_FILES.test(p)) continue;
      const src = fs.readFileSync(p, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:\\'"`])\/\/.*$/gm, '$1')
        .replace(/console\.(log|warn|error|info|debug)\((?:[^()]|\([^()]*\))*\)/g, '');
      const where = path.relative(ROOT, p);
      for (const m of src.matchAll(/'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"/g)) {
        const s = m[1] ?? m[2];
        if (!HAN.test(s)) continue;
        // 字面量里的 HTML 片段:按标签切开,只看文字(尖括号里是中文的不是标签,例如 <目标资源>)
        for (const seg of s.split(/<\/?[a-zA-Z][^>]*>/)) {
          if (HAN.test(seg)) out.push([seg.replace(/\\'/g, "'").replace(/\\"/g, '"'), where]);
        }
      }
      for (const m of src.matchAll(/`((?:[^`\\]|\\.)*)`/g)) {
        let k = 0;
        // 嵌套模板(${a ? `x` : ''})只取外层文字;内层模板会被单独匹配
        const body = m[1].replace(/\$\{(?:[^{}`]|\{[^{}]*\}|`[^`]*`)*\}/g, () => `{${k++}}`);
        for (const seg of body.split(/<\/?[a-zA-Z][^>]*>/)) {
          if (HAN.test(seg) && !seg.includes('${')) out.push([seg, where]);
        }
      }
    }
  };
  walk(path.join(ROOT, dir));
  return out;
}

test('界面里的中文都有英文译文(HTML)', async () => {
  await setLocale('en-US');
  const missing = [];
  for (const f of ['html/popup.html', 'html/approval.html']) {
    for (const s of htmlStrings(f)) if (!covered(s)) missing.push(`${f}: ${s.trim()}`);
  }
  resetI18nForTests();
  assert.deepEqual([...new Set(missing)], [], '以下文字没有英文译文');
});

test('界面里的中文都有英文译文(JS)', async () => {
  await setLocale('en-US');
  const missing = [];
  for (const dir of ['js/controller', 'js/app', 'js/common/ui', 'js/domain', 'js/config']) {
    for (const [s, where] of jsStrings(dir)) if (!covered(s)) missing.push(`${where}: ${s.replace(/\s+/g, ' ').trim()}`);
  }
  resetI18nForTests();
  assert.deepEqual([...new Set(missing)], [], '以下文字没有英文译文');
});

test('英文界面:模式翻译把运行时的值一起翻好;中文界面原样', async () => {
  await setLocale('en-US');
  assert.equal(translateLegacyText('取消'), 'Cancel');
  assert.equal(translateLegacyText('3 天前'), '3 days ago');
  assert.equal(translateLegacyText('预估失败: 无效的请求参数'), 'Estimation failed: Invalid request parameters');
  assert.equal(translateLegacyText('知行图测试网'), 'KnowDoGraph Testnet');
  assert.equal(translateLegacyText('Ethereum Mainnet'), null, '英文原文不再翻译');
  resetI18nForTests();
});

test('签署知行图操作时弹窗里的摘要,英文界面全部译出', async () => {
  const op = await import('../js/chain/adapters/zhixing/op.js');
  await setLocale('en-US');
  const h = '11'.repeat(32);
  const actions = [
    { type: 'verify', unit: 8, version: 2, verdict: 'pass' },
    { type: 'verify', unit: 8, version: 2, verdict: 'needs-revision' },
    { type: 'invite', pubkey: 'ab'.repeat(32) },
    { type: 'create', layer: 'foundation', domain: 2, bodies: [{ lang: 'zh', hash: h }], source: { type: 'model', id: 'm' },
      cites: [{ unit: 8, version: 2, kind: 'basis' }, { unit: 9, version: 2, kind: 'see-also' }, { unit: 3, version: 1, kind: 'supersedes' }] },
    { type: 'publish', unit: 6, bodies: [{ lang: 'zh', hash: h }], source: { type: 'human' }, cites: [] }
  ];
  for (const action of actions) {
    const d = op.describeKnowledgeOp(3, action, 7);
    for (const s of [d.title, ...(d.lines || []), d.risk].filter(Boolean)) {
      const en = translateLegacyText(s);
      assert.ok(en && !HAN.test(en), `没有完整译出:${s} → ${en}`);
    }
  }
  resetI18nForTests();
});

test('中文界面里链名用中文(以太坊 / 波场 / 索拉纳 / 比特币),不和英文混排', async () => {
  const { messagesZhCN } = await import('../js/common/i18n/messages-zh-CN.js');
  const { NETWORKS } = await import('../js/config/network-config.js');
  const ENGLISH_CHAIN = /\b(Ethereum|Tron|Bitcoin|Solana)\b/;
  const bad = [];
  for (const [k, v] of Object.entries(messagesZhCN)) if (ENGLISH_CHAIN.test(v)) bad.push(`messages-zh-CN ${k}: ${v}`);
  for (const [k, n] of Object.entries(NETWORKS)) if (ENGLISH_CHAIN.test(n.names?.['zh-CN'] || '')) bad.push(`network ${k}: ${n.names['zh-CN']}`);
  for (const f of ['html/popup.html', 'html/approval.html']) {
    for (const s of htmlStrings(f)) if (HAN.test(s) && ENGLISH_CHAIN.test(s)) bad.push(`${f}: ${s.trim()}`);
  }
  for (const dir of ['js/controller', 'js/app', 'js/common/ui', 'js/domain', 'js/config']) {
    for (const [s, where] of jsStrings(dir)) if (HAN.test(s) && ENGLISH_CHAIN.test(s)) bad.push(`${where}: ${s.trim()}`);
  }
  assert.deepEqual([...new Set(bad)], []);
});
