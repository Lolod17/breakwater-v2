import assert from 'node:assert/strict';

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => { store.set(k, String(v)); },
  removeItem: (k) => { store.delete(k); },
};

try {
  const { on } = await import('../game/src/core/events.js');
  const wallet = await import('../game/src/econ/wallet.js');
  const shop = await import('../game/src/econ/shop.js');

  const events = [];
  on('shop:bought', (p) => events.push(p));

  const start = wallet.balance();
  assert.equal(start, 250, 'fresh wallet starts at $250');
  assert.deepEqual(shop.shops(), ['clothing', 'hardware'], 'two shops: clothing and hardware');

  const pick = (shopId, itemId) => shop.items(shopId).find((i) => i.id === itemId);
  const jacket = pick('clothing', 'jacket');
  const cutters = pick('hardware', 'cutters');
  const toolbox = pick('hardware', 'toolbox');
  assert.ok(jacket && cutters && toolbox, 'catalog items exist with name, price, stock');
  assert.ok(toolbox.price > start - jacket.price - cutters.price, 'toolbox must cost more than the remaining balance');

  const jacketStock = shop.stock('clothing', 'jacket');
  assert.equal(shop.buy('clothing', 'jacket'), true, 'clothing buy must succeed');
  assert.equal(shop.stock('clothing', 'jacket'), jacketStock - 1, 'clothing stock must drop by 1');
  assert.equal(wallet.balance(), start - jacket.price, 'balance must drop by the clothing price');

  const cuttersStock = shop.stock('hardware', 'cutters');
  assert.equal(shop.buy('hardware', 'cutters'), true, 'hardware buy must succeed');
  assert.equal(shop.stock('hardware', 'cutters'), cuttersStock - 1, 'hardware stock must drop by 1');
  assert.equal(wallet.balance(), start - jacket.price - cutters.price, 'balance must drop by the hardware price');

  assert.equal(events.length, 2, 'each successful buy emits shop:bought');
  assert.deepEqual(events.map((e) => [e.shop, e.itemId, e.price]), [['clothing', 'jacket', jacket.price], ['hardware', 'cutters', cutters.price]]);
  assert.equal(events[1].stock, cuttersStock - 1);
  assert.equal(events[1].balance, wallet.balance());

  const brokeBalance = wallet.balance();
  const toolboxStock = shop.stock('hardware', 'toolbox');
  assert.equal(shop.buy('hardware', 'toolbox'), false, 'buy above balance must return false');
  assert.equal(shop.stock('hardware', 'toolbox'), toolboxStock, 'refused buy must not change stock');
  assert.equal(wallet.balance(), brokeBalance, 'refused buy must not change balance');
  assert.equal(events.length, 2, 'refused buy must not emit shop:bought');

  console.log(JSON.stringify({ start, bought: [['clothing', 'jacket', jacket.price], ['hardware', 'cutters', cutters.price]], balance: wallet.balance(), refused: { item: 'toolbox', price: toolbox.price, stock: shop.stock('hardware', 'toolbox') }, events: events.length, pass: true }));
  process.exit(0);
} catch (e) {
  console.error(JSON.stringify({ pass: false, failed: e.message }));
  process.exit(1);
}
