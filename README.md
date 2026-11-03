# Katamari

Click **katamari** with the wavy underline in a post. Roll a Discourse logo ball around the page, collect words, and bump into images. The ball grows, words stick to it, and every 25 words gets a celebration.

## Play

- Mouse: move the pointer to steer.
- Touch: drag the ball. Scroll normally elsewhere to reach more words.
- Keyboard: arrows or WASD.
- Tilt: enabled automatically on supported devices. Your browser may ask for motion permission when you start; hold the phone comfortably to calibrate.
- Sound: collection notes and bump sounds start with the game.
- Reload the page to reset the game and restore every word. Scrolling, cloaked posts, and navigation within Discourse keep the round running.

The floating badge shows your score and pulses as you collect words. The game pauses while the page is in the background and resumes when you return.

All visible page text participates, including headings, navigation, links, buttons, and code. Editable fields, hidden content, unrevealed spoilers, and the game itself are excluded. Collected words disappear through the browser’s CSS Custom Highlight API, preserving the original text nodes, layout, event handlers, and Ember updates. Newly rendered text joins automatically. Images, videos, and frames across the page act as obstacles. Nothing is saved to the server or sent to another service.

Other katamari triggers can be collected too; their underline disappears with the word.

Keyboard movement forgets the previous mouse target; mouse steering resumes when the pointer moves again.

The score counts words. The ball stops growing at a readable size and adds more visible words as it grows, up to 120 reused attachment nodes. Reduced-motion preferences disable rotation and floating effects. The badge uses the site's palette in light and dark mode; score milestones use Discourse's accessibility announcements.

## Install

Under **Admin → Appearance → Themes & components**, install from `https://github.com/discourse/discourse-katamari`, then add the component to a theme.

For local development:

```sh
gem install discourse_theme
discourse_theme watch .
pnpm install
pnpm exec playwright install chromium
pnpm test:browser
pnpm lint
```

Run Discourse acceptance tests from a configured Discourse checkout:

```sh
RAILS_ENV=test bin/rails runner 'theme = RemoteTheme.import_theme_from_directory("/absolute/path/to/discourse-katamari"); puts theme.id'
bin/qunit --standalone --theme-id THE_PRINTED_ID --qunit-path /theme-qunit
```

Use `QUNIT_REUSE_BUILD=1` when a local frontend development build is already running. The shared Discourse theme workflow runs acceptance tests in CI; a separate Chromium job checks gameplay.

After importing updates into a running development instance with Rails, refresh its stylesheet metadata and notify connected browsers:

```ruby
Theme.expire_site_cache!
Stylesheet::Manager.cache.clear
theme.notify_theme_change(with_scheme: true)
```

Use the imported `theme` from `RemoteTheme.import_theme_from_directory`. This prevents new JavaScript from running with a previous compiled stylesheet.

The bundled SVG logo comes from the [official Discourse brand kit](https://www.discourse.org/brand). Discourse branding belongs to its owners.

## License

MIT. The Discourse logo is excluded from this license grant.
