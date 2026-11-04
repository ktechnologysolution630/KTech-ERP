import { boolean, date, index, jsonb, pgTable, text, time, timestamp, uuid } from 'drizzle-orm/pg-core';
import { users } from './core';
import { projects } from './master';

/** Appointments on the project calendar (inspections, deliveries, meetings…). */
export const projectEvents = pgTable(
  'project_events',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    eventDate: date('event_date').notNull(),
    /** null = all day */
    startTime: time('start_time'),
    endTime: time('end_time'),
    note: text('note').default('').notNull(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index('project_events_project_date_idx').on(t.projectId, t.eventDate)],
);

export type DailyReportStatus = 'DRAFT' | 'SUBMITTED';
export type DailyWeather = 'SUNNY' | 'CLOUDY' | 'RAIN' | 'HEAVY_RAIN' | 'OTHER';

export type DailyWorkOutcome = 'COMPLETED' | 'DELAYED';

export interface DailyWorkLine {
  taskId: string | null;
  description: string;
  progressPercent: number | null;
  /** Reports written before this field existed have no outcome */
  outcome?: DailyWorkOutcome | null;
  note: string;
}
export interface DailyLabourLine {
  company: string;
  workers: number;
  hours: number;
}
export interface DailyEquipmentLine {
  type: string;
  hours: number;
}

/** Daily construction report (site diary). Photos are attachments with entityType DAILY_REPORT. */
export const dailyReports = pgTable(
  'daily_reports',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    number: text('number').notNull(),
    reportDate: date('report_date').notNull(),
    startTime: time('start_time'),
    endTime: time('end_time'),
    weatherMorning: text('weather_morning').$type<DailyWeather>().default('SUNNY').notNull(),
    weatherAfternoon: text('weather_afternoon').$type<DailyWeather>().default('SUNNY').notNull(),
    scheduleImpact: boolean('schedule_impact').default(false).notNull(),
    scheduleNote: text('schedule_note').default('').notNull(),
    work: jsonb('work').$type<DailyWorkLine[]>().default([]).notNull(),
    labour: jsonb('labour').$type<DailyLabourLine[]>().default([]).notNull(),
    equipment: jsonb('equipment').$type<DailyEquipmentLine[]>().default([]).notNull(),
    accident: boolean('accident').default(false).notNull(),
    safetyNote: text('safety_note').default('').notNull(),
    visitors: text('visitors').default('').notNull(),
    issues: text('issues').default('').notNull(),
    summary: text('summary').default('').notNull(),
    status: text('status').$type<DailyReportStatus>().default('DRAFT').notNull(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index('daily_reports_project_date_idx').on(t.projectId, t.reportDate)],
);
