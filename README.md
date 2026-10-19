# Many Paths on the web

**https://benyahmanlunndev.github.io/many-paths/**

Recovery meetings from many fellowships in one list (AA, NA, Refuge Recovery, Recovery Dharma, CMA, Wellbriety
and local groups), for any phone or computer with a browser. It's the web version of the Many Paths Android app,
for iPhones and anyone who'd rather not install anything. On an iPhone, open it in Safari, tap Share, then
**Add to Home Screen** and it opens like an app.

- **Near me:** meetings around a town, ZIP code or your location, today or any day this week, with directions
- **Online:** meetings starting soon or on any day, in your own time zone, with an English-only filter
- **Saved:** tap the heart to keep a meeting
- **Phone lines:** local AA and NA lines near the chosen place, plus 988
- **Share:** a day's or a week's meetings as plain text, for a sponsor, a client or a friend
- **Works offline** with the last lists it loaded

No account, no ads, no tracking. See the [privacy policy](https://benyahmanlunndev.github.io/many-paths-data/privacy.html).

## How it works

There is no server. The page reads the daily copy of the public meeting lists that
[many-paths-data](https://github.com/BenyahmanLunnDev/many-paths-data) publishes to GitHub Pages:
`v1/sources.json` (which lists exist and where they cover), `v1/manifest.json` (which have a copy today),
`v1/feeds/<id>.json` (the meetings), `v1/places.json` (towns and ZIP codes, for searching without a lookup
service) and the phone lines. NA meetings near a place are asked live from NA's meeting database with a point
rounded to about 7 miles, exactly as the Android app does.

The parsing, time-zone and language rules are ports of the Android app's Kotlin code, and the tests reuse its cases.

| File | What it does |
|---|---|
| `js/app.js` | Screens and taps |
| `js/data.js` | Downloads lists from the daily copy |
| `js/parse.js` | Meeting Guide (12 Step Meeting List) and BMLT (NA) formats |
| `js/time.js` | Weekly meetings on the calendar, across time zones |
| `js/rows.js` | Near me, Online and Saved lists |
| `js/language.js`, `js/labels.js` | English-only detection, meeting type names |
| `js/places.js` | Town and ZIP search, phone lines |
| `js/share.js` | Text for sharing |
| `sw.js` | Offline copy of the app and the last lists |

No build step and no dependencies: the files are served as they are.

## Working on it

```
python -m http.server 8000      # then open http://localhost:8000/
npm test                         # node --test, Node 20 or newer
```

When you change a file, bump `VERSION` in `sw.js` so phones pick up the new copy.

## License

GPL-3.0-or-later. Meeting details belong to the groups that publish them.
