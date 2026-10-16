import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.png': 'image/png'
};

function findBrowser() {
  const candidates = [
    process.env.CHROME_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
  ].filter(Boolean);
  return candidates[0];
}

async function serve() {
  const server = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url, 'http://localhost');
      const relative = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
      const target = path.resolve(root, `.${relative}`);
      if (!target.startsWith(root)) throw new Error('forbidden');
      const info = await stat(target);
      if (!info.isFile()) throw new Error('not a file');
      const body = await readFile(target);
      response.writeHead(200, {
        'Content-Type': MIME[path.extname(target)] || 'application/octet-stream',
        'Cache-Control': 'no-store'
      });
      response.end(body);
    } catch {
      response.writeHead(404);
      response.end('not found');
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { server, port: server.address().port };
}

const results = [];
function check(name, passed, detail = '') {
  results.push({ name, passed: Boolean(passed), detail });
  const mark = passed ? 'PASS' : 'FAIL';
  console.log(`${mark}  ${name}${detail ? `  ${detail}` : ''}`);
}

const { server, port } = await serve();
const browser = await chromium.launch({
  executablePath: findBrowser(),
  headless: true,
  args: [
    '--enable-unsafe-swiftshader',
    '--use-angle=swiftshader',
    '--disable-gpu-sandbox',
    '--no-sandbox',
    '--autoplay-policy=no-user-gesture-required'
  ]
});

const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const pageErrors = [];
const consoleErrors = [];
const failedRequests = [];
page.on('pageerror', (error) => pageErrors.push(String(error)));
page.on('console', (message) => {
  if (message.type() === 'error') consoleErrors.push(message.text());
});
page.on('response', (response) => {
  if (response.status() >= 400) failedRequests.push(`${response.status()} ${response.url()}`);
});

try {
  await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: 'load', timeout: 30000 });
  await page.waitForFunction(() => Boolean(window.__flightSim), null, { timeout: 30000 });
  check('页面与主程序加载', true);

  const titleVisible = await page.locator('#title-screen').isVisible();
  check('标题情景选择界面可见', titleVisible);

  const pickerVisible = await page.locator('[data-aircraft-card="b747-400"]').isVisible();
  check('标题页显示机型选择', pickerVisible);
  await page.locator('[data-aircraft-card="b747-8f"]').click();
  await page.waitForTimeout(300);
  const selected8f = await page.evaluate(() => ({
    type: window.__flightSim.aircraftType,
    stateType: window.__flightSim.state.aircraft.type,
    worldType: window.__flightSim.world.typeId,
    engineCount: window.__flightSim.state.engines.length,
    weight: window.__flightSim.state.weight,
    vr: window.__flightSim.spec().vr
  }));
  check('可切换机型到 747-8F', selected8f.type === 'b747-8f' && selected8f.stateType === 'b747-8f' && selected8f.worldType === 'b747-8f' && selected8f.engineCount === 4, JSON.stringify(selected8f));
  await page.locator('[data-aircraft-card="b747-400"]').click();
  await page.waitForTimeout(300);
  const selected400 = await page.evaluate(() => ({
    type: window.__flightSim.aircraftType,
    weight: window.__flightSim.state.weight,
    vr: window.__flightSim.spec().vr
  }));
  check('可切回 747-400 且重量更轻', selected400.type === 'b747-400' && selected400.weight < selected8f.weight, JSON.stringify({ selected400, weight8f: selected8f.weight }));

  await page.getByRole('button', { name: /冷舱启动/ }).click();
  await page.waitForTimeout(120);
  const hudVisible = await page.locator('#hud').isVisible();
  check('冷舱情景进入主 HUD', hudVisible);

  const cold = await page.evaluate(() => {
    const sim = window.__flightSim;
    const names = [];
    const act = (action, value) => {
      sim.action(action, value);
      names.push({ action, accepted: sim.state.lastAction?.accepted, reason: sim.state.lastAction?.reason });
    };
    act('battery');
    act('externalPower');
    act('avionics');
    act('apu');
    sim.step(6.4);
    act('apuBleed');
    act('electricPump1');
    act('packOff');
    act('startEngine1');
    sim.step(5.6);
    act('generator1');
    act('bleedAir');
    for (let index = 1; index < 4; index += 1) {
      act(`electricPump${index + 1}`);
      act(`startEngine${index + 1}`);
      sim.step(5.6);
      act(`generator${index + 1}`);
    }
    for (let index = 0; index < 3; index += 1) {
      sim.action('flaps', 'down');
      sim.step(7.3);
    }
    const spec = sim.spec();
    return {
      names,
      phase: sim.state.mission.phase,
      electrical: sim.state.systems.electricalPower,
      apu: sim.state.systems.apu.available,
      enginesRunning: sim.state.engines.map((engine) => engine.running),
      engineCount: sim.state.engines.length,
      generators: [...sim.state.systems.generators],
      flaps: sim.state.controls.flaps,
      targetFlap: spec.takeoffFlap,
      fuel: sim.state.fuel.qty,
      aircraftName: sim.state.aircraft.name,
      engineRows: document.querySelectorAll('#engine-rows [data-engine]').length,
      message: sim.state.messages.at(-1)?.text || ''
    };
  });
  check('冷舱联锁顺序全部接受', cold.names.every((item) => item.accepted !== false), JSON.stringify(cold.names.filter((item) => item.accepted === false)));
  check('747 四发与四发电机全部建立', cold.engineCount === 4 && cold.electrical && cold.apu && cold.generators.length === 4 && cold.generators.every(Boolean));
  check('四发慢车运转', cold.enginesRunning.length === 4 && cold.enginesRunning.every(Boolean));
  check('HUD 显示四台发动机', cold.engineRows === 4, `rows=${cold.engineRows}`);
  check('起飞襟翼按机型设置完成', Math.abs(cold.flaps - cold.targetFlap) < 0.2, `flaps=${cold.flaps.toFixed(1)}`);
  check('冷舱燃油正常消耗', cold.fuel < 100000, `fuel=${cold.fuel.toFixed(0)}`);

  const takeoff = await page.evaluate(() => {
    const sim = window.__flightSim;
    sim.start('takeoff');
    const spec = sim.spec();
    const state = sim.state;
    sim.action('parkingBrake', false);
    sim.action('throttle', 1);
    let steps = 0;
    while (state.onGround && state.status !== 'failed' && steps < 4000) {
      state.input.pitch = state.airspeed * 1.94384449 >= spec.vr
        ? Math.min(0.2, (0.2 - state.pitch) * 2)
        : 0;
      sim.step(0.1);
      steps += 1;
    }
    const liftoff = {
      onGround: state.onGround,
      phase: state.mission.phase,
      speedKt: state.stats.liftoffSpeed * 1.94384449,
      z: state.pos.z,
      outcome: state.outcome,
      specVr: spec.vr
    };
    let climb = 0;
    while (!state.onGround && state.status !== 'failed' && state.radioAltitude < 150 && climb < 2000) {
      state.input.pitch = Math.max(-0.2, Math.min(0.4,
        (0.15 - state.pitch) * 3 + (4 - state.verticalSpeed) * 0.04 - state.pitchRate * 1.2));
      state.controls.throttle = 1;
      sim.step(0.1);
      climb += 1;
    }
    liftoff.altitudeBeforeGear = state.radioAltitude;
    sim.action('gear', 'up');
    sim.step(9.2);
    liftoff.gearAfter = state.gear.position;
    liftoff.altitude = state.radioAltitude;
    liftoff.climbSteps = climb;
    liftoff.phaseAfterGear = state.mission.phase;
    return liftoff;
  });
  check('747 跑道起飞实际离地', takeoff.onGround === false && takeoff.phase !== 'failed', JSON.stringify(takeoff));
  check('离地速度接近机型 Vr', takeoff.speedKt > takeoff.specVr - 12 && takeoff.speedKt < takeoff.specVr + 18, `${takeoff.speedKt.toFixed(0)} kt / Vr ${takeoff.specVr}`);
  check('离地后起落架收起锁定', takeoff.gearAfter < 0.02 && takeoff.altitude > 40, JSON.stringify(takeoff));

  const approach = await page.evaluate(() => {
    const sim = window.__flightSim;
    sim.start('approach');
    const state = sim.state;
    const spec = sim.spec();
    const targetSpeed = spec.vApp30 + 3;
    const stable = () => {
      const distance = Math.max(0, -1800 - state.pos.z);
      const desiredAltitude = distance * 0.0524 + 40;
      const altitudeError = desiredAltitude - state.radioAltitude;
      let targetVs = -(state.airspeed * 0.0524) + altitudeError * 0.05;
      targetVs = Math.max(-5.5, Math.min(0.6, targetVs));
      if (state.radioAltitude < 10) targetVs = -0.6;
      const flightPath = Math.asin(Math.max(-0.4, Math.min(0.4, targetVs / Math.max(20, state.airspeed))));
      const desiredPitch = flightPath + 0.11;
      state.input.pitch = Math.max(-1, Math.min(1, (desiredPitch - state.pitch) * 5 - state.pitchRate * 1.5));
      state.input.roll = Math.max(-0.4, Math.min(0.4, -state.heading * 2.5));
      state.controls.throttle = Math.max(0.03, Math.min(1, state.controls.throttle + (targetSpeed - state.airspeed * 1.94384449) * 0.003));
    };
    let steps = 0;
    while (!state.onGround && state.status !== 'failed' && steps < 60000) {
      stable();
      sim.step(1 / 120);
      steps += 1;
    }
    state.controls.throttle = 0;
    return {
      onGround: state.onGround,
      phase: state.mission.phase,
      sink: state.stats.touchdownSink,
      result: state.stats.landingResult,
      outcome: state.outcome,
      detail: state.outcomeDetail,
      distance: state.stats.landingDistance,
      steps
    };
  });
  check('五边进近可实际接地', approach.onGround && approach.sink !== null, JSON.stringify(approach));
  check(
    '正常进近降落在跑道上且结果正确',
    approach.sink >= -2.2 && approach.result === '正常着陆' && !approach.outcome,
    `sink=${approach.sink?.toFixed(2)} result=${approach.result} outcome=${approach.outcome}`
  );

  const reverse = await page.evaluate(() => {
    const sim = window.__flightSim;
    const state = sim.state;
    sim.action('throttle', 0);
    sim.step(0.3);
    const beforeSpeed = state.groundSpeed;
    const spoilers = state.systems.groundSpoilers;
    sim.action('reverse', true);
    const accepted = state.lastAction?.accepted === true;
    sim.step(2.5);
    return {
      spoilers,
      accepted,
      beforeSpeed,
      afterSpeed: state.groundSpeed,
      n1: state.engines.map((engine) => engine.n1),
      thrust: state.engines.map((engine) => engine.thrust),
      reverse: state.controls.reverse
    };
  });
  check('接地后扰流板自动展开并解锁反推', reverse.spoilers && reverse.accepted && reverse.reverse, JSON.stringify(reverse));
  check('反推使 N1 上升并产生负推力减速', reverse.n1.every((value) => value > 0.5) && reverse.thrust.every((value) => value < 0) && reverse.afterSpeed < reverse.beforeSpeed - 4, JSON.stringify(reverse));

  const completion = await page.evaluate(() => {
    const sim = window.__flightSim;
    const state = sim.state;
    state.pos = { x: -80, y: 0, z: -600 };
    state.vel = { x: 0, y: 0, z: 5 };
    state.heading = Math.PI;
    state.controls.throttle = 0;
    state.controls.reverse = false;
    sim.step(0.5);
    return {
      outcome: state.outcome,
      phase: state.mission.phase,
      score: state.score,
      detail: state.outcomeDetail
    };
  });
  let resultsVisible = true;
  try {
    await page.waitForSelector('#results-screen:not([hidden])', { timeout: 6000 });
  } catch {
    resultsVisible = false;
  }
  check('脱离跑道后任务完成并生成评分', completion.outcome === 'complete' && completion.score > 0, JSON.stringify(completion));
  check('着陆成绩页自动显示', resultsVisible);

  const goAround = await page.evaluate(() => {
    const sim = window.__flightSim;
    sim.start('approach');
    const state = sim.state;
    const spec = sim.spec();
    const targetSpeed = spec.vApp30 + 3;
    const stable = () => {
      const distance = Math.max(0, -1800 - state.pos.z);
      const desiredAltitude = distance * 0.0524 + 40;
      const altitudeError = desiredAltitude - state.radioAltitude;
      let targetVs = -(state.airspeed * 0.0524) + altitudeError * 0.05;
      targetVs = Math.max(-5.5, Math.min(0.6, targetVs));
      if (state.radioAltitude < 10) targetVs = -0.6;
      if (state.mission.phase === 'goAround') targetVs = 1.5;
      else if (state.radioAltitude < 150) targetVs = -4.5;
      const flightPath = Math.asin(Math.max(-0.4, Math.min(0.4, targetVs / Math.max(20, state.airspeed))));
      const desiredPitch = flightPath + (state.mission.phase === 'goAround' ? 0.15 : 0.11);
      state.input.pitch = Math.max(-1, Math.min(1, (desiredPitch - state.pitch) * 5 - state.pitchRate * 1.5));
      state.input.roll = Math.max(-0.4, Math.min(0.4, -state.heading * 2.5));
      if (state.mission.phase === 'goAround') state.controls.throttle = 1;
      else state.controls.throttle = Math.max(0.03, Math.min(1, state.controls.throttle + (targetSpeed - state.airspeed * 1.94384449) * 0.003));
    };
    let steps = 0;
    let triggered = false;
    while (!state.onGround && state.status !== 'failed' && steps < 60000) {
      stable();
      if (state.mission.phase === 'goAround') triggered = true;
      if (triggered && state.verticalSpeed > 1 && state.radioAltitude > 150) break;
      sim.step(1 / 120);
      steps += 1;
    }
    return {
      triggered,
      recoveredPhase: state.mission.phase,
      verticalSpeed: state.verticalSpeed,
      radioAltitude: state.radioAltitude,
      count: state.mission.goAroundCount,
      outcome: state.outcome
    };
  });
  check('低高度大下降率触发复飞', goAround.triggered && goAround.count >= 1, JSON.stringify(goAround));
  check('复飞后建立正上升率并返回爬升', goAround.recoveredPhase === 'climb' && goAround.verticalSpeed > 0, JSON.stringify(goAround));

  const heavy = await page.evaluate(() => {
    const sim = window.__flightSim;
    sim.start('approach');
    const state = sim.state;
    state.pos = { x: 0, y: 0, z: -1650 };
    state.vel = { x: 0, y: -6, z: 68 };
    state.onGround = false;
    state.wasOnGround = false;
    state.radioAltitude = 1;
    sim.step(0.6);
    return { outcome: state.outcome, sink: state.stats.touchdownSink, detail: state.outcomeDetail, phase: state.mission.phase };
  });
  check('重着陆参数导致任务失败', heavy.outcome === 'heavyLanding' && heavy.sink < -3.6, JSON.stringify(heavy));

  const storage = await page.evaluate(() => {
    const sim = window.__flightSim;
    sim.start('takeoff');
    sim.action('throttle', 0.6);
    sim.step(2.5);
    const saved = sim.save();
    const before = { time: sim.state.time, phase: sim.state.mission.phase, throttle: sim.state.controls.throttle };
    sim.start('cold');
    sim.load();
    return {
      saved,
      before,
      after: { time: sim.state.time, phase: sim.state.mission.phase, throttle: sim.state.controls.throttle }
    };
  });
  check('本地存档保存并恢复飞行', storage.after.phase === storage.before.phase && Math.abs(storage.after.time - storage.before.time) < 1e-6, JSON.stringify(storage));

  const layout = await page.evaluate(() => ({
    header: document.getElementById('top-status').getBoundingClientRect().bottom,
    speed: document.getElementById('airspeed-panel').getBoundingClientRect().left,
    altitude: document.getElementById('altitude-panel').getBoundingClientRect().right,
    viewport: [window.innerWidth, window.innerHeight]
  }));
  check('宽屏 HUD 两侧仪表未重叠', layout.speed < layout.altitude, JSON.stringify(layout));

  await page.evaluate(() => window.__flightSim.start('takeoff'));
  await page.locator('#game canvas').hover();
  const beforeKeyboard = await page.evaluate(() => ({
    parkingBrake: window.__flightSim.state.controls.parkingBrake,
    throttle: window.__flightSim.state.controls.throttle
  }));
  await page.keyboard.press('KeyP');
  await page.keyboard.down('ShiftLeft');
  let throttleReached = true;
  try {
    await page.waitForFunction(() => window.__flightSim?.state.controls.throttle > 0.06, null, { timeout: 3000 });
  } catch {
    throttleReached = false;
  }
  await page.keyboard.up('ShiftLeft');
  const afterKeyboard = await page.evaluate(() => ({
    parkingBrake: window.__flightSim.state.controls.parkingBrake,
    throttle: window.__flightSim.state.controls.throttle
  }));
  check('键盘可松开停留刹车并推动油门', beforeKeyboard.parkingBrake === true && afterKeyboard.parkingBrake === false && throttleReached, JSON.stringify({ beforeKeyboard, afterKeyboard }));

  await page.keyboard.press('Digit5');
  await page.waitForTimeout(120);
  const apuByKey = await page.evaluate(() => window.__flightSim.state.systems.apu.switch);
  check('数字键 5 可接通 APU', apuByKey === true);

  await page.keyboard.press('Digit3');
  await page.waitForTimeout(120);
  const engineByKey = await page.evaluate(() => ({
    running: window.__flightSim.state.engines[2].running,
    count: window.__flightSim.state.engines.length,
    reason: window.__flightSim.state.lastAction?.reason || ''
  }));
  check('数字键 3 可切换发动机 3', engineByKey.count === 4 && engineByKey.running === false, JSON.stringify(engineByKey));

  await page.keyboard.down('ShiftLeft');
  await page.keyboard.press('Digit1');
  await page.keyboard.up('ShiftLeft');
  await page.waitForTimeout(120);
  const generatorByKey = await page.evaluate(() => ({
    generator1: window.__flightSim.state.systems.generators[0],
    engine1: window.__flightSim.state.engines[0].running
  }));
  check('Shift+1 可切换发电机 1（旧键位仍可用）', generatorByKey.generator1 === false && generatorByKey.engine1 === true, JSON.stringify(generatorByKey));

  await page.keyboard.down('AltLeft');
  await page.keyboard.press('Digit2');
  await page.keyboard.up('AltLeft');
  await page.waitForTimeout(120);
  const generatorAlt = await page.evaluate(() => ({
    generator2: window.__flightSim.state.systems.generators[1],
    engine2: window.__flightSim.state.engines[1].running
  }));
  check('Alt+2 可切换发电机 2（推荐键位）', generatorAlt.generator2 === false && generatorAlt.engine2 === true, JSON.stringify(generatorAlt));

  await page.keyboard.press('End');
  await page.waitForTimeout(150);
  const throttleFull = await page.evaluate(() => window.__flightSim.state.controls.throttle);
  await page.keyboard.press('Home');
  await page.waitForTimeout(150);
  const throttleIdle = await page.evaluate(() => window.__flightSim.state.controls.throttle);
  await page.keyboard.press('F3');
  await page.keyboard.press('F3');
  await page.waitForTimeout(120);
  const throttleStep = await page.evaluate(() => window.__flightSim.state.controls.throttle);
  await page.keyboard.down('PageUp');
  await page.waitForTimeout(1400);
  await page.keyboard.up('PageUp');
  const throttleUp = await page.evaluate(() => ({
    throttle: window.__flightSim.state.controls.throttle,
    readout: document.getElementById('throttle-value')?.textContent || ''
  }));
  check('End/Home/F3/PageUp 可控制油门并显示读数', throttleFull === 1 && throttleIdle === 0 && throttleStep > 0.05 && throttleUp.throttle > 0.15 && !/--/.test(throttleUp.readout), JSON.stringify({ throttleFull, throttleIdle, throttleStep, throttleUp }));

  const landingLightsBefore = await page.evaluate(() => window.__flightSim.state.systems.landingLights);
  await page.keyboard.press('KeyL');
  await page.waitForTimeout(120);
  const landingLightsAfter = await page.evaluate(() => window.__flightSim.state.systems.landingLights);
  check('按键 L 可切换着陆灯', landingLightsBefore !== landingLightsAfter, JSON.stringify({ landingLightsBefore, landingLightsAfter }));

  await page.evaluate(() => {
    const sim = window.__flightSim;
    sim.action('parkingBrake', false);
    sim.state.vel = { x: 0, y: 0, z: 8 };
    sim.step(0.1);
  });
  const headingBefore = await page.evaluate(() => window.__flightSim.state.heading);
  await page.keyboard.down('ArrowRight');
  await page.waitForTimeout(500);
  const steering = await page.evaluate(() => ({
    yawInput: window.__flightSim.state.input.yaw,
    heading: window.__flightSim.state.heading
  }));
  await page.keyboard.up('ArrowRight');
  check('地面方向键可作前轮/脚舵转向', steering.yawInput > 0.5 && steering.heading > headingBefore + 0.002, JSON.stringify({ headingBefore, steering }));

  await page.mouse.move(800, 450);
  await page.mouse.down();
  await page.mouse.move(940, 370, { steps: 6 });
  await page.waitForTimeout(140);
  const lookState = await page.evaluate(() => ({
    yaw: window.__flightSim.world.look.yaw,
    pitch: window.__flightSim.world.look.pitch,
    inputPitch: window.__flightSim.state.input.pitch
  }));
  await page.mouse.up();
  check('鼠标按住可 360° 环视且不影响操纵输入', lookState.yaw > 0.1 && lookState.pitch > 0.05 && Math.abs(lookState.inputPitch) < 0.01, JSON.stringify(lookState));

  await page.waitForTimeout(1200);
  const lookHeld = await page.evaluate(() => ({
    yaw: window.__flightSim.world.look.yaw,
    pitch: window.__flightSim.world.look.pitch
  }));
  check('松开鼠标后保持自由视角不回弹', lookHeld.yaw > 0.1 && lookHeld.pitch > 0.05, JSON.stringify(lookHeld));

  const lookAfterSwitch = await page.evaluate(() => {
    const sim = window.__flightSim;
    sim.action('camera', 'chase');
    return { yaw: sim.world.look.yaw, pitch: sim.world.look.pitch };
  });
  check('主动切换视角后视线回正', Math.abs(lookAfterSwitch.yaw) < 0.02 && Math.abs(lookAfterSwitch.pitch) < 0.02, JSON.stringify(lookAfterSwitch));

  const zoomStart = await page.evaluate(() => window.__flightSim.world.zoom);
  await page.mouse.move(800, 450);
  await page.mouse.wheel(0, -240);
  await page.waitForTimeout(120);
  const zoomIn = await page.evaluate(() => window.__flightSim.world.zoom);
  await page.mouse.wheel(0, 480);
  await page.waitForTimeout(120);
  const zoomOut = await page.evaluate(() => window.__flightSim.world.zoom);
  check('鼠轮向上放大、向下缩小视角', zoomStart === 1 && zoomIn > zoomStart && zoomOut < zoomIn, JSON.stringify({ zoomStart, zoomIn, zoomOut }));

  const zoomAfterSwitch = await page.evaluate(() => {
    const sim = window.__flightSim;
    sim.action('camera', 'cockpit');
    return sim.world.zoom;
  });
  check('切换视角后缩放恢复 100%', Math.abs(zoomAfterSwitch - 1) < 1e-6, String(zoomAfterSwitch));

  await page.close();
  const filePage = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const fileErrors = [];
  filePage.on('pageerror', (error) => fileErrors.push(String(error)));
  await filePage.goto(pathToFileURL(path.join(root, 'index.html')).href, { waitUntil: 'load', timeout: 30000 });
  await filePage.waitForFunction(() => Boolean(window.__flightSim), null, { timeout: 30000 });
  const offline = await filePage.evaluate(() => ({
    title: !document.getElementById('title-screen').hidden,
    webgl: window.__flightSim.world.webglAvailable,
    state: window.__flightSim.state.status,
    script: Boolean(document.querySelector('script[src="dist/game.js"]'))
  }));
  check('双击本地 HTML 离线启动成功', offline.title && offline.script && fileErrors.length === 0, JSON.stringify({ offline, fileErrors }));
  check('离线页面完成 WebGL 渲染初始化', offline.webgl === true, JSON.stringify(offline));
  await filePage.close();

  check('主程序无页面级异常', pageErrors.length === 0, pageErrors.join(' | '));
  const blockingConsole = consoleErrors.filter((text) => !/WebGL|SwiftShader|GroupMarker/i.test(text));
  const blockingRequests = failedRequests.filter((text) => !/favicon/.test(text));
  check('控制台无阻断性错误', blockingConsole.length === 0, blockingConsole.slice(0, 3).join(' | '));
  check('离线资源全部加载成功', blockingRequests.length === 0, blockingRequests.slice(0, 4).join(' | '));
} catch (error) {
  check('浏览器集成测试执行', false, String(error?.stack || error));
} finally {
  await browser.close();
  server.close();
}

const failed = results.filter((item) => !item.passed);
console.log(`\n${results.length - failed.length}/${results.length} 项浏览器集成检查通过`);
if (failed.length) process.exitCode = 1;
