import { apiInitializer } from "discourse/lib/api";
import { i18n } from "discourse-i18n";
import KatamariGame from "../components/katamari-game.gjs";
import { observeKatamari } from "../lib/katamari-content.js";

export default apiInitializer((api) => {
  const game = api.container.lookup("service:katamari");

  api.renderInOutlet("above-footer", KatamariGame);
  const decorate = (element) =>
    observeKatamari(element, {
      label: i18n(themePrefix("katamari.start")),
      onActivate: (trigger) => game.start(trigger),
    });

  api.decorateCookedElement(decorate, { onlyStream: true });
  api.decorateChatMessage?.(decorate);
});
