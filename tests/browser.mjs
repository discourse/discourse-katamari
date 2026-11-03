import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { after, before, test } from "node:test";
import { chromium } from "playwright";

const HTTP_OK = 200;
const HTTP_NOT_FOUND = 404;
const PIXEL_TOLERANCE = 1;
const ROOT = new URL("../", import.meta.url);
const collectedStyle = (
  await readFile(new URL("common/common.scss", ROOT), "utf8")
).match(/::highlight\(katamari-collected\)\s*\{[^}]+\}/)[0];
const fixture = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>
body { margin: 0; font: 18px/2 sans-serif; }
.cooked { padding: 100px; max-width: 650px; }
.katamari { position: fixed; inset: 0; pointer-events: none; }
.katamari__ball { position: absolute; transform: translate(-50%, -50%); border-radius: 50%; pointer-events: auto; touch-action: none; }
.is-rolling, .katamari__trigger.is-collected { visibility: hidden; }
${collectedStyle}
.katamari__effect { animation: pop 0.1s; }
@keyframes pop { to { opacity: 0; } }
</style></head><body><article class="topic-post"><div class="cooked">
<p>katamari alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron pi rho sigma tau upsilon phi chi psi omega.</p>
<p>KATAMARI! antikatamari katamaris 日本katamari.</p>
<p><a href="#">katamari link</a> <code>katamari code</code> <span class="spoiler">katamari spoiler</span></p>
<img alt="bumper" width="220" height="120" src="/assets/discourse.svg">
</div></article><input aria-label="Editor"><div class="katamari"><button class="katamari__ball" aria-label="Ball"></button></div>
<script type="module">
import Roller from "/javascripts/discourse/lib/katamari-roller.js";
import { decorateKatamari } from "/javascripts/discourse/lib/katamari-content.js";
window.original = document.querySelector(".cooked").textContent;
window.cleanup = decorateKatamari(document.querySelector(".cooked"), {
label: "Start", onActivate: (trigger) => {
window.game?.destroy();
window.score = 0;
window.game = new Roller(document.querySelector(".katamari"), {
trigger, onScore: (count) => window.score = count,
});
}
});
window.ready = true;
</script></body></html>`;
let browser;
let server;
let baseURL;

before(async () => {
  server = createServer(async (request, response) => {
    if (request.url === "/") {
      response.writeHead(HTTP_OK, { "Content-Type": "text/html" });
      response.end(fixture);
      return;
    }

    try {
      const url = new URL(`.${request.url}`, ROOT);
      const file = await readFile(url);
      response.writeHead(HTTP_OK, {
        "Content-Type": request.url.endsWith(".svg")
          ? "image/svg+xml"
          : "text/javascript",
      });
      response.end(file);
    } catch {
      response.writeHead(HTTP_NOT_FOUND);
      response.end();
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseURL = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ channel: "chromium", headless: true });
});

after(async () => {
  await browser?.close();
  await new Promise((resolve) => server?.close(resolve));
});

async function openPage(options = {}) {
  const page = await browser.newPage(options);
  await page.goto(baseURL);
  await page.waitForFunction(() => window.ready);
  return page;
}

test("whole-word triggers preserve protected content and clean up", async () => {
  const page = await openPage();
  assert.equal(await page.locator(".katamari__trigger").count(), 2);
  assert.equal(
    await page
      .locator(
        "a .katamari__trigger, code .katamari__trigger, .spoiler .katamari__trigger"
      )
      .count(),
    0
  );
  await page.evaluate(() => window.cleanup());
  assert.equal(
    await page.evaluate(
      () => document.querySelector(".cooked").textContent === window.original
    ),
    true
  );
  await page.close();
});

test("keyboard collection grows the ball and cleanup restores text", async () => {
  const page = await openPage();
  await page.locator(".katamari__trigger").first().click();
  const initial = await page.locator(".katamari__ball").boundingBox();
  await page.keyboard.down("ArrowRight");
  await page.waitForFunction(() => window.score >= 4);
  await page.keyboard.up("ArrowRight");
  assert.ok(
    (await page.locator(".katamari__ball").boundingBox()).width > initial.width
  );
  assert.ok((await page.locator(".katamari__attachment").count()) > 0);
  await page.evaluate(() => window.game.destroy());
  assert.equal(await page.locator(".katamari__word").count(), 0);
  assert.equal(await page.locator(".katamari__attachment").count(), 0);
  assert.equal(await page.locator(".is-rolling").count(), 0);
  assert.equal(
    await page.evaluate(
      () => document.querySelector(".cooked").textContent === window.original
    ),
    true
  );
  await page.close();
});

test("pause freezes movement and editing does not steal keyboard input", async () => {
  const page = await openPage();
  await page.locator(".katamari__trigger").first().click();
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  const initial = await page.locator(".katamari__ball").boundingBox();
  await page.keyboard.down("ArrowRight");
  await page.mouse.move(600, 100);
  await page.waitForTimeout(150);
  await page.keyboard.up("ArrowRight");
  assert.deepEqual(
    await page.locator(".katamari__ball").boundingBox(),
    initial
  );
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await page.locator("input").focus();
  await page.keyboard.type("wasd");
  assert.equal(await page.locator("input").inputValue(), "wasd");
  await page.close();
});

test("mouse steers and images block the ball", async () => {
  const page = await openPage();
  await page.locator(".katamari__trigger").first().click();
  const image = await page.locator("img").boundingBox();
  await page.mouse.move(image.x + image.width / 2, image.y + image.height / 2);
  await page.waitForTimeout(800);
  const bottom = await page.locator(".katamari__ball").evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return (
      rect.y +
      rect.height / 2 +
      parseFloat(getComputedStyle(element).height) / 2
    );
  });
  assert.ok(bottom <= image.y + 2, "the ball stops above the image");
  await page.close();
});

test("touch dragging steers the ball on a phone viewport", async () => {
  const page = await openPage({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const session = await page.context().newCDPSession(page);
  await page.locator(".katamari__trigger").first().tap();
  const ball = await page.locator(".katamari__ball").boundingBox();
  const x = ball.x + ball.width / 2;
  const y = ball.y + ball.height / 2;
  await session.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x, y }],
  });
  await session.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [{ x: x + 100, y: y + 50 }],
  });
  await page.waitForTimeout(250);
  await session.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  assert.ok(
    (await page.locator(".katamari__ball").boundingBox()).x > ball.x + 20
  );
  const bounds = await page.locator(".katamari__ball").boundingBox();
  assert.ok(
    bounds.x >= 0 && bounds.x + bounds.width <= 390,
    "the growing ball stays inside the viewport"
  );
  await page.close();
});

test("tilt starts automatically, calibrates, moves, and handles denial", async () => {
  const page = await openPage();
  await page.evaluate(() => {
    const addEventListener = window.addEventListener.bind(window);
    window.addEventListener = (type, ...args) => {
      if (type === "deviceorientation") {
        window.motionReady = true;
      }

      return addEventListener(type, ...args);
    };
  });
  await page.locator(".katamari__trigger").first().click();
  await page.waitForFunction(() => window.motionReady);
  const initial = await page.locator(".katamari__ball").boundingBox();
  await page.evaluate(() => {
    window.dispatchEvent(
      new DeviceOrientationEvent("deviceorientation", { beta: 0, gamma: 0 })
    );
    window.dispatchEvent(
      new DeviceOrientationEvent("deviceorientation", { beta: 0, gamma: 15 })
    );
  });
  await page.waitForFunction(
    (x) =>
      document.querySelector(".katamari__ball").getBoundingClientRect().x >
      x + 20,
    initial.x,
    { timeout: 2000 }
  );
  assert.ok(
    (await page.locator(".katamari__ball").boundingBox()).x > initial.x + 20
  );
  await page.reload();
  await page.waitForFunction(() => window.ready);
  await page.evaluate(() => {
    DeviceOrientationEvent.requestPermission = async () => "denied";
  });
  await page.locator(".katamari__trigger").first().click();
  const transform = await page
    .locator(".katamari__ball")
    .evaluate((element) => element.style.transform);
  await page.evaluate(() => {
    window.dispatchEvent(
      new DeviceOrientationEvent("deviceorientation", { beta: 0, gamma: 0 })
    );
    window.dispatchEvent(
      new DeviceOrientationEvent("deviceorientation", { beta: 0, gamma: 15 })
    );
  });
  await page.waitForTimeout(150);
  assert.equal(
    await page
      .locator(".katamari__ball")
      .evaluate((element) => element.style.transform),
    transform
  );
  await page.keyboard.down("ArrowRight");
  await page.waitForFunction(() => window.score > 2);
  await page.keyboard.up("ArrowRight");
  await page.close();
});

test("the growing ball stays inside the phone viewport at the edge", async () => {
  const page = await openPage({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  await page.locator(".katamari__trigger").first().tap();
  await page.keyboard.down("ArrowRight");
  await page.waitForTimeout(1000);
  await page.keyboard.up("ArrowRight");
  const right = await page.locator(".katamari__ball").evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return (
      rect.x + rect.width / 2 + parseFloat(getComputedStyle(element).width) / 2
    );
  });
  assert.ok(
    right <= page.viewportSize().width + PIXEL_TOLERANCE,
    "the circular ball remains on screen after rotation"
  );
  await page.close();
});

test("new page text joins as it renders", async () => {
  const page = await openPage();
  await page.locator(".katamari__trigger").first().click();
  await page.evaluate(() => {
    const heading = document.createElement("h2");
    heading.textContent = "Newlyloaded";
    heading.style.cssText = "position:absolute;left:450px;top:10px";
    document.body.append(heading);
  });
  const bounds = await page.locator("h2").boundingBox();
  await page.mouse.move(
    bounds.x + bounds.width / 2,
    bounds.y + bounds.height / 2
  );
  await page.waitForFunction(
    () =>
      [...CSS.highlights.get("katamari-collected")].some(
        (range) => range.toString() === "Newlyloaded"
      ),
    null,
    { timeout: 2000 }
  );
  await page.evaluate(() => window.game.destroy());
  assert.equal(
    await page.evaluate(() => CSS.highlights.has("katamari-collected")),
    false
  );
  await page.close();
});

test("reduced motion suppresses effects and rotation", async () => {
  const page = await openPage({ reducedMotion: "reduce" });
  await page.locator(".katamari__trigger").first().click();
  await page.keyboard.down("ArrowRight");
  await page.waitForFunction(() => window.score > 2);
  await page.keyboard.up("ArrowRight");
  assert.equal(await page.locator(".katamari__effect").count(), 0);
  assert.match(
    await page
      .locator(".katamari__ball")
      .evaluate((element) => element.style.transform),
    /rotate\(0deg\)/
  );
  await page.close();
});

test("collects navigation, headings, buttons, code, and newly rendered text without changing their nodes", async () => {
  const page = await openPage();
  await page.evaluate(() => {
    const header = document.createElement("header");
    header.style.cssText = "position:absolute;left:450px;top:10px";
    const heading = document.createElement("h1");
    heading.textContent = "Heading";
    const link = document.createElement("a");
    link.href = "#";
    link.textContent = "Navigation";
    link.addEventListener("click", (event) => {
      event.preventDefault();
      window.linkClicks = (window.linkClicks || 0) + 1;
    });
    const button = document.createElement("button");
    button.textContent = "Control";
    const code = document.createElement("code");
    code.textContent = "Example";
    header.append(heading, link, button, code);
    document.body.append(header);
    window.navigationNode = link.firstChild;
  });
  await page.locator(".katamari__trigger").first().click();
  for (const selector of [
    "header h1",
    "header a",
    "header button",
    "header code",
  ]) {
    const element = page.locator(selector);
    const text = await element.innerText();
    const bounds = await element.boundingBox();
    await page.mouse.move(
      bounds.x + bounds.width / 2,
      bounds.y + bounds.height / 2
    );
    await page.waitForFunction(
      (word) =>
        [...(CSS.highlights.get("katamari-collected") || [])].some(
          (range) => range.toString() === word
        ),
      text,
      { timeout: 2000 }
    );
  }
  assert.equal(
    await page.evaluate(
      () =>
        document.querySelector("header a").firstChild === window.navigationNode
    ),
    true
  );
  await page.locator("header a").click();
  assert.equal(await page.evaluate(() => window.linkClicks), 1);
  await page.evaluate(
    () => (document.querySelector("header h1").firstChild.data = "Updated")
  );
  const bounds = await page.locator("header h1").boundingBox();
  await page.mouse.move(
    bounds.x + bounds.width / 2,
    bounds.y + bounds.height / 2
  );
  await page.waitForFunction(
    () =>
      [...CSS.highlights.get("katamari-collected")].some(
        (range) => range.toString() === "Updated"
      ),
    null,
    { timeout: 2000 }
  );
  await page.evaluate(() => window.game.destroy());
  assert.equal(
    await page.evaluate(() => CSS.highlights.has("katamari-collected")),
    false
  );
  await page.close();
});

test("keyboard movement forgets the mouse target until the mouse moves again", async () => {
  const page = await openPage();
  await page.locator(".katamari__trigger").first().click();
  await page.mouse.move(400, 100);
  await page.waitForTimeout(800);
  await page.keyboard.down("ArrowLeft");
  await page.waitForTimeout(200);
  await page.keyboard.up("ArrowLeft");
  const stopped = await page.locator(".katamari__ball").boundingBox();
  await page.waitForTimeout(300);
  assert.deepEqual(
    await page.locator(".katamari__ball").boundingBox(),
    stopped
  );
  await page.mouse.move(410, 100);
  await page.waitForTimeout(200);
  assert.ok(
    (await page.locator(".katamari__ball").boundingBox()).x > stopped.x + 20
  );
  await page.close();
});

test("starting produces an audio signal and cleanup closes the context", async () => {
  const page = await openPage();
  await page.evaluate(() => {
    const NativeAudioContext = window.AudioContext;
    window.audioNotes = 0;
    window.audioPeak = 0;
    window.AudioContext = class extends NativeAudioContext {
      constructor() {
        super();
        window.audioContext = this;
      }

      createGain() {
        const gain = super.createGain();
        const analyser = this.createAnalyser();
        const samples = new Float32Array(analyser.fftSize);
        gain.connect(analyser);
        const sample = () => {
          analyser.getFloatTimeDomainData(samples);
          window.audioPeak = Math.max(
            window.audioPeak,
            ...samples.map(Math.abs)
          );

          if (window.audioPeak < 0.005) {
            requestAnimationFrame(sample);
          }
        };
        requestAnimationFrame(sample);
        return gain;
      }

      createOscillator() {
        window.audioNotes++;
        return super.createOscillator();
      }
    };
  });
  await page.locator(".katamari__trigger").first().click();
  await page.waitForFunction(() => window.audioNotes > 0, null, {
    timeout: 2000,
  });
  assert.equal(await page.evaluate(() => window.audioContext.state), "running");
  await page.waitForFunction(() => window.audioPeak > 0.005, null, {
    timeout: 2000,
  });
  await page.evaluate(() => window.game.destroy());
  assert.equal(await page.evaluate(() => window.audioContext.state), "closed");
  await page.close();
});

test("linked words visibly disappear even when the link disables selection", async () => {
  const page = await openPage();
  const clip = await page.evaluate(() => {
    const link = document.createElement("a");
    link.href = "#";
    link.textContent = "Linkedword";
    link.style.cssText =
      "position:absolute;left:450px;top:40px;display:inline-flex;user-select:none";
    document.body.append(link);
    window.testLink = link;
    const range = document.createRange();
    range.selectNodeContents(link);
    const rect = range.getBoundingClientRect();
    return {
      x: Math.floor(rect.left),
      y: Math.floor(rect.top),
      width: Math.ceil(rect.right) - Math.floor(rect.left),
      height: Math.ceil(rect.bottom) - Math.floor(rect.top),
    };
  });
  await page.evaluate(() => (window.testLink.style.visibility = "hidden"));
  const blank = await page.screenshot({ clip });
  await page.evaluate(() => (window.testLink.style.visibility = "visible"));
  await page.locator(".katamari__trigger").first().click();
  await page.mouse.move(clip.x + clip.width / 2, clip.y + clip.height / 2);
  await page.waitForFunction(
    () =>
      [...CSS.highlights.get("katamari-collected")].some(
        (range) => range.toString() === "Linkedword"
      ),
    null,
    { timeout: 2000 }
  );
  await page.mouse.move(700, 100);
  await page.waitForTimeout(800);
  assert.deepEqual(
    await page.screenshot({ clip }),
    blank,
    "the linked text leaves a blank space"
  );
  await page.close();
});

test("other katamari triggers are swallowed and restored with the page", async () => {
  const page = await openPage();
  const second = page.locator(".katamari__trigger").nth(1);
  const bounds = await second.boundingBox();
  await page.locator(".katamari__trigger").first().click();
  await page.mouse.move(
    bounds.x + bounds.width / 2,
    bounds.y + bounds.height / 2
  );
  await page.waitForFunction(
    () =>
      [...CSS.highlights.get("katamari-collected")].some(
        (range) => range.toString() === "KATAMARI"
      ),
    null,
    { timeout: 2000 }
  );
  assert.equal(
    await second.evaluate((element) => getComputedStyle(element).visibility),
    "hidden",
    "the word and its highlight disappear"
  );
  await page.evaluate(() => window.game.destroy());
  assert.equal(
    await second.evaluate((element) => getComputedStyle(element).visibility),
    "visible",
    "ending the round restores the trigger"
  );
  assert.equal(
    await page.evaluate(
      () => document.querySelector(".cooked").textContent === window.original
    ),
    true
  );
  await page.close();
});

test("cloaking the starting post keeps the ball moving", async () => {
  const page = await openPage();
  await page.locator(".katamari__trigger").first().click();
  const initial = await page.locator(".katamari__ball").boundingBox();
  await page.evaluate(() => document.querySelector(".topic-post").remove());
  await page.keyboard.down("ArrowRight");
  await page.waitForTimeout(250);
  await page.keyboard.up("ArrowRight");
  assert.equal(
    await page.evaluate(() => CSS.highlights.has("katamari-collected")),
    true,
    "the round survives removal of its starting post"
  );
  assert.ok(
    (await page.locator(".katamari__ball").boundingBox()).x > initial.x + 20
  );
  await page.close();
});

test("the ball carries more words as it grows, with bounded attachments", async () => {
  const page = await openPage();
  await page.locator(".katamari__trigger").first().click();
  await page.evaluate(() => {
    const words = document.createElement("div");
    words.id = "growth-words";
    words.style.cssText =
      "position:fixed;left:500px;top:80px;width:20px;font:0.1px/0.1px sans-serif;pointer-events:none";
    words.textContent = "growth ".repeat(40);
    document.body.append(words);
  });
  await page.mouse.move(510, 85);
  await page.waitForFunction(() => window.score >= 40);
  const small = await page.locator(".katamari__attachment").count();
  await page.evaluate(
    () =>
      (document.querySelector("#growth-words").textContent = "growth ".repeat(
        500
      ))
  );
  await page.waitForFunction(() => window.score >= 540);
  const large = await page.locator(".katamari__attachment").count();
  assert.ok(large > small, "a larger ball holds more words");
  assert.ok(large <= 120, "the visible cluster stays bounded");
  await page.close();
});

test("cloaked source posts can be garbage-collected during a round", async () => {
  const page = await openPage();
  await page.locator(".katamari__trigger").first().click();
  const second = await page.locator(".katamari__trigger").nth(1).boundingBox();
  await page.mouse.move(
    second.x + second.width / 2,
    second.y + second.height / 2
  );
  await page.waitForFunction(() =>
    document
      .querySelectorAll(".katamari__trigger")[1]
      .classList.contains("is-collected")
  );
  await page.evaluate(() => {
    const post = document.querySelector(".topic-post");
    post.setAttribute("data-katamari-leak-test", "origin");
    post.remove();
    window.cleanup = null;
  });
  await page.waitForTimeout(450);
  const session = await page.context().newCDPSession(page);
  await session.send("HeapProfiler.collectGarbage");
  const { detachedNodes } = await session.send("DOM.getDetachedDomNodes");
  assert.equal(
    detachedNodes.some(({ treeNode }) =>
      treeNode.attributes?.includes("data-katamari-leak-test")
    ),
    false,
    "the round does not retain its detached source post"
  );
  assert.equal(
    await page.evaluate(() =>
      [...CSS.highlights.get("katamari-collected")].every(
        (range) => range.startContainer.isConnected
      )
    ),
    true
  );
  await page.close();
});

test("moving over unchanged text does not rescan the whole page", async () => {
  const page = await openPage();
  await page.evaluate(() => {
    window.fullPageScans = 0;
    const createTreeWalker = document.createTreeWalker.bind(document);
    document.createTreeWalker = (root, ...args) => {
      if (root === document.body) {
        window.fullPageScans++;
      }
      return createTreeWalker(root, ...args);
    };
  });
  await page.locator(".katamari__trigger").first().click();
  await page.waitForFunction(() => window.fullPageScans > 0);
  const initialScans = await page.evaluate(() => window.fullPageScans);
  await page.mouse.move(400, 100);
  await page.waitForTimeout(1000);
  assert.equal(
    await page.evaluate(() => window.fullPageScans),
    initialScans,
    "movement and the game's own DOM updates do not rebuild the page index"
  );
  await page.close();
});

test("scrolling refreshes word geometry without rebuilding the text index", async () => {
  const page = await openPage();
  await page.evaluate(() => {
    const word = document.createElement("p");
    word.textContent = "Scrolledword";
    word.style.cssText = "position:absolute;top:1200px;left:500px";
    document.body.append(word);
  });
  await page.locator(".katamari__trigger").first().click();
  await page.evaluate(() => window.scrollTo(0, 900));
  const bounds = await page
    .getByText("Scrolledword", { exact: true })
    .boundingBox();
  await page.mouse.move(
    bounds.x + bounds.width / 2,
    bounds.y + bounds.height / 2
  );
  await page.waitForFunction(
    () =>
      [...CSS.highlights.get("katamari-collected")].some(
        (range) => range.toString() === "Scrolledword"
      ),
    null,
    { timeout: 3000 }
  );
  await page.close();
});

test("a late frame does not reduce keyboard movement to a small step", async () => {
  const page = await openPage();
  await page.locator(".katamari__trigger").first().click();
  await page.evaluate(() => {
    const requestFrame = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (callback) =>
      requestFrame((time) => {
        window.pendingGameFrame = callback;
        window.pendingGameTime = time;
      });
  });
  await page.waitForFunction(() => window.pendingGameFrame, null, {
    polling: 10,
  });
  await page.keyboard.down("ArrowRight");
  const distance = await page.evaluate(() => {
    const ball = document.querySelector(".katamari__ball");
    const initialRect = ball.getBoundingClientRect();
    const start = initialRect.x + initialRect.width / 2;
    window.pendingGameFrame(window.pendingGameTime + 100);
    const advancedRect = ball.getBoundingClientRect();
    return advancedRect.x + advancedRect.width / 2 - start;
  });
  assert.ok(distance >= 35, "the ball catches up after a 100 ms delay");
  await page.close();
});
