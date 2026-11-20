/**
 * 知行图标准派生:SLIP-0010 ed25519,m/44'/1105'/account'/0'/0'。
 * 官方向量来自 SLIP-0010「Test vector 1 for ed25519」;KDG 固定样例与知行图节点
 * node/src/crypto.rs::kdg_standard_seed_fixture_matches_wallet 共用——两边逐字节一致。
 * 助记词是 BIP-39 官方测试向量,不是任何真实用户的密钥。
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const { slip10Ed25519, zhixingStandardSeedFromMnemonic, zhixingSeedFromMnemonic, zhixingStandardPath } =
  await import('../js/chain/adapters/zhixing/keys.js');

const hex = (b) => Buffer.from(b).toString('hex');
const M12 = Array(11).fill('abandon').join(' ') + ' about';

test('SLIP-0010 ed25519 官方向量 1', () => {
  const seed = Uint8Array.from({ length: 16 }, (_, i) => i);
  assert.equal(hex(slip10Ed25519(seed, [])), '2b4be7f19ee27bbf30c667b642d5f4aa69fd169872f8fc3059c08ebae2eb19e7');
  assert.equal(hex(slip10Ed25519(seed, [0])), '68e0fe46dfb67e368c75379acec591dad19df3cde26e63b93a8e704f1dade7a3');
  assert.equal(hex(slip10Ed25519(seed, [0, 1])), 'b1d0bad404bf35da785a64ca1ac54b2617211d2777696fbffaf208f746ae84f2');
  assert.equal(hex(slip10Ed25519(seed, [0, 1, 2, 2, 1000000000])), '8f94d394a8e8fd6b1bc2f3f49f5c47e385281d5c17e65324b0f62483e37e8793');
});

test('KDG 标准路径与知行图节点一致;与旧规则不同', () => {
  assert.equal(zhixingStandardSeedFromMnemonic(M12, '', 0), '0xd16a35cc44e08e1e1370212fbc4a8843239c54e117f304ee970fca2cd5816ca4');
  assert.equal(zhixingStandardSeedFromMnemonic(M12, '', 1), '0xde531680773d61fd269879584ec74d573ca325909ea732ab82cd1b6029345b6b');
  assert.notEqual(zhixingSeedFromMnemonic(M12), zhixingStandardSeedFromMnemonic(M12, '', 0));
  assert.equal(zhixingStandardPath(2), "m/44'/1105'/2'/0'/0'");
});
