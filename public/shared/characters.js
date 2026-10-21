// 角色與招式資料（伺服器與瀏覽器共用）
// 角色造型原型參考：仙劍奇俠傳一、軒轅劍外傳 天之痕 等 2D Q 版人物，名稱與美術皆為原創。
(function (root) {
  // 招式類型：
  //  atk    單段傷害            power
  //  multi  多段傷害            power, hits
  //  heal   回復氣血            power
  //  drain  傷害並吸取一半為氣血  power
  //  dot    持續傷害（每秒一跳） power, dur
  //  buff   自身增益            stat, amount, dur
  //  debuff 對手減益 + 少量傷害  stat, amount, dur, power
  // stat: atk(靈力) / def(防禦) / spd(身法)
  const CHARACTERS = [
    {
      id: 'lingfeng',
      name: '凌風',
      title: '御劍少俠',
      origin: '原型：仙劍一・李逍遙',
      stats: { hp: 1065, spi: 64, spd: 55, luck: 50, def: 50 },
      look: {
        skin: '#ffe0c4', hair: '#4a2c1a', hairStyle: 'spiky',
        main: '#3b6fb6', sub: '#f2f2f2', trim: '#e8c35a', band: '#c0392b',
        weapon: 'sword', aura: '#7fc8ff'
      },
      moves: [
        { name: '御劍', type: 'atk', power: 1.0, fx: 'swordbeam', desc: '以氣御劍，飛劍直取敵人' },
        { name: '劍氣斬', type: 'atk', power: 1.35, fx: 'slash', desc: '凝聚劍氣，橫斬一擊' },
        { name: '醉仙步', type: 'buff', stat: 'spd', amount: 0.8, dur: 10, refund: 35, fx: 'wind', desc: '立即回氣 35，身法 +80%（10 秒）' },
        { name: '天罡戰氣', type: 'buff', stat: 'atk', amount: 0.35, dur: 10, fx: 'aura', desc: '靈力 +35%（10 秒）' },
        { name: '萬劍歸宗', type: 'multi', power: 1.65, hits: 5, fx: 'swords', desc: '萬劍齊落，五段傷害' }
      ]
    },
    {
      id: 'lingyue',
      name: '靈月',
      title: '女媧後裔',
      origin: '原型：仙劍一・趙靈兒',
      stats: { hp: 915, spi: 72, spd: 52, luck: 52, def: 44 },
      look: {
        skin: '#ffe6d2', hair: '#3b2a5c', hairStyle: 'twinbuns',
        main: '#b77fd6', sub: '#fbe9ff', trim: '#f4c6e6', band: '#7a4fb0',
        weapon: 'staff', aura: '#e2a8ff'
      },
      moves: [
        { name: '雷咒', type: 'atk', power: 1.0, fx: 'thunder', desc: '召喚落雷轟擊敵人' },
        { name: '冰心訣', type: 'heal', power: 1.05, fx: 'heal', desc: '心如止水，回復氣血' },
        { name: '天雷破', type: 'atk', power: 1.35, fx: 'thunderbig', desc: '天降巨雷，威力強大' },
        { name: '五氣朝元', type: 'heal', power: 1.55, fx: 'healbig', desc: '五氣歸元，大量回復氣血' },
        { name: '冰封千里', type: 'debuff', stat: 'spd', amount: -0.35, dur: 7, power: 1.3, fx: 'ice', desc: '冰封敵人，傷害並降低身法 35%' }
      ]
    },
    {
      id: 'hongling',
      name: '紅綾',
      title: '鞭影俠女',
      origin: '原型：仙劍一・林月如',
      stats: { hp: 970, spi: 64, spd: 56, luck: 45, def: 50 },
      look: {
        skin: '#ffe0c8', hair: '#2a1a14', hairStyle: 'ponytail',
        main: '#d64545', sub: '#fff1e6', trim: '#f2b134', band: '#f2b134',
        weapon: 'whip', aura: '#ff8a65'
      },
      moves: [
        { name: '鳳舞', type: 'atk', power: 1.0, fx: 'whip', desc: '鞭如鳳舞，迅捷一擊' },
        { name: '怒火', type: 'buff', stat: 'atk', amount: 0.4, dur: 10, fx: 'fire', desc: '靈力 +40%（10 秒）' },
        { name: '連環鞭', type: 'multi', power: 1.4, hits: 3, fx: 'whipmulti', desc: '鞭影連環，三段傷害' },
        { name: '破甲擊', type: 'debuff', stat: 'def', amount: -0.4, dur: 8, power: 0.8, fx: 'crack', desc: '傷害並降低對手防禦 40%' },
        { name: '流星趕月', type: 'atk', power: 1.6, fx: 'meteor', desc: '如流星追月，重擊敵人' }
      ]
    },
    {
      id: 'aman',
      name: '阿蠻',
      title: '苗疆蠱女',
      origin: '原型：仙劍一・阿奴',
      stats: { hp: 980, spi: 56, spd: 60, luck: 66, def: 44 },
      look: {
        skin: '#f7d2b0', hair: '#1e1b2e', hairStyle: 'miao',
        main: '#2f6f6a', sub: '#e7f4ef', trim: '#d9dde3', band: '#c0c7d1',
        weapon: 'bell', aura: '#8ef0a0'
      },
      moves: [
        { name: '蠱毒', type: 'dot', power: 1.15, dur: 6, fx: 'poison', desc: '種下蠱毒，持續 6 秒傷害' },
        { name: '噬魂', type: 'drain', power: 1.0, fx: 'drain', desc: '吞噬魂魄，傷害並吸取一半氣血' },
        { name: '銀鈴咒', type: 'debuff', stat: 'spd', amount: -0.4, dur: 8, power: 0.7, fx: 'bells', desc: '傷害並降低對手身法 40%' },
        { name: '百草回春', type: 'heal', power: 1.45, fx: 'healbig', desc: '苗疆秘藥，大量回復氣血' },
        { name: '萬蠱蝕天', type: 'dot', power: 1.7, dur: 6, fx: 'swarm', desc: '萬蠱齊出，持續 6 秒重創' }
      ]
    },
    {
      id: 'jingyuan',
      name: '靖遠',
      title: '符劍少年',
      origin: '原型：天之痕・陳靖仇',
      stats: { hp: 1040, spi: 60, spd: 48, luck: 46, def: 62 },
      look: {
        skin: '#ffe0c4', hair: '#20160f', hairStyle: 'topknot',
        main: '#c99a2e', sub: '#fff6dc', trim: '#7a4b22', band: '#7a4b22',
        weapon: 'talisman', aura: '#ffe28a'
      },
      moves: [
        { name: '符火', type: 'atk', power: 1.0, fx: 'firetalisman', desc: '火符飛射，焚燒敵人' },
        { name: '破軍斬', type: 'atk', power: 1.35, fx: 'slash', desc: '破軍之勢，劈斬敵陣' },
        { name: '鎮妖符', type: 'debuff', stat: 'atk', amount: -0.3, dur: 8, power: 0.7, fx: 'talisman', desc: '傷害並降低對手靈力 30%' },
        { name: '真元護體', type: 'buff', stat: 'def', amount: 0.6, dur: 10, fx: 'shield', desc: '防禦 +60%（10 秒）' },
        { name: '雷霆萬鈞', type: 'atk', power: 1.6, fx: 'thunderbig', desc: '雷霆之力，萬鈞一擊' }
      ]
    },
    {
      id: 'yuer',
      name: '玉兒',
      title: '草原神箭',
      origin: '原型：天之痕・拓跋玉兒',
      stats: { hp: 990, spi: 57, spd: 62, luck: 54, def: 46 },
      look: {
        skin: '#f6d3b3', hair: '#5a2f1b', hairStyle: 'furhat',
        main: '#2d8a8a', sub: '#fdf3e1', trim: '#e07b39', band: '#f5efe4',
        weapon: 'bow', aura: '#9ff2e5'
      },
      moves: [
        { name: '風行', type: 'buff', stat: 'spd', amount: 0.8, dur: 10, refund: 35, fx: 'wind', desc: '立即回氣 35，身法 +80%（10 秒）' },
        { name: '狼嘯', type: 'debuff', stat: 'def', amount: -0.3, dur: 8, power: 0.7, fx: 'howl', desc: '傷害並降低對手防禦 30%' },
        { name: '穿雲箭', type: 'atk', power: 1.35, fx: 'arrow', desc: '一箭穿雲，直取要害' },
        { name: '連珠箭', type: 'multi', power: 1.4, hits: 3, fx: 'arrows', desc: '箭如連珠，三段傷害' },
        { name: '鷹擊長空', type: 'atk', power: 1.6, fx: 'eagle', desc: '蒼鷹撲擊，重創敵人' }
      ]
    }
  ];

  const STAT_LABELS = { hp: '血量', spi: '靈力', spd: '身法', luck: '吉運', def: '防禦' };

  // 棋盤填充用的常見字（增加誘答與畫面豐富度）
  const FILLER = '天地風雲山水火月星光心神龍虎鳳氣靈魂仙道法影刀魔血春秋日夜金石';

  // 重置指令（用念的）
  const RESET_WORDS = ['重置', '洗牌'];

  const byId = {};
  CHARACTERS.forEach(c => { byId[c.id] = c; });

  const api = { CHARACTERS, STAT_LABELS, FILLER, RESET_WORDS, byId };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.GameData = api;
})(typeof window !== 'undefined' ? window : globalThis);
