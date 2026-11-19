/**
 * 迁移:早期版本给波场测试网(Shasta / Nile)生成的地址用了前缀 0xa0(27 开头、35 位),
 * 测试网节点不认(validateaddress → "Length error"),别人转不进来,钱包自己也查不到余额。
 * 波场主网与测试网的地址前缀都是 0x41(T 开头)。
 *
 * 这里把存储里这类地址换成同一把密钥的 T 地址:只换前缀,不需要私钥,也不需要钱包密码。
 * 每次启动执行;已经是 T 地址的不动,所以重复执行没有影响。
 *
 * 迁移范围:账户地址,以及网站授权里记下的地址。交易记录里的旧地址不迁移——那些转账用的地址
 * 节点本来就不接受,不会上链;记录里的地址还被转成了小写,无法还原。
 */
import { upgradeLegacyTronAddress } from '../../chain/adapters/tron/base58check.js';
import { getAccounts, saveAccount, getSelectedAccount } from '../../storage/account-storage.js';
import { getAllAuthorizations } from '../../storage/permission-storage.js';
import { PermissionStorageKeys } from '../../storage/storage-keys.js';
import { setMap } from '../../storage/storage-base.js';

/**
 * @returns {Promise<{ accounts: number, authorizations: number }>} 迁移了多少条
 */
export async function migrateLegacyTronTestnetAddresses() {
  let accounts = 0;
  let authorizations = 0;
  const renamed = new Map(); // 旧地址 → 新地址

  const all = await getAccounts();
  for (const account of Object.values(all || {})) {
    if (String(account?.namespace || '').toLowerCase() !== 'tron') continue;
    const next = upgradeLegacyTronAddress(account.address);
    if (!next || next === account.address) continue;
    renamed.set(account.address, next);
    await saveAccount({ ...account, address: next });
    accounts += 1;
  }

  if (renamed.size > 0) {
    const sites = await getAllAuthorizations();
    let changed = false;
    const nextSites = {};
    for (const [origin, permission] of Object.entries(sites || {})) {
      const p = { ...permission };
      let touched = false;
      if (renamed.has(p.address)) { p.address = renamed.get(p.address); touched = true; }
      if (Array.isArray(p.accounts)) {
        const mapped = p.accounts.map((a) => renamed.get(a) || a);
        if (mapped.some((a, i) => a !== p.accounts[i])) { p.accounts = mapped; touched = true; }
      }
      if (touched) { authorizations += 1; changed = true; }
      nextSites[origin] = p;
    }
    if (changed) await setMap(PermissionStorageKeys.CONNECTED_SITES, nextSites);
  }

  if (accounts > 0) {
    const selected = await getSelectedAccount().catch(() => null);
    console.log(`✅ 波场测试网地址已迁移为 T 地址:账户 ${accounts} 个,网站授权 ${authorizations} 条`, selected?.address || '');
  }
  return { accounts, authorizations };
}
