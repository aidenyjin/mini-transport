extends RefCounted
## Plain data types shared by the simulation, the view and the UI.

const LANE_CAR := 0
const LANE_BUS := 1

const B_HOUSE := 0
const B_APARTMENT := 1
const B_OFFICE := 2
const B_PARKING := 3       # city-owned parking downtown
const B_PARK_RIDE := 4     # player-built park & ride

const ZONE_RES := 0
const ZONE_MID := 1
const ZONE_CORE := 2
const ZONE_PARK := 3
const ZONE_WATER := 4

const V_CAR := 0
const V_BUS := 1

# Vehicle states
const VS_SPAWN := 0        # inside a building, waiting for a gap in traffic
const VS_LANE := 1
const VS_CROSS := 2        # moving through an intersection
const VS_PARK := 3         # driving into a building
const VS_GONE := 4

# Person states
const PS_HOME := 0
const PS_WORK := 1
const PS_WALK := 2
const PS_WAIT := 3         # at a bus stop
const PS_BOARD := 4        # stepping onto a bus
const PS_BUS := 5
const PS_CAR := 6
const PS_ENTER := 7        # stepping into a building
const PS_GONE := 8


class RNode:
	var id := 0
	var pos := Vector2.ZERO
	var segs: Array = []
	var hx := 0.0          # half-size of the intersection box, from crossing road widths
	var hy := 0.0


class Lane:
	var id := 0
	var seg := 0
	var dir := 1           # +1 travels a->b, -1 travels b->a
	var type := 0
	var w := 0.0           # animated width
	var closing := false   # no new traffic; removed once empty
	var flip := false      # no new traffic; reverses once empty
	var vehicles: Array = []   # front first (highest s first)
	var reserved := 0.0    # length claimed by vehicles turning into this lane
	var p0 := Vector2.ZERO
	var p1 := Vector2.ZERO
	var dirv := Vector2.RIGHT
	var length := 1.0
	var offset := 0.0      # sideways offset from the road's centre line

	func is_open() -> bool:
		return not closing and not flip

	## Direction traffic will use once any pending flip completes.
	func future_dir() -> int:
		return -dir if flip else dir

	func s_of(p: Vector2) -> float:
		return (p - p0).dot(dirv)

	func point(s: float) -> Vector2:
		return p0 + dirv * s


class Segment:
	var id := 0
	var a := 0
	var b := 0
	var lanes: Array = []  # left to right, looking from a towards b
	var width := 0.0       # animated road width
	var length := 1.0
	var dirv := Vector2.RIGHT
	var right := Vector2.DOWN
	var bridge := false


class Lot:
	var id := 0
	var rect := Rect2()
	var zone := 0
	var building := -1
	var cleared := false   # demolished by the player; the city won't build here again
	var access: Array = [] # [seg, t, side, door] options


class Building:
	var id := 0
	var type := 0
	var lot := 0
	var rect := Rect2()
	var seg := 0           # road the door opens onto
	var t := 0.5           # where along that road (0 = node a, 1 = node b)
	var side := 1          # which side of the road (+1 = right of a->b)
	var door := Vector2.ZERO
	var capacity := 0      # residents, jobs or parking spaces
	var people: Array = [] # residents or workers
	var parked := 0
	var incoming := 0      # cars on their way to park here
	var appear := 0.0
	var dying := false
	var ring := 0.0        # displayed fill of the capacity ring
	var flash := 0.0       # red pulse when a car is turned away
	var pulse := 0.0       # small bump when a car parks
	var shade := 0.0       # per-building colour variation


class Stop:
	var id := 0
	var seg := 0
	var t := 0.5
	var side := 1
	var pos := Vector2.ZERO
	var wait_center := Vector2.ZERO
	var outward := Vector2.ZERO
	var waiting: Array = []
	var ring := 0.0
	var appear := 0.0
	var dying := false


class Route:
	var id := 0
	var color := Color.WHITE
	var stops: Array = []  # stop ids in the order they were drawn
	var loop := false
	var buses: Array = []
	var seq: Array = []    # stops in visiting order, repeating
	var leg_len: Array = []    # road distance from seq[i] to seq[i + 1]
	var leg_pts: Array = []    # PackedVector2Array per leg, for drawing
	var cycle_len := 0.0
	var broken := false
	var riders_today := 0
	var appear := 0.0
	var dying := false


class Person:
	var id := 0
	var home := -1
	var work := -1
	var has_car := true
	var bias := 1.0        # >1 prefers driving
	var state := 0
	var to_work := true
	var legs: Array = []
	var leg_i := 0
	var mode := ""         # "car", "bus", "pr" (park & ride), "walk"
	var plan := {}         # details of the morning trip, mirrored in the evening
	var car_lot := -1      # where the car is parked, if not at home
	var leave_at := -1.0   # late leaver: minute to head home after arriving
	var missed := false
	# walking
	var path := PackedVector2Array()
	var path_len := 0.0
	var dist := 0.0
	var path_i := 0        # current path segment
	var path_d := 0.0      # distance at the start of that segment
	var speed := 13.0
	var jitter := 0.0
	var pos := Vector2.ZERO
	var pop := 1.0         # 0 -> 1 when appearing
	var vanish := 0.0      # 0 -> 1 when disappearing
	var anim := 0.0
	var anim_from := Vector2.ZERO
	var anim_to := Vector2.ZERO
	var after_enter := ""
	# transit
	var stop := -1
	var wait_since := 0.0
	var vehicle = null


class Vehicle:
	var id := 0
	var kind := 0
	var state := 0
	var length := 9.0
	var width := 4.6
	var vmax := 58.0
	var accel := 70.0
	var color := Color.GRAY
	var lane = null
	var s := 0.0
	var v := 0.0
	var hops: Array = []   # [seg, dir] pairs
	var hop_i := 0
	var target_pt := Vector2.ZERO  # centre-line point to stop at on the last hop
	var net_version := -1
	var wait_since := -1.0
	var stuck := 0.0
	# intersection
	var node := -1
	var from_lane = null
	var out_lane = null
	var c0 := Vector2.ZERO
	var c1 := Vector2.ZERO
	var c2 := Vector2.ZERO
	var c3 := Vector2.ZERO
	var cu := 0.0
	var clen := 1.0
	var cspeed := 1.0
	var samples := PackedVector2Array()
	# buildings
	var from_b := -1
	var to_b := -1
	var anim := 0.0
	var park_from := Vector2.ZERO
	var fade := 0.0        # > 0 while fading away
	# drawing
	var pos := Vector2.ZERO
	var ang := 0.0
	var vis_off := Vector2.ZERO
	var pop := 0.0
	# car
	var person = null
	var trip_start := 0.0
	var trip_est := 0.0
	# bus
	var route = null
	var seq_i := 0
	var passengers: Array = []
	var dwelling := false
	var dwell := 0.0
	var dwell_tick := 0.0
	var retiring := false
	var fare_acc := 0
