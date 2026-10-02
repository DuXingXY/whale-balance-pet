'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { validateProfile, publicProfile } = require('./profiles.cjs');
const skins = require('../assets/skins.json');
function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = file + '.' + process.pid + '.tmp';
  fs.writeFileSync(temp, JSON.stringify(value, null, 2), { mode: 0o600 }); fs.renameSync(temp, file);
}
class Store {
  constructor(dir, crypto) {
    this.dir = dir; this.crypto = crypto; this.file = path.join(dir, 'sites.json');
    this.data = { version: 1, sites: [], selected: '', preferences: { pinned: true, petSize: 190, skin: 'default', snap: true, bubbleMode: 'all', bubbleSeconds: 10, clickSound: true, clickVolume: 70 }, position: null };
    if (fs.existsSync(this.file)) {
      let d; try { d = JSON.parse(fs.readFileSync(this.file, 'utf8')); } catch { throw new Error('站点设置文件损坏，请保留文件并检查'); }
      if (d.version !== 1 || !Array.isArray(d.sites)) throw new Error('站点设置版本无效');
      this.data = { ...this.data, ...d, preferences: { ...this.data.preferences, ...d.preferences } };
    }
    if (typeof this.data.preferences.skin !== 'string' || !Object.hasOwn(skins, this.data.preferences.skin)) this.data.preferences.skin = 'default';
  }
  persist() { writeJson(this.file, this.data); }
  get(id) { return this.data.sites.find(p => p.id === id); }
  key(p) { if (!p.keyCipher) return ''; return this.crypto.decrypt(p.keyCipher); }
  draft(input) { const previous = input.id ? this.get(input.id) : undefined; if (input.id && !previous) throw new Error('该站点已被删除'); const p = validateProfile(input, previous); return { profile: p, key: p.key || (previous ? this.key(previous) : '') }; }
  save(input) {
    const { profile: p } = this.draft(input);
    if (p.key) p.keyCipher = this.crypto.encrypt(p.key);
    delete p.key;
    const index = this.data.sites.findIndex(x => x.id === p.id);
    if (index < 0) this.data.sites.push(p); else this.data.sites[index] = p;
    if (!this.data.selected) this.data.selected = p.id;
    this.persist(); return publicProfile(p);
  }
  remove(id) { this.data.sites = this.data.sites.filter(x => x.id !== id); if (this.data.selected === id) this.data.selected = this.data.sites[0]?.id || ''; this.persist(); }
  select(id) { if (!this.get(id)) throw new Error('站点不存在'); this.data.selected = id; this.persist(); }
  preferences(p) {
    if (typeof p.pinned === 'boolean') this.data.preferences.pinned = p.pinned;
    if (typeof p.snap === 'boolean') this.data.preferences.snap = p.snap;
    if ([150, 190, 230].includes(p.petSize)) this.data.preferences.petSize = p.petSize;
    if (typeof p.skin === 'string' && Object.hasOwn(skins, p.skin)) this.data.preferences.skin = p.skin;
    if (['all', 'selected'].includes(p.bubbleMode)) this.data.preferences.bubbleMode = p.bubbleMode;
    if ([0, 5, 10, 20].includes(p.bubbleSeconds)) this.data.preferences.bubbleSeconds = p.bubbleSeconds;
    if (typeof p.clickSound === 'boolean') this.data.preferences.clickSound = p.clickSound;
    if (typeof p.clickVolume === 'number' && Number.isFinite(p.clickVolume) && p.clickVolume >= 0 && p.clickVolume <= 100) this.data.preferences.clickVolume = Math.round(p.clickVolume);
    this.persist();
  }
  public() { return { sites: this.data.sites.map(publicProfile), selected: this.data.selected, preferences: this.data.preferences }; }
}
module.exports = { Store, writeJson };
