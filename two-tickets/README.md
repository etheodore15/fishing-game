# Two Tickets

A travel planner for couples. Each partner fills in their own wishes in
private (places, travel style, budget, leave, dealbreakers) and seals them.
The app merges both sets into one plan without saying who asked for what:

- **Shortlist**: places ranked by how much you both want them, with cost for
  two from your home city, trip length, flight time and best months.
- **Parked ideas**: places that clash with a dealbreaker or flight limit, with
  a reason that names nobody.
- **Roadmap**: dated trips over your planning period, scheduled when your
  shared savings and that year's leave cover them. Shared dreams go first,
  then each person's own picks take turns.
- **Travel styles**: how far apart you are on six axes, with a compromise tip
  wherever the gap is large.
- **What to work on**: goal insights such as savings targets, budget gaps and
  tight leave.

## Running it

It is a single static file with no build step and no dependencies.

```sh
python3 -m http.server 8000   # then open http://localhost:8000
```

Or open `index.html` directly, or host it on GitHub Pages.

Run standalone, the app uses **take turns on this device** mode: answers are
kept in the browser's `localStorage`. The two-phone mode (a shared plan code)
and the **Ask Claude** button use capabilities that are only available when
the page is published as a claude.ai Artifact; elsewhere those controls are
disabled or hidden.

## Notes

- Costs are planning estimates from a built-in table of about 65 destinations
  and 35 home cities, in USD. Places not in the table are accepted but get no
  cost estimate.
- Privacy is enforced by what the screens show, not by the storage. On a
  shared device, a sealed tag can be re-opened by whoever holds it.
