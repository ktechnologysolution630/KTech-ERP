import { boolean, date, doublePrecision, index, integer, numeric, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { type PositionSource, type TripExpenseKind, type TripStatus } from '@/domain/vehicle';
import { assets } from './assets';
import { users } from './core';
import { projects } from './master';

/** What the vehicle menu needs to know about a vehicle in the asset register */
export const vehicleProfiles = pgTable('vehicle_profiles', {
  assetId: uuid('asset_id')
    .primaryKey()
    .references(() => assets.id, { onDelete: 'cascade' }),
  plateNo: text('plate_no').default('').notNull(),
  /** Latest odometer reading, carried from the last return */
  odometerKm: numeric('odometer_km', { precision: 10, scale: 1 }),
  serviceEveryKm: integer('service_every_km'),
  lastServiceKm: numeric('last_service_km', { precision: 10, scale: 1 }),
  /** Off the booking list: in the garage, sold, kept for one person */
  bookable: boolean('bookable').default(true).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

/** One use of a vehicle, from the request to its return */
export const vehicleTrips = pgTable(
  'vehicle_trips',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    number: text('number').notNull(),
    assetId: uuid('asset_id')
      .notNull()
      .references(() => assets.id),
    requestedBy: uuid('requested_by')
      .notNull()
      .references(() => users.id),
    /** Who drives; the one who takes the vehicle out, records the trip and sends its position */
    driverId: uuid('driver_id')
      .notNull()
      .references(() => users.id),
    projectId: uuid('project_id').references(() => projects.id),
    purpose: text('purpose').notNull(),
    destination: text('destination').default('').notNull(),
    plannedStart: timestamp('planned_start', { withTimezone: true }).notNull(),
    plannedEnd: timestamp('planned_end', { withTimezone: true }).notNull(),
    status: text('status').$type<TripStatus>().default('REQUESTED').notNull(),
    decidedBy: uuid('decided_by').references(() => users.id),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    decisionNote: text('decision_note').default('').notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    startOdometerKm: numeric('start_odometer_km', { precision: 10, scale: 1 }),
    startFuel: integer('start_fuel'),
    startNote: text('start_note').default('').notNull(),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    endOdometerKm: numeric('end_odometer_km', { precision: 10, scale: 1 }),
    endFuel: integer('end_fuel'),
    endNote: text('end_note').default('').notNull(),
    damage: text('damage').default('').notNull(),
    /** Last known position, kept on the trip so the live map reads one row per vehicle */
    lastLat: doublePrecision('last_lat'),
    lastLng: doublePrecision('last_lng'),
    lastAccuracyM: integer('last_accuracy_m'),
    lastSpeedKmh: doublePrecision('last_speed_kmh'),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex('vehicle_trips_number_idx').on(t.number), index('vehicle_trips_asset_idx').on(t.assetId, t.plannedStart), index('vehicle_trips_status_idx').on(t.status)],
);

/** The route: every position received, from the driver's phone now and from a tracker later */
export const vehiclePositions = pgTable(
  'vehicle_positions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    assetId: uuid('asset_id')
      .notNull()
      .references(() => assets.id, { onDelete: 'cascade' }),
    /** Null for a tracker reporting while no trip is open */
    tripId: uuid('trip_id').references(() => vehicleTrips.id, { onDelete: 'cascade' }),
    lat: doublePrecision('lat').notNull(),
    lng: doublePrecision('lng').notNull(),
    accuracyM: integer('accuracy_m'),
    speedKmh: doublePrecision('speed_kmh'),
    /** When the device took the reading; it may arrive later if the phone was offline */
    recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull(),
    receivedAt: timestamp('received_at', { withTimezone: true }).defaultNow().notNull(),
    source: text('source').$type<PositionSource>().default('PHONE').notNull(),
  },
  (t) => [index('vehicle_positions_trip_idx').on(t.tripId, t.recordedAt), index('vehicle_positions_asset_idx').on(t.assetId, t.recordedAt)],
);

/** What a trip cost on the road; a receipt photo is attached to each */
export const vehicleTripExpenses = pgTable(
  'vehicle_trip_expenses',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tripId: uuid('trip_id')
      .notNull()
      .references(() => vehicleTrips.id, { onDelete: 'cascade' }),
    kind: text('kind').$type<TripExpenseKind>().notNull(),
    amount: numeric('amount', { precision: 14, scale: 2 }).notNull(),
    liters: numeric('liters', { precision: 8, scale: 2 }),
    paidOn: date('paid_on').notNull(),
    note: text('note').default('').notNull(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index('vehicle_trip_expenses_trip_idx').on(t.tripId)],
);
