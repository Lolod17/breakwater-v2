// Mission probe: plays the five story missions in order on the seeded build with
// a scripted player (tools/mission_driver.mjs: keyboard-equivalent car controls,
// walking and key presses only), at fixed 60 Hz through the real game loop.
//   node tools/probe_missions.mjs [--port 8093] [--only N  (dev: just mission N from a save at its contact)]
// For each mission it reports the state transitions (briefing, started,
// objective:N, fail:reason, retry, success:+$) from the game's own mission log,
// the money counter before and after, attempts, and sim seconds.
// NO WITNESSES is deliberately failed once first (the courier never chases), to
// exercise the fail -> retry path. THE LAST ROUTE is played twice from the same
// save (taken before it starts), once per ending, so both endings are shown to
// be reachable and paid.
// Pass: every mission ends in success, money rises by exactly the reward, both
// endings reached, 0 console errors, 0 off-site requests.
import { launch, startServer, watchPage } from './cdp.mjs';
import { DRIVER, PLAY } from './mission_driver.mjs';

const argv = process.argv.slice(2);
const port = Number(argv.includes('--port') ? argv[argv.indexOf('--port') + 1] : 8093);
const only = argv.includes('--only') ? Number(argv[argv.indexOf('--only') + 1]) : null;   // dev: one mission
const server = await startServer(port);
const page = await launch({ port: 9335 });
const watch = watchPage(page, new URL(server.url).host);


const results = [];
try {
  await page.goto(`${server.url}?autostart&seed=1337${process.env.TRACE ? '&trace' : ''}`);
  await page.waitFor(() => page.evaluate('window.__game?.ready'), 60000);
  await page.evaluate(DRIVER);
  await page.evaluate(PLAY);
  await page.evaluate('window.__game.newGame(); window.__game.step(0)');   // step(0) holds the real-time loop: the probe owns the clock
  if (only !== null) {
    // dev shortcut: start at mission N from a save placed at its contact (not a pass run)
    const c = (await page.evaluate('window.__game.missionDefs()'))[only].contact;
    const save = { v: 1, money: 1000, mission: only, ending: null, checkpoint: { x: c.x, z: c.z, yaw: c.yaw }, wanted: 0, owned: null };
    await page.evaluate(`localStorage.setItem('breakwater.save', ${JSON.stringify(JSON.stringify(save))}); window.__game.continueGame(); window.__game.step(0)`);
    const r = await page.evaluate(`window.__probe.runMission(${only}, ${JSON.stringify({ ...(only === 4 ? { ending: argv.includes('--demo') ? 'deal' : 'press' } : {}), demoFail: argv.includes('--demo') })})`);
    console.log(JSON.stringify(r));
    if (process.env.TRACE) console.log(JSON.stringify(await page.evaluate('window.__trace.splice(0)')));
    await page.close(); server.stop(); process.exit(r.ok ? 0 : 1);
  }
  const plan = (argv.includes('--upto') ? [[0, {}], [1, {}], [2, { demoFail: true }], [3, {}]].slice(0, Number(argv[argv.indexOf('--upto') + 1]) + 1) : null) ?? [
    [0, {}], [1, {}], [2, { demoFail: true }], [3, {}],
  ];
  for (const [i, opts] of plan) {
    const r = await page.evaluate(`window.__probe.runMission(${i}, ${JSON.stringify(opts)})`);
    results.push(r);
    console.error(JSON.stringify(r));
    if (process.env.TRACE) console.error(JSON.stringify(await page.evaluate('window.__trace.splice(0)')));
  }
  // Both endings from the same pre-finale save.
  const before = await page.evaluate(`localStorage.getItem('breakwater.save')`);
  const press = await page.evaluate(`window.__probe.runMission(4, { ending: 'press' })`);
  results.push(press); console.error(JSON.stringify(press));
  if (process.env.TRACE) console.error(JSON.stringify(await page.evaluate('window.__trace.splice(0)')));
  await page.evaluate(`localStorage.setItem('breakwater.save', ${JSON.stringify(before)}); window.__game.continueGame(); window.__game.step(0)`);
  const deal = await page.evaluate(`window.__probe.runMission(4, { ending: 'deal', demoFail: true })`);
  results.push(deal); console.error(JSON.stringify(deal));
} catch (e) {
  results.push({ error: String(e.message || e) });
} finally {
  await page.close();
  server.stop();
}
const REWARD = { pickup: 300, cargo: 450, witness: 600, escort: 800 };
const checks = results.map((r) => r.ok && (r.mission === 'finale' ? r.gained === (r.ending === 'press' ? 500 : 2500) : r.gained === REWARD[r.mission]));
const endings = results.filter((r) => r.mission === 'finale' && r.ok).map((r) => r.ending);
const failRetry = results.find((r) => r.mission === 'witness');
const ledgerFail = results.find((r) => r.mission === 'finale' && r.ending === 'deal');
const out = {
  missions: results.map((r) => ({ mission: r.mission, ok: r.ok, attempts: r.attempts, failures: r.failures, moneyBefore: r.moneyBefore, moneyAfter: r.moneyAfter,
    transitions: r.transitions, simSeconds: r.simSeconds, beat: r.beat, ending: r.mission === 'finale' ? r.ending : undefined, error: r.error })),
  notCompleted: results.filter((r) => !r.ok).map((r) => r.mission ?? r.error),
  endings, failThenRetry: !!failRetry && failRetry.transitions?.includes('retry') && failRetry.ok,
  ledgerFailThenRetry: !!ledgerFail && ledgerFail.transitions?.some((t) => t.startsWith('rammed:')) && ledgerFail.failures?.[0] === 'Halden\'s crew took the ledger' && ledgerFail.ok,
  consoleErrors: watch.errors.length, offsiteRequests: watch.offsite.length,
};
out.pass = results.length === 6 && checks.every(Boolean) && endings.includes('press') && endings.includes('deal') && out.failThenRetry && out.ledgerFailThenRetry && !out.consoleErrors && !out.offsiteRequests;
if (watch.errors.length) out.errors = watch.errors.slice(0, 5);
console.log(JSON.stringify(out));
if (!out.pass) process.exitCode = 1;
