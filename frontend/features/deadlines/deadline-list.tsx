"use client";
import Link from "next/link";
import { DeadlineTimes } from "./deadline-times";
import type { Deadline } from "@/types/api";
import { HighlightTitle } from "@/components/title-search";
import {
  DeleteSelectable,
  type ListDeletion,
} from "@/components/list-deletion";
import { ScheduleList } from "@/features/schedules/schedule-list";
export function DeadlineRows({
  deadlines,
  deletion,
  query = "",
}: {
  deadlines: Deadline[];
  deletion?: ListDeletion;
  query?: string;
}) {
  return (
    <div className="deadline-rows">
      {deadlines.map((item) => {
        const content = (
          <>
            <span className="date-icon" aria-hidden>
              ◷
            </span>
            <div className="row-title">
              <strong>
                <HighlightTitle title={item.title} query={query} />
              </strong>
              <DeadlineTimes deadline={item} compact />
              <span>{item.deadline_type || "일반"}</span>
            </div>
            <span className={`tag ${item.is_confirmed ? "confirmed" : ""}`}>
              {item.is_confirmed ? "확인 완료" : "미확인"}
            </span>
            <span aria-hidden>↗</span>
          </>
        );
        return deletion?.mode ? (
          <DeleteSelectable
            key={item.id}
            deletion={deletion}
            id={item.id}
            label={item.title}
            className="deadline-row"
          >
            {content}
          </DeleteSelectable>
        ) : (
          <Link
            className="deadline-row"
            href={`/deadlines/${item.id}`}
            key={item.id}
          >
            {content}
          </Link>
        );
      })}
    </div>
  );
}

export function DeadlineList() {
  return <ScheduleList />;
}
