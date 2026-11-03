import { tracked } from "@glimmer/tracking";
import { action } from "@ember/object";
import Service, { service } from "@ember/service";
import { i18n } from "discourse-i18n";
import { requestTiltPermission } from "../lib/katamari-roller.js";

const MILESTONE = 25;

export default class Katamari extends Service {
  @service a11y;

  @tracked count = 0;
  @tracked round = null;

  start(trigger) {
    if (this.round) {
      return;
    }

    this.round = {
      trigger: new WeakRef(trigger),
      tiltPermission: requestTiltPermission(),
    };
    this.a11y.announce(i18n(themePrefix("katamari.started")));
  }

  @action
  updateScore(count) {
    const previousMilestone = Math.floor(this.count / MILESTONE);
    this.count = count;

    if (Math.floor(count / MILESTONE) > previousMilestone) {
      this.a11y.announce(i18n(themePrefix("katamari.score"), { count }));
    }
  }
}
