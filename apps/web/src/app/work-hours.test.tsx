import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Job } from "@ujc/core";

const { useSessionMock } = vi.hoisted(() => ({ useSessionMock: vi.fn() }));
vi.mock("@/lib/session", () => ({ useSession: () => useSessionMock() }));

import { TimezonePicker, WorkHoursBadge, WorkHoursCard } from "./work-hours";

function job(timezones: string[] | null, timezoneSource: "stated" | "location" | null = "stated"): Job {
  return {
    id: "1",
    source: "himalayas",
    url: "https://example.com/1",
    applyUrl: null,
    title: "Dev",
    company: "Acme",
    location: null,
    remote: true,
    employmentType: null,
    salaryText: null,
    tags: [],
    openTo: null,
    postedAt: null,
    firstSeenAt: new Date().toISOString(),
    timezones,
    timezoneSource,
  };
}

function signedOut() {
  return { me: null, loading: false, error: null, refresh: vi.fn(), signOut: vi.fn() };
}

describe("work hours", () => {
  afterEach(() => {
    cleanup();
    window.localStorage.clear();
  });

  it("shows the job's 9–5 on the user's clock (fixed offsets, so no DST in the test)", () => {
    useSessionMock.mockReturnValue(signedOut());
    window.localStorage.setItem("ujc:timezone", "UTC+07:00");
    render(<WorkHoursCard job={job(["UTC+00:00"])} />);
    expect(screen.getByText(/16:00/).textContent).toContain("16:00–00:00 (+1 day)");
    expect(screen.getAllByText("Evening hours").length).toBeGreaterThan(0);
    expect(screen.getByText(/1h overlap with your 9–5/)).toBeTruthy();
  });

  it("says so when the posting has no time zone", () => {
    useSessionMock.mockReturnValue(signedOut());
    render(<WorkHoursCard job={job(null, null)} />);
    expect(screen.getByText(/No time zone stated/)).toBeTruthy();
    render(<WorkHoursBadge job={job(null, null)} />);
    expect(screen.queryByText("Night shift")).toBeNull();
  });

  it("re-labels jobs when the user picks another time zone (signed out: saved in this browser)", () => {
    useSessionMock.mockReturnValue(signedOut());
    window.localStorage.setItem("ujc:timezone", "Asia/Ho_Chi_Minh");
    render(
      <>
        <TimezonePicker />
        <WorkHoursBadge job={job(["Asia/Ho_Chi_Minh"])} />
      </>,
    );
    expect(screen.getByText("Same time zone")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Your time zone"), { target: { value: "America/New_York" } });
    expect(window.localStorage.getItem("ujc:timezone")).toBe("America/New_York");
    expect(screen.getByText("Night shift")).toBeTruthy();
  });
});
