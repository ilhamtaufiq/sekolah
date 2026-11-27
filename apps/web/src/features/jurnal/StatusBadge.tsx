import { JOURNAL_STATUS_LABEL, JOURNAL_STATUS_STYLE, type JournalStatus } from "./types";

export function StatusBadge({ status }: { status: JournalStatus }) {
  return (
    <span
      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${JOURNAL_STATUS_STYLE[status]}`}
    >
      {JOURNAL_STATUS_LABEL[status]}
    </span>
  );
}
