import assert from 'node:assert/strict';
import test from 'node:test';

const data = {};

globalThis.chrome = {
  storage: {
    local: {
      async get(keys) {
        await new Promise(resolve => setTimeout(resolve, 5));
        if (keys === null) return structuredClone(data);
        const list = Array.isArray(keys) ? keys : [keys];
        return Object.fromEntries(list.filter(key => key in data).map(key => [key, structuredClone(data[key])]));
      },
      async set(items) {
        await new Promise(resolve => setTimeout(resolve, 5));
        Object.assign(data, structuredClone(items));
      }
    },
    onChanged: {
      addListener() {},
      removeListener() {}
    }
  }
};

const { deleteMapItem, getMap, setMapItem } = await import('../js/storage/storage-base.js');

test.beforeEach(() => {
  for (const key of Object.keys(data)) delete data[key];
});

test('同一 Map 的并发写入不会互相覆盖', async () => {
  await Promise.all([
    setMapItem('wallets', 'wallet-1', { name: 'A' }),
    setMapItem('wallets', 'wallet-2', { name: 'B' }),
    setMapItem('wallets', 'wallet-3', { name: 'C' })
  ]);

  assert.deepEqual(await getMap('wallets'), {
    'wallet-1': { name: 'A' },
    'wallet-2': { name: 'B' },
    'wallet-3': { name: 'C' }
  });
});

test('同一 Map 的删除与写入按调用顺序生效', async () => {
  data.wallets = { existing: { name: 'old' } };

  await Promise.all([
    deleteMapItem('wallets', 'existing'),
    setMapItem('wallets', 'new', { name: 'new' })
  ]);

  assert.deepEqual(await getMap('wallets'), { new: { name: 'new' } });
});
