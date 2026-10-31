extends RefCounted
## Tunable numbers for the whole game, kept in one place so the feel can be adjusted
## without hunting through the code. Distances are world pixels; speeds are pixels per
## sim-second (one sim-second is one real second at 1x speed).

# --- Roads -----------------------------------------------------------------
const LANE_W := 7.0              # width of one lane
const CURB := 2.0                # extra road surface on each side of the outer lanes
const PED_W := 5.0               # width of a street with no lanes (pedestrians only)
const MAX_LANES := 6
const LANE_ANIM := 9.0           # how fast lanes slide open or closed
const BLOCK_INSET := 26.0        # gap between a road's centre line and the buildings
const LOT_GAP := 10.0            # gap between lots inside a block
const SIDEWALK := 3.5            # how far from the road edge people walk
const TURN_COST := 8.0           # routing penalty per intersection, in pixels

# --- Vehicles --------------------------------------------------------------
const CAR_LEN := 9.0
const CAR_W := 4.6
const CAR_SPEED := 58.0
const CAR_ACCEL := 70.0
const BUS_LEN := 19.0
const BUS_W := 5.6
const BUS_SPEED := 50.0
const BUS_ACCEL := 40.0
const BUS_CAP := 40
const GAP := 3.5                 # bumper-to-bumper gap when queued
const BRAKE_K := 2.6             # higher = brakes later and harder
const CONFLICT_D2 := 22.0        # squared distance at which two turning paths clash
const PARK_ANIM := 0.45          # seconds for a car to drive into a parking building

# --- Buses -----------------------------------------------------------------
const DWELL_MIN := 0.8           # seconds a bus waits at every stop
const BOARD_T := 0.1             # seconds per person getting on or off
const DWELL_EST := 1.6           # dwell time assumed when people plan trips
const STOP_CAP := 30             # waiting crowd size that fills a stop's ring

# --- People ----------------------------------------------------------------
const WALK_SPEED := 13.0
const DOT_R := 2.1
const WALK_RADIUS := 230.0       # furthest people will walk to a stop or from parking
const PR_WALK := 140.0           # furthest from a park & ride to its bus stop
const CAR_OWNERSHIP := 0.85
const AM_PEAK := 480.0           # morning departure peak, minutes after midnight
const AM_SPREAD := 32.0
const PM_PEAK := 1035.0
const PM_SPREAD := 30.0
const WALK_FACTOR := 1.3         # walking feels slower than it is
const WAIT_FACTOR := 1.6         # waiting feels slower still
const PARK_TIME := 2.0           # seconds of hassle added to every car trip
const GIVE_UP_MIN := 150.0       # game minutes someone waits at a stop before walking

# --- Clock -----------------------------------------------------------------
# Game minutes per sim-second at different times of day: rush hours run slowly so
# they can be watched, midday and night skip ahead. Pairs of [minute, rate].
const CLOCK_KEYS := [[0, 9.0], [330, 9.0], [380, 2.0], [600, 2.0], [640, 5.0], [900, 5.0],
		[940, 2.0], [1170, 2.0], [1220, 9.0], [1440, 9.0]]
const START_MINUTE := 330.0
const MAX_STEP := 1.0 / 30.0     # longest simulation sub-step

# --- City ------------------------------------------------------------------
const HOUSE_PEOPLE := [3, 4]
const APARTMENT_PEOPLE := [8, 12]
const OFFICE_JOBS := [22, 34]
const CITY_PARKING_CAP := 40
const PARK_RIDE_CAP := 30
const GROW_EVERY := 170.0        # game minutes between new buildings (during the day)

# --- Money -----------------------------------------------------------------
const START_MONEY := 3000
const FARE := 2
const DAILY_GRANT := 400
const BUS_UPKEEP := 50
const COST_LANE_ADD := 120
const COST_LANE_REMOVE := 20
const COST_LANE_FLIP := 30
const COST_LANE_TYPE := 40
const COST_STOP := 60
const COST_ROUTE := 250          # includes the route's first bus
const COST_BUS := 300
const COST_PARK_RIDE := 500
const COST_DEMOLISH := [250, 700, 1200, 600, 100]   # indexed by building type
