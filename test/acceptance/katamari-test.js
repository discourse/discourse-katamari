import {
  click,
  currentURL,
  find,
  findAll,
  triggerKeyEvent,
  visit,
} from "@ember/test-helpers";
import { test } from "qunit";
import topicFixtures from "discourse/tests/fixtures/topic";
import { acceptance } from "discourse/tests/helpers/qunit-helpers";

acceptance("Katamari", function (needs) {
  needs.pretender((server, helper) => {
    const topic = structuredClone(topicFixtures["/t/280/1.json"]);
    topic.title = topic.fancy_title = "A katamari topic";
    topic.post_stream.posts[0].cooked =
      '<p>katamari rolls through words. KATAMARI!</p><p><code>katamari</code> <a href="/">katamari</a> antikatamari</p><aside class="onebox"><h3><a href="/t/another/281">Another katamari topic</a></h3></aside>';
    server.get("/t/280.json", () => helper.response(topic));
    server.get("/t/280/:post_number.json", () => helper.response(topic));
  });

  test("highlights whole words and keeps the round active until reload", async function (assert) {
    await visit("/t/internationalization-localization/280");
    assert
      .dom(".cooked .katamari__trigger")
      .exists({ count: 4 }, "plain and linked words become triggers");
    assert.dom("code .katamari__trigger").doesNotExist("code is preserved");
    assert
      .dom("a button.katamari__trigger")
      .doesNotExist("links contain no buttons");

    await click(".katamari__trigger");
    assert.dom(".katamari__ball").exists("the game starts");
    assert.dom(".katamari__scoreboard").exists("the score is visible");
    assert
      .dom(".katamari__scoreboard button")
      .doesNotExist("the badge has no controls");

    await triggerKeyEvent(find(".katamari__ball"), "keydown", "Escape");
    assert.dom(".katamari").exists("Escape keeps the round active");
    assert.true(
      CSS.highlights.has("katamari-collected"),
      "collection stays enabled"
    );
  });

  test("post oneboxes activate while topic titles stay untouched", async function (assert) {
    await visit("/t/internationalization-localization/280");
    assert.dom("#topic-title .fancy-title .katamari__trigger").doesNotExist();
    assert.dom(".onebox a .katamari__trigger").exists();

    const url = currentURL();
    await click(".onebox a .katamari__trigger");
    assert.dom(".katamari__ball").exists();
    assert.strictEqual(currentURL(), url);
  });

  test("navigation keeps the round running", async function (assert) {
    await visit("/t/internationalization-localization/280");
    await click(".katamari__trigger");
    const ball = find(".katamari__ball");
    await visit("/latest");
    assert.strictEqual(
      find(".katamari__ball"),
      ball,
      "the same ball is retained across navigation"
    );
    assert.dom(".katamari__ball").exists("the ball survives navigation");
    assert.dom(".katamari__scoreboard").exists("the score survives navigation");
    assert.true(
      CSS.highlights.has("katamari-collected"),
      "collection continues on the new page"
    );
  });

  test("other triggers keep the current round and minimal score badge", async function (assert) {
    await visit("/t/internationalization-localization/280");
    await click(".katamari__trigger");
    assert.dom(".katamari__scoreboard").exists("the score is visible");
    assert
      .dom(".katamari__controls")
      .doesNotExist("no options panel is rendered");
    assert
      .dom(".katamari__instructions")
      .doesNotExist("instructions do not cover the page");

    const ball = find(".katamari__ball");
    await click(findAll(".katamari__trigger")[1]);
    assert.strictEqual(
      find(".katamari__ball"),
      ball,
      "the existing ball is retained"
    );
    assert
      .dom(findAll(".katamari__trigger")[0])
      .hasClass("is-rolling", "the original trigger stays active");
    assert
      .dom(findAll(".katamari__trigger")[1])
      .doesNotHaveClass(
        "is-rolling",
        "another trigger does not restart the round"
      );
  });
});
