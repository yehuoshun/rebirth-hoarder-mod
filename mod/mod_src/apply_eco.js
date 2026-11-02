// apply_eco.js - 注入一键生态打理（window.__RH_ECO__）到 AppContent 主容器组件（props 解构处）的 const 多声明内部
// 用 IIFE 作为 const 的第二个声明符（不破坏语句结构）：
//   const {...}=t, __rhEcoModBind9=(function(){ window.__RH_ECO__={...}; return 1; })(), de=...
// 组件渲染时执行，ue(props.setGameState 全局 setter) 与模块级函数 k0/vl/Vi/xr 均在闭包作用域内。
//
// 【2026-09-06 全面自适应改造】压缩变量名每次游戏更新都会变，硬编码名字极易"同名不同义"
// （v3.15 教训：喂食 _4 实为清定时器、浇水 by 实为广告查询、孵化误用放入函数 b9）。
// 现在所有符号都在打补丁时从目标文件解析：
//   1) 语义键  ：组件 props 解构的大对象里存在语义键名（setGameState/harvestPlant/applyWater/addFeed...），
//                键名是源码里的英文标识，压缩后依然保留 → 用它反查压缩名，最稳。
//   2) 形态匹配：语义键里没有的（放蛋 _9 / 蛋映射 ef / 动物配置 xo / 菜谱），按函数体特征正则解析。
// 【v3.21】改为双模式：模块导出 patch({src,log})；CLI: node apply_eco.js <AppContent.js>
'use strict';
const fs = require('fs');
const path = require('path');
const { PatchError, expectOne, modeOf } = require('./rh_resolve.js');

const PATCH = '生态打理';

function patch({ src, log }) {
  log = log || (() => {});
  if (src.indexOf('/*==RH_ECO_INJECT==*/') >= 0) {
    log('RH_ECO_INJECT 已存在，跳过');
    return src;
  }

  // ---------- 1. 解析注入锚点 ----------
  const m = expectOne(src, /syncAndSaveGallery:[\w$]+\}\),/g, PATCH, '注入锚点 syncAndSaveGallery:<x>}),');
  const anchor = m[0];
  const anchorIdx = m.index;
  const insertAt = anchorIdx + anchor.length;
  log('锚点 ' + anchor + ' @' + anchorIdx);

  // ---------- 2. 语义键解析（组件 props 解构对象：key -> 压缩名） ----------
  // 只在 watch（本补丁真正要用的语义键）上做歧义检测：窗口内有成千上万个 key:value
  // （name/id/type 等天然多值），对全部键检测会误杀。
  // 用法上，这 9 个键是"组件作用域内真实函数引用"的键名，窗口内应取值唯一；
  // 若出现多个不同压缩名，说明结构变化导致无法确定哪个是真实引用，此处直接中止安装，
  // 避免静默取到"同名不同义"的别的函数（v3.15 教训：喂食取到清定时器、浇水取到广告查询）。
  function resolveSemanticKeys(s, idx, watch) {
    const seg = s.slice(Math.max(0, idx - 26000), idx + 40);
    const re = /([A-Za-z_$][\w$]*):([\w$]+)(?=[,}])/g;
    const map = {};
    const seen = {};
    let mm;
    while ((mm = re.exec(seg))) {
      const k = mm[1];
      if (watch.indexOf(k) >= 0) (seen[k] = seen[k] || new Set()).add(mm[2]);
      if (!(k in map)) map[k] = mm[2]; // 首次出现优先（已实测新旧版窗口内各键取值唯一）
    }
    const amb = watch.filter(k => seen[k] && seen[k].size > 1);
    if (amb.length) {
      throw new PatchError(PATCH, '语义键歧义',
        '以下键在锚点前 26000 字符内出现多个不同压缩名：' +
        amb.map(k => k + '=[' + [...seen[k]].join(',') + ']').join('；'),
        [{ desc: '锚点', re: /syncAndSaveGallery:[\w$]+\}\),/, src: s.slice(Math.max(0, idx - 200), idx + 60) }]);
    }
    return map;
  }
  const WANT = [
    ['setGameState', '__RH_FN_SETSTATE__'],
    ['ensureFarmState', '__RH_FN_FARMSTATE__'],
    ['harvestPlant', '__RH_FN_HARVEST__'],
    ['normalizeIncubatorState', '__RH_FN_INCUB__'],
    ['getAnimalDisplayInfo', '__RH_FN_ANIMALINFO__'],
    ['placeAnimal', '__RH_FN_PLACE__'],
    ['addFeed', '__RH_FN_ADDFEED__'],
    ['applyWater', '__RH_FN_WATER__'],
    ['applyFertilizer', '__RH_FN_FERT__'],
  ];
  const keys = resolveSemanticKeys(src, anchorIdx, WANT.map(w => w[0]));

  const sym = {};
  for (const [key, ph] of WANT) {
    if (!keys[key]) throw new PatchError(PATCH, '语义键 ' + key, 'props 解构中未找到', [{ desc: '键 ' + key, re: new RegExp(key + ':'), src }]);
    sym[ph] = keys[key];
  }

  // ---------- 3. 放蛋（孵化）函数 + 蛋映射 ----------
  // v3.22 及以前形态：function X(t,e,n){const s=Vi(t),r=ef(e);return r?{...s,pendingHatches:[...]}:null}
  function resolveHatchV1(s, viName) {
    const loose = new RegExp('function ([\\w$]+)\\([\\w$]+,[\\w$]+,[\\w$]+\\)\\{[\\s\\S]{0,260}?' + viName.replace(/\$/g, '\\$&') +
      '\\([\\w$]+\\)[\\s\\S]{0,120}?pendingHatches');
    const mm = loose.exec(s);
    if (!mm) return null;
    const body = s.slice(mm.index, mm.index + 600);
    const eggMap = /,[\\w$]+=([\\w$]+)\\([\\w$]+\\);return/.exec(body);
    return { fn: mm[1], eggMap: eggMap ? eggMap[1] : null };
  }
  // v2 形态（2026-11 大更新起）：放蛋逻辑并入 normalizeIncubatorState（签名变 (state, eggId, day)
  // → 新 state 或假值，与注入体调用约定完全一致）；蛋映射改为 useMemo Map 合并形态、不再有
  // 独立判蛋函数 → v2 模式以 normalizeIncubatorState 为放蛋函数，判蛋用注入体内置 `*_egg` 规则。
  const hatchV1 = resolveHatchV1(src, sym['__RH_FN_INCUB__']);
  let ecoMode = 'v1';
  if (!hatchV1 || !hatchV1.fn || !hatchV1.eggMap) {
    const v2shape = /pendingHatches(\?\?\[|\?\.\[)/.test(src);
    if (v2shape) {
      ecoMode = 'v2';
      log('检测到新版生态形态（pendingHatches 新写法），启用 v2 兼容模式');
    } else {
      throw new PatchError(PATCH, '放蛋(孵化)函数/蛋映射', 'pendingHatches 形态解析失败', [{ desc: 'pendingHatches', re: /pendingHatches/, src }]);
    }
  }
  if (ecoMode === 'v1') {
    sym['__RH_FN_HATCH__'] = hatchV1.fn;
    sym['__RH_FN_EGGMAP__'] = hatchV1.eggMap;
  } else {
    sym['__RH_FN_HATCH__'] = keys['normalizeIncubatorState'];
  }

  // ---------- 4. 动物配置对象（xo）：从 placeAnimal 函数体里取 ----------
  function resolveAnimalCfg(s, placeFn) {
    const pi = s.indexOf('function ' + placeFn + '(');
    if (pi < 0) return null;
    const body = s.slice(pi, pi + 400);
    const cfgMatch = /!([\w$]+)\[[\w$]+\]/.exec(body);
    return cfgMatch ? cfgMatch[1] : null;
  }
  if (ecoMode === 'v1') {
    const animalCfg = resolveAnimalCfg(src, sym['__RH_FN_PLACE__']);
    if (!animalCfg) {
      throw new PatchError(PATCH, '动物配置对象', 'placeAnimal 函数体内未找到 `!X[Y]`', [{ desc: 'placeAnimal 函数体', re: /function /, src }]);
    }
    sym['__RH_FN_ANIMALCFG__'] = animalCfg;
  } else {
    if (!keys['ITEMS']) throw new PatchError(PATCH, '动物配置对象', 'ITEMS 键未找到（v2）', [{ desc: 'ITEMS', re: /ITEMS:/, src }]);
    sym['__RH_FN_ITEMS__'] = keys['ITEMS'];
    log('v2 动物判定改用 ITEMS 表 (' + keys['ITEMS'] + ')，判据 Qe[d]?.animalConfig');
  }

  // ---------- 5. 宰杀函数（含 raw_chicken 产物映射、函数头 (list,id)） ----------
  function resolveSlaughter(s) {
    const mi = s.indexOf('raw_chicken');
    if (mi < 0) return null;
    const re = /function\s+([\w$]+)\(([\w$]+),([\w$]+)\)\{/g;
    let mm, found = null;
    while ((mm = re.exec(s))) {
      if (mm.index >= mi) break;
      const body = s.slice(mm.index, mi + 300);
      if (body.indexOf('isMature') >= 0 && body.indexOf('raw_chicken') >= 0) found = mm[1];
    }
    return found;
  }
  let fnSlaughter = null;
  if (ecoMode === 'v1') {
    fnSlaughter = resolveSlaughter(src);
  } else {
    fnSlaughter = keys['slaughterAnimal'] || null;
    log('v2 宰杀函数改用 slaughterAnimal 键 (' + fnSlaughter + ')');
  }
  if (!fnSlaughter) {
    throw new PatchError(PATCH, '宰杀函数', (ecoMode === 'v1' ? 'raw_chicken/isMature 形态解析失败' : 'slaughterAnimal 键缺失'), [{ desc: 'raw_chicken', re: /raw_chicken/, src }]);
  }
  sym['__RH_FN_SLAUGHTER__'] = fnSlaughter;

  // ---------- 6. 菜谱函数（v1：const A=(dev.level||0)+1,B=FN(A)；v2：FN((X.level||0)+1) 调用形态） ----------
  function resolveRecipes(s) {
    const re = /const\s+(\w+)=\((\w+)\.level\|\|0\)\+1,\w+=([\w$]+)\(\1\)/g;
    const seen = {};
    let mm;
    while ((mm = re.exec(s))) { seen[mm[3]] = (seen[mm[3]] || 0) + 1; }
    let found = null, best = 0;
    for (const k of Object.keys(seen)) { if (seen[k] > best) { best = seen[k]; found = k; } }
    return found;
  }
  let fnRecipes = null;
  if (ecoMode === 'v1') {
    fnRecipes = resolveRecipes(src);
  } else {
    const rc = modeOf(src, /([A-Za-z_$][\w$]*)\(\([\w$]*\.level\|\|0\)\+1\)/g, 1);
    fnRecipes = rc.name || null;
    log('v2 菜谱函数形态（FN((X.level||0)+1)）: ' + (rc.name || '未找到') + ' 命中' + rc.count + '次');
  }
  if (!fnRecipes) {
    throw new PatchError(PATCH, '菜谱函数', (ecoMode === 'v1' ? '未找到 `const A=(X.level||0)+1,B=FN(A)` 形态' : 'FN((X.level||0)+1) 形态未找到'), []);
  }
  sym['__RH_FN_RECIPES__'] = fnRecipes;

  // ---------- 7. 注入 ----------
  const injectRaw = fs.readFileSync(path.join(__dirname, ecoMode === 'v2' ? 'eco_inject.v2.js' : 'eco_inject.js'), 'utf8').trim();
  let inject = injectRaw;
  for (const ph of Object.keys(sym)) inject = inject.split(ph).join(sym[ph]);
  if (inject.indexOf('__RH_FN_') >= 0) {
    const left = (inject.match(/__RH_FN_[\w]+__/g) || []).filter((v, i, a) => a.indexOf(v) === i);
    throw new PatchError(PATCH, '占位符替换', '未完全替换: ' + left.join(', '), []);
  }
  // 注入体以逗号衔接（不结束 const 多声明）：...}), __rhEcoModBind9=(function(){...})(), vM=...
  // 注意：注入体本身不能以分号结尾，否则会切断外层 const 声明（ESM 严格模式报 ReferenceError）
  const wrapped = '\n' + inject + ',\n';
  return src.slice(0, insertAt) + wrapped + src.slice(insertAt);
}

module.exports = { patch };

// ---------- CLI 兼容模式 ----------
if (require.main === module) {
  const file = process.argv[2];
  if (!file) { console.error('用法: node apply_eco.js <AppContent-*.js>'); process.exit(1); }
  let src = fs.readFileSync(file, 'utf8');
  try {
    src = patch({ src, log: m => console.log('[' + PATCH + '] ' + m) });
    fs.writeFileSync(file, src, 'utf8');
    console.log(`[${PATCH}] 写入完成: ${file} (${src.length} 字符)`);
  } catch (e) {
    console.error(String(e.message || e));
    process.exit(1);
  }
}
