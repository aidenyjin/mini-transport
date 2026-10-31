# Mini Transport

A minimalist public transport designer. People are dots. They walk, drive or take the
bus to work, and your job is to make transit the better choice.

## Run it

Needs [Node.js](https://nodejs.org) (any recent version). There are no dependencies to
install.

```bash
npm start
```

Then open <http://localhost:8080>. To use another port: `node server.js 3000`.

## How it plays

- Every morning people leave home for work, and every evening they head back. Each person
  picks whatever is quickest for them: walking, driving, the bus, or driving to a
  park & ride and taking the bus from there.
- Cars only turn into people inside parking buildings. A car drives in, and a dot walks
  out. The ring on each parking building shows how full it is. When it's full, drivers
  circle off to find another lot, and if there's nowhere left they go home and miss work.
- Downtown parking fills up fast. Bus routes, bus lanes and park & rides are how you keep
  people getting to work.
- Fares and a small daily grant pay for it. Each bus costs upkeep at the end of the day.

## Controls

| | |
|---|---|
| **V** | Select: click a road to edit its lanes, a building to see it or demolish it, an empty lot to build a park & ride |
| **S** | Place bus stops beside roads |
| **R** | Draw a bus route: click stops in order, click the last one again to finish, or the first one to make a loop |
| **Space** | Pause |
| **1 2 3** | Normal, fast and fastest speed |
| **Esc** | Cancel or close |
| Drag, scroll, pinch | Pan and zoom (arrow keys and +/- also work) |

In the road editor, click a lane to switch it between a car lane and a bus lane. Hover a
lane to reverse it or remove it, and use the + buttons to add lanes. **Whole street**
applies your edits to every block of the street. A road with no lanes becomes a
pedestrian street.

## Code

Plain JavaScript modules and a canvas, with no build step.

| File | What's in it |
|---|---|
| `src/config.js` | Every tunable number: speeds, sizes, costs, clock |
| `src/sim.js` | The simulation: people, trips, cars, buses, parking, money |
| `src/roads.js` | Road graph, lane geometry, routing for cars, buses and walkers |
| `src/mapgen.js` | The starting city |
| `src/view.js` | Drawing everything on the canvas |
| `src/palette.js` | Day and night colours |
| `src/ui.js` | Status bar, toolbar, routes list, and the pop-up cards |
| `src/main.js` | Startup, camera, mouse and keyboard |
