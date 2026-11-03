import { apiInitializer } from "discourse/lib/api";
import { i18n } from "discourse-i18n";
import KatamariGame from "../components/katamari-game.gjs";
import { decorateKatamari } from "../lib/katamari-content.js";

export default apiInitializer((api) => {
  const game = api.container.lookup("service:katamari");

  api.renderInOutlet("above-footer", KatamariGame);
  api.decorateCookedElement(
    (element) =>
      decorateKatamari(element, {
        label: i18n(themePrefix("katamari.start")),
        onActivate: (trigger) => game.start(trigger),
      }),
    { onlyStream: true }
  );
});
