// Fixed-timestep simulation with render interpolation. The simulation always
// advances in STEP increments; render() receives alpha in [0,1) to blend the
// previous and current simulation states.

export const STEP = 1 / 60;

export function createLoop({ update, render, maxSteps = 6 }) {
  let acc = 0;
  let last = -1;
  let running = false;
  let raf = 0;          // pending frame request (cancelled on stop, so stop+start never runs two chains)
  const stats = { fps: 0, frames: 0, simSteps: 0, _t: 0, _n: 0 };

  function frame(now) {
    if (!running) return;
    const t = now / 1000;
    let dt = last < 0 ? STEP : t - last;
    last = t;
    if (dt > 0.25) dt = 0.25;
    acc += dt;
    let n = 0;
    while (acc >= STEP && n < maxSteps) {
      update(STEP);
      acc -= STEP;
      n++;
    }
    if (n === maxSteps) acc = 0;
    stats.simSteps += n;
    render(acc / STEP, dt);
    stats.frames++;
    stats._n++;
    stats._t += dt;
    if (stats._t >= 0.5) { stats.fps = stats._n / stats._t; stats._n = 0; stats._t = 0; }
    raf = requestAnimationFrame(frame);
  }

  return {
    stats,
    start() { if (!running) { running = true; last = -1; cancelAnimationFrame(raf); raf = requestAnimationFrame(frame); } },
    stop() { running = false; cancelAnimationFrame(raf); raf = 0; },
    // Deterministic advance used by tools: N fixed steps, then one render.
    advance(seconds) {
      const steps = Math.round(seconds / STEP);
      for (let i = 0; i < steps; i++) update(STEP);
      render(0, STEP);
    },
  };
}
