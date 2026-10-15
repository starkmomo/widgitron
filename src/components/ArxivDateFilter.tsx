import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { Calendar, ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import type { UiLanguage } from "../utils/localization";

const firstArxivYear = 1991;
const dayKey = (day: Date) => day.toISOString().slice(0, 10);
const parseDay = (date: string) => new Date(`${date}T00:00:00Z`);
const monthStart = (day: Date) => new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), 1));
const offsetDay = (day: Date, days: number) => new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate() + days));
const offsetMonth = (day: Date, months: number) => {
  const month = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth() + months, 1));
  const last = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 0)).getUTCDate();
  return new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth(), Math.min(day.getUTCDate(), last)));
};

export function ArxivDateFilter({ date, onChange, buttonClass, isLight, language }: {
  date: string; onChange: (date: string) => void; buttonClass: string; isLight: boolean; language: UiLanguage;
}) {
  const [open, setOpen] = useState(false);
  const today = dayKey(new Date());
  const initialDay = parseDay(date || today);
  const [month, setMonth] = useState(() => monthStart(initialDay));
  const [focusedDate, setFocusedDate] = useState(date || today);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const focusDayAfterRender = useRef(false);
  const chinese = language === "zh-CN";
  const locale = chinese ? "zh-CN" : "en";
  const year = month.getUTCFullYear();
  const monthIndex = month.getUTCMonth();
  const currentMonth = monthStart(parseDay(today));
  const gridStart = offsetDay(month, -((month.getUTCDay() + 6) % 7));
  const days = Array.from({ length: 42 }, (_, index) => offsetDay(gridStart, index));
  const weekday = new Intl.DateTimeFormat(locale, { weekday: "narrow", timeZone: "UTC" });
  const monthName = new Intl.DateTimeFormat(locale, { month: "long", timeZone: "UTC" });
  const fullDate = new Intl.DateTimeFormat(locale, { dateStyle: "full", timeZone: "UTC" });

  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") { setOpen(false); trigger.current?.focus(); }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  useEffect(() => {
    if (open && focusDayAfterRender.current) {
      root.current?.querySelector<HTMLButtonElement>(`[data-date="${focusedDate}"]`)?.focus();
      focusDayAfterRender.current = false;
    }
  }, [open, month, focusedDate]);

  const choose = (value: string) => { onChange(value); setOpen(false); trigger.current?.focus(); };
  const changeMonth = (value: Date) => {
    setMonth(monthStart(value));
    setFocusedDate(dayKey(value > parseDay(today) ? parseDay(today) : value));
  };
  const moveFocus = (event: KeyboardEvent<HTMLButtonElement>, day: Date) => {
    let next: Date;
    switch (event.key) {
      case "ArrowLeft": next = offsetDay(day, -1); break;
      case "ArrowRight": next = offsetDay(day, 1); break;
      case "ArrowUp": next = offsetDay(day, -7); break;
      case "ArrowDown": next = offsetDay(day, 7); break;
      case "Home": next = offsetDay(day, -((day.getUTCDay() + 6) % 7)); break;
      case "End": next = offsetDay(day, 6 - ((day.getUTCDay() + 6) % 7)); break;
      case "PageUp": next = offsetMonth(day, -1); break;
      case "PageDown": next = offsetMonth(day, 1); break;
      default: return;
    }
    event.preventDefault();
    if (dayKey(next) > today || next.getUTCFullYear() < firstArxivYear) return;
    focusDayAfterRender.current = true;
    setFocusedDate(dayKey(next));
    setMonth(monthStart(next));
  };
  const mutedButton = `rounded-lg p-1.5 transition-colors disabled:opacity-25 focus-visible:outline-2 focus-visible:outline-blue-500 ${isLight ? "text-slate-500 hover:enabled:bg-slate-100" : "text-slate-400 hover:enabled:bg-white/10"}`;
  const selectClass = `min-w-0 rounded-lg py-1.5 pl-2 pr-1 text-sm font-semibold outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${isLight ? "bg-white hover:bg-slate-50 [color-scheme:light]" : "bg-slate-900 hover:bg-white/5 [color-scheme:dark]"}`;

  return (
    <div ref={root} className="relative shrink-0" data-no-localize>
      <button ref={trigger} type="button" className={`${buttonClass} min-w-[9.25rem] justify-between whitespace-nowrap`} onClick={() => {
        if (!open) {
          const selected = parseDay(date || today);
          setMonth(monthStart(selected)); setFocusedDate(dayKey(selected));
          focusDayAfterRender.current = true;
        }
        setOpen(value => !value);
      }} aria-expanded={open} aria-haspopup="dialog" aria-controls="arxiv-date-filter" title={chinese ? "选择提交日期" : "Choose submission date"}>
        <span className="inline-flex items-center gap-1.5"><Calendar size={14} />
          <span className="tabular-nums">{date || (chinese ? "最近" : "Recent")}</span>
        </span>
        <ChevronDown size={12} className={open ? "rotate-180" : ""} />
      </button>
      {open && (
        <div id="arxiv-date-filter" role="dialog" aria-labelledby="arxiv-calendar-title" className={`absolute left-0 top-full mt-2 z-30 w-[19rem] max-w-[calc(100vw-2rem)] rounded-2xl border border-[var(--dashboard-border)] p-4 shadow-xl ${isLight ? "bg-white text-slate-900 shadow-slate-900/10" : "bg-slate-900 text-white shadow-black/30"}`}>
          <div className="flex items-center justify-between mb-3">
            <span id="arxiv-calendar-title" className="text-xs font-semibold">{chinese ? "提交日期" : "Submission date"}</span>
            <span className={`rounded-md px-1.5 py-0.5 text-[10px] font-medium ${isLight ? "bg-slate-100 text-slate-500" : "bg-white/10 text-slate-400"}`}>UTC</span>
          </div>
          <div className="flex items-center justify-between gap-1 mb-3">
            <button type="button" className={mutedButton} disabled={year === firstArxivYear && monthIndex === 0} onClick={() => changeMonth(offsetMonth(month, -1))} aria-label={chinese ? "上个月" : "Previous month"}><ChevronLeft size={16} /></button>
            <div className="flex items-center justify-center gap-1">
              <select aria-label={chinese ? "年份" : "Year"} value={year} onChange={event => changeMonth(new Date(Date.UTC(Number(event.target.value), Math.min(monthIndex, Number(event.target.value) === currentMonth.getUTCFullYear() ? currentMonth.getUTCMonth() : 11), 1)))} className={selectClass}>
                {Array.from({ length: currentMonth.getUTCFullYear() - firstArxivYear + 1 }, (_, index) => currentMonth.getUTCFullYear() - index).map(value => <option key={value} value={value}>{value}{chinese ? "年" : ""}</option>)}
              </select>
              <select aria-label={chinese ? "月份" : "Month"} value={monthIndex} onChange={event => changeMonth(new Date(Date.UTC(year, Number(event.target.value), 1)))} className={selectClass}>
                {Array.from({ length: 12 }, (_, index) => <option key={index} value={index} disabled={year === currentMonth.getUTCFullYear() && index > currentMonth.getUTCMonth()}>{monthName.format(new Date(Date.UTC(2026, index, 1)))}</option>)}
              </select>
            </div>
            <button type="button" className={mutedButton} disabled={month >= currentMonth} onClick={() => changeMonth(offsetMonth(month, 1))} aria-label={chinese ? "下个月" : "Next month"}><ChevronRight size={16} /></button>
          </div>
          <div className="grid grid-cols-7 mb-1 text-[10px] text-slate-400 text-center" aria-hidden="true">
            {Array.from({ length: 7 }, (_, index) => <span key={index} className="py-1">{weekday.format(new Date(Date.UTC(2026, 5, 1 + index)))}</span>)}
          </div>
          <div className="grid grid-cols-7 gap-1" role="group" aria-label={chinese ? "选择提交日期" : "Choose submission date"}>
            {days.map(day => {
              const value = dayKey(day);
              const selected = value === date;
              const disabled = value > today || day.getUTCFullYear() < firstArxivYear;
              return <button key={value} type="button" data-date={value} tabIndex={value === focusedDate ? 0 : -1} disabled={disabled} aria-label={fullDate.format(day)} aria-pressed={selected} aria-current={value === today ? "date" : undefined} onKeyDown={event => moveFocus(event, day)} onClick={() => choose(value)} className={`h-8 rounded-lg text-xs tabular-nums transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-blue-500 disabled:opacity-20 ${selected ? "bg-blue-600 text-white shadow-sm" : value === today ? "text-blue-500 ring-1 ring-inset ring-blue-500/35 hover:bg-blue-500/10" : `${day.getUTCMonth() === monthIndex ? isLight ? "text-slate-700" : "text-slate-200" : "text-slate-400"} ${isLight ? "hover:bg-slate-100" : "hover:bg-white/10"}`}`}>{day.getUTCDate()}</button>;
            })}
          </div>
          <div className="mt-3 pt-3 border-t border-[var(--dashboard-border)] flex items-center justify-between gap-2">
            <button type="button" onClick={() => choose("")} className="rounded-lg text-xs font-semibold text-blue-500 hover:bg-blue-500/10 px-2 py-1.5">{chinese ? "查看最近论文" : "Show recent papers"}</button>
            <button type="button" onClick={() => changeMonth(parseDay(today))} className={`${mutedButton} text-xs`}>{chinese ? "今天" : "Today"}</button>
          </div>
        </div>
      )}
    </div>
  );
}
