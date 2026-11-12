import type { AccessLogDay, AccessLogRow } from "@/domain/privacy/access-log-days";
import { messagesHr as t } from "@/lib/i18n/messages.hr";

/**
 * DAN-294 (S-42, contract on #1836, c.6814737263): the student's own access
 * log as the server read it. Each stored opening is one row of five minutes
 * under its Zagreb day, the newest first; nothing is summed, counted or timed
 * (D-274 MQ10, PRODUCT §5 rule 17). A reader without a name pair is shown by
 * role alone. Rendered on the server: no state, no client code.
 */

const a = t.accessLog;

export function dayHeading(day: AccessLogDay): string {
  return `${a.weekdays[day.weekday]}, ${day.day}. ${day.month}. ${day.year}.`;
}

export function readerLabel(row: AccessLogRow): string {
  if (row.reader === null) return a.roleAlone[row.role];
  return `${row.reader.givenName} ${row.reader.familyName} · ${a.roles[row.role]}`;
}

function Row({ day, row }: { day: AccessLogDay; row: AccessLogRow }) {
  return (
    <li className="access-log__row">
      <time className="access-log__time" dateTime={`${day.key}T${row.from}`}>{`${row.from}–${row.to}`}</time>
      <span>{readerLabel(row)}</span>
      <span className="access-log__what">{a.surfaces[row.surface]}</span>
    </li>
  );
}

export function AccessLogDays({ days, olderHref }: { days: AccessLogDay[]; olderHref: string | null }) {
  if (days.length === 0) return <p className="access-log__note">{a.empty}</p>;
  return (
    <>
      {days.map((day) => (
        <section key={day.key} className="access-log__day" aria-labelledby={`dan-${day.key}`}>
          <h2 id={`dan-${day.key}`}>{dayHeading(day)}</h2>
          <ul className="access-log__rows">
            {day.entries.map((row) => <Row key={row.id} day={day} row={row} />)}
          </ul>
        </section>
      ))}
      {olderHref === null ? null : (
        // A plain link read on the server; the page re-reads every page up to it.
        <p><a className="access-log__more" href={olderHref}>{a.older}</a></p>
      )}
    </>
  );
}

export function AccessLogUnavailable({ retryHref }: { retryHref: string }) {
  return (
    <>
      <p className="access-log__note" role="alert">{a.unavailable}</p>
      <p><a className="access-log__more" href={retryHref}>{a.retry}</a></p>
    </>
  );
}
