import Component from "@glimmer/component";
import { service } from "@ember/service";
import { modifier } from "ember-modifier";
import { i18n } from "discourse-i18n";
import KatamariRoller from "../lib/katamari-roller.js";

export default class KatamariGame extends Component {
  @service katamari;

  mount = modifier((element, [round]) => {
    const roller = new KatamariRoller(element, {
      trigger: round.trigger.deref(),
      tiltPermission: round.tiltPermission,
      onScore: this.katamari.updateScore,
    });
    return () => roller.destroy();
  });
  pulse = modifier((element, [count]) => {
    if (
      !count ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      return;
    }

    const animation = element.animate(
      [{ transform: "scale(1.12)" }, { transform: "scale(1)" }],
      { duration: 180, easing: "ease-out" }
    );
    return () => animation.cancel();
  });

  get score() {
    return i18n(themePrefix("katamari.score"), { count: this.katamari.count });
  }

  <template>
    {{#if this.katamari.round}}
      <div class="katamari" {{this.mount this.katamari.round}}>
        <button
          aria-label={{i18n (themePrefix "katamari.ball")}}
          class="katamari__ball"
          type="button"
        >
          <img
            alt=""
            class="katamari__logo"
            draggable="false"
            src={{settings.theme_uploads.katamari_logo}}
          />
        </button>
        <aside
          aria-label={{i18n (themePrefix "katamari.title")}}
          class="katamari__scoreboard"
        >
          <img
            alt=""
            class="katamari__badge-logo"
            draggable="false"
            src={{settings.theme_uploads.katamari_logo}}
          />
          <strong
            class="katamari__score"
            {{this.pulse this.katamari.count}}
          >{{this.score}}</strong>
        </aside>
      </div>
    {{/if}}
  </template>
}
