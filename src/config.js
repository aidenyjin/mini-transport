// Tunable numbers for the whole game, kept in one place so the feel can be adjusted
// without hunting through the code. Distances are world pixels; speeds are pixels per
// sim-second (one sim-second is one real second at 1x speed).

export const C = {
  // --- Roads ---------------------------------------------------------------
  LANE_W: 8,              // width of one lane
  CURB: 2,                // extra road surface on each side of the outer lanes
  PED_W: 7,               // width of a street with no lanes (pedestrians only)
  MAX_LANES: 6,
  LANE_ANIM: 9,           // how fast lanes slide open or closed
  BLOCK_INSET: 30,        // gap between a road's centre line and the buildings
  LOT_GAP: 10,            // gap between lots inside a block
  SIDEWALK: 4.5,          // how far from the road edge people walk
  TURN_COST: 8,           // routing penalty per intersection, in pixels

  // --- Vehicles ------------------------------------------------------------
  CAR_LEN: 11,
  CAR_W: 5.6,
  CAR_SPEED: 58,
  CAR_ACCEL: 70,
  BUS_LEN: 23,
  BUS_W: 7,
  BUS_SPEED: 56,
  BUS_ACCEL: 40,
  BUS_CAP: 40,
  GAP: 4,                 // bumper-to-bumper gap when queued
  BRAKE_K: 2.6,           // higher = brakes later and harder
  CONFLICT_D2: 30,        // squared distance at which two turning paths clash
  PARK_ANIM: 0.45,        // seconds for a car to drive into a parking building
  GRIDLOCK_S: 45,         // seconds stuck before a car gives up and vanishes

  // --- Buses ---------------------------------------------------------------
  DWELL_MIN: 0.8,         // seconds a bus waits at every stop
  BOARD_T: 0.1,           // seconds per person getting on or off
  DWELL_EST: 1.6,         // dwell time assumed when people plan trips
  STOP_CAP: 30,           // waiting crowd size that fills a stop's ring

  // --- People --------------------------------------------------------------
  WALK_SPEED: 13,
  DOT_R: 2.2,
  WALK_RADIUS: 230,       // furthest people will walk to a stop or from parking
  PR_WALK: 140,           // furthest from a park & ride to its bus stop
  CAR_OWNERSHIP: 0.85,
  AM_PEAK: 480,           // morning departure peak, minutes after midnight
  AM_SPREAD: 32,
  PM_PEAK: 1035,
  PM_SPREAD: 30,
  WALK_FACTOR: 1.3,       // walking feels slower than it is
  WAIT_FACTOR: 1.6,       // waiting feels slower still
  PARK_TIME: 2,           // seconds of hassle added to every car trip
  GIVE_UP_MIN: 150,       // game minutes someone waits at a stop before walking

  // --- Clock ---------------------------------------------------------------
  // Game minutes per sim-second at different times of day: rush hours run slowly so
  // they can be watched, midday and night skip ahead. Pairs of [minute, rate].
  CLOCK_KEYS: [[0, 9], [330, 9], [380, 1.6], [600, 1.6], [640, 5], [900, 5],
    [940, 1.6], [1170, 1.6], [1220, 9], [1440, 9]],
  START_MINUTE: 375,
  MAX_STEP: 1 / 30,       // longest simulation sub-step

  // --- City ----------------------------------------------------------------
  HOUSE_PEOPLE: [3, 4],
  APARTMENT_PEOPLE: [8, 12],
  OFFICE_JOBS: [22, 34],
  CITY_PARKING_CAP: 40,
  PARK_RIDE_CAP: 30,
  GROW_EVERY: 170,        // game minutes between new buildings (during the day)

  // --- Money ---------------------------------------------------------------
  START_MONEY: 3000,
  FARE: 2,
  DAILY_GRANT: 400,
  BUS_UPKEEP: 50,
  COST_LANE_ADD: 120,
  COST_LANE_REMOVE: 20,
  COST_LANE_FLIP: 30,
  COST_LANE_TYPE: 40,
  COST_STOP: 60,
  COST_ROUTE: 250,        // includes the route's first bus
  COST_BUS: 300,
  COST_PARK_RIDE: 500,
  COST_DEMOLISH: [250, 700, 1200, 600, 100],   // indexed by building type
};
