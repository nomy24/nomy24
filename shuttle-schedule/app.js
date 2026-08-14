"use strict";

/* サンプルデータ：実際の利用者名・地区名に差し替えて使用してください。 */
const STATUS_LABEL = { wait: "待機", go: "走行中", done: "到着済", alert: "要確認" };

const vehicles = [
  { no: 1, driver: "佐藤", attendant: "添乗 田中",
    am: { status: "done", progress: 100, occupied: 4, capacity: 4,
      stops: [
        { time: "08:15", label: "出発" },
        { time: "08:24", label: "A様 ／ 上鶴間" },
        { time: "08:36", label: "B様 ／ 御園" },
        { time: "08:48", label: "C様 ／ 文京" },
        { time: "09:00", label: "施設 到着" } ] },
    pm: { status: "wait", progress: 0, occupied: 4, capacity: 4,
      stops: [
        { time: "15:30", label: "施設 出発" },
        { time: "15:42", label: "C様 ／ 文京" },
        { time: "15:54", label: "B様 ／ 御園" },
        { time: "16:06", label: "A様 ／ 上鶴間" },
        { time: "16:15", label: "帰庫" } ] } },

  { no: 2, driver: "鈴木", attendant: "",
    am: { status: "done", progress: 100, occupied: 3, capacity: 5,
      stops: [
        { time: "08:10", label: "出発" },
        { time: "08:20", label: "D様 ／ 東林間" },
        { time: "08:33", label: "E様 ／ 相模大野" },
        { time: "08:47", label: "F様 ／ 双葉" },
        { time: "09:05", label: "施設 到着" } ] },
    pm: { status: "wait", progress: 0, occupied: 3, capacity: 5,
      stops: [
        { time: "15:25", label: "施設 出発" },
        { time: "15:40", label: "F様 ／ 双葉" },
        { time: "15:54", label: "E様 ／ 相模大野" },
        { time: "16:07", label: "D様 ／ 東林間" },
        { time: "16:20", label: "帰庫" } ] } },

  { no: 3, driver: "高橋", attendant: "添乗 伊藤",
    am: { status: "go", progress: 58, occupied: 5, capacity: 6,
      stops: [
        { time: "08:20", label: "出発" },
        { time: "08:30", label: "G様 ／ 麻溝台" },
        { time: "08:43", label: "H様 ／ 新戸" },
        { time: "08:56", label: "I様 ／ 麻溝" },
        { time: "09:10", label: "施設 到着" } ] },
    pm: { status: "wait", progress: 0, occupied: 5, capacity: 6,
      stops: [
        { time: "15:35", label: "施設 出発" },
        { time: "15:50", label: "I様 ／ 麻溝" },
        { time: "16:03", label: "H様 ／ 新戸" },
        { time: "16:16", label: "G様 ／ 麻溝台" },
        { time: "16:30", label: "帰庫" } ] } },

  { no: 4, driver: "田中", attendant: "",
    am: { status: "go", progress: 32, occupied: 4, capacity: 5,
      stops: [
        { time: "08:25", label: "出発" },
        { time: "08:34", label: "J様 ／ 淵野辺" },
        { time: "08:48", label: "K様 ／ 大野台" },
        { time: "09:02", label: "L様 ／ 桜台" },
        { time: "09:15", label: "施設 到着" } ] },
    pm: { status: "alert", progress: 15, occupied: 4, capacity: 5,
      stops: [
        { time: "15:40", label: "施設 出発" },
        { time: "15:55", label: "L様 ／ 桜台（時間変更）" },
        { time: "16:08", label: "K様 ／ 大野台" },
        { time: "16:22", label: "J様 ／ 淵野辺" },
        { time: "16:35", label: "帰庫" } ] } },

  { no: 5, driver: "伊藤", attendant: "添乗 佐々木",
    am: { status: "alert", progress: 40, occupied: 3, capacity: 4,
      stops: [
        { time: "08:12", label: "出発" },
        { time: "08:23", label: "M様 ／ 中央" },
        { time: "08:38", label: "N様 ／ すみれ台" },
        { time: "08:50", label: "O様 ／ 若葉台（渋滞）" },
        { time: "09:05", label: "施設 到着" } ] },
    pm: { status: "wait", progress: 0, occupied: 3, capacity: 4,
      stops: [
        { time: "15:28", label: "施設 出発" },
        { time: "15:40", label: "O様 ／ 若葉台" },
        { time: "15:55", label: "N様 ／ すみれ台" },
        { time: "16:08", label: "M様 ／ 中央" },
        { time: "16:20", label: "帰庫" } ] } },

  { no: 6, driver: "渡辺", attendant: "",
    am: { status: "wait", progress: 0, occupied: 4, capacity: 5,
      stops: [
        { time: "08:30", label: "出発" },
        { time: "08:40", label: "P様 ／ 星が丘" },
        { time: "08:52", label: "Q様 ／ 相模台" },
        { time: "09:04", label: "R様 ／ 松が枝" },
        { time: "09:20", label: "施設 到着" } ] },
    pm: { status: "wait", progress: 0, occupied: 4, capacity: 5,
      stops: [
        { time: "15:45", label: "施設 出発" },
        { time: "15:58", label: "R様 ／ 松が枝" },
        { time: "16:10", label: "Q様 ／ 相模台" },
        { time: "16:22", label: "P様 ／ 星が丘" },
        { time: "16:35", label: "帰庫" } ] } },

  { no: 7, driver: "山本", attendant: "添乗 中村",
    am: { status: "done", progress: 100, occupied: 6, capacity: 6,
      stops: [
        { time: "08:05", label: "出発" },
        { time: "08:16", label: "S様 ／ 光が丘" },
        { time: "08:29", label: "T様 ／ 西大沼" },
        { time: "08:44", label: "U様 ／ 東大沼" },
        { time: "08:58", label: "施設 到着" } ] },
    pm: { status: "wait", progress: 0, occupied: 6, capacity: 6,
      stops: [
        { time: "15:20", label: "施設 出発" },
        { time: "15:34", label: "U様 ／ 東大沼" },
        { time: "15:47", label: "T様 ／ 西大沼" },
        { time: "16:00", label: "S様 ／ 光が丘" },
        { time: "16:12", label: "帰庫" } ] } },

  { no: 8, driver: "中村", attendant: "",
    am: { status: "done", progress: 100, occupied: 2, capacity: 4,
      stops: [
        { time: "08:35", label: "出発" },
        { time: "08:47", label: "V様 ／ 二本松" },
        { time: "09:00", label: "W様 ／ 古淵" },
        { time: "09:15", label: "施設 到着" } ] },
    pm: { status: "wait", progress: 0, occupied: 2, capacity: 4,
      stops: [
        { time: "15:50", label: "施設 出発" },
        { time: "16:02", label: "W様 ／ 古淵" },
        { time: "16:14", label: "V様 ／ 二本松" },
        { time: "16:25", label: "帰庫" } ] } },
];

const boardEl = document.getElementById("board");
const vehicleTpl = document.getElementById("vehicleTemplate");
const stopTpl = document.getElementById("stopTemplate");

let currentPeriod = "am";

function render(period) {
  currentPeriod = period;
  boardEl.innerHTML = "";

  let active = 0, done = 0, pax = 0, alertCount = 0;

  vehicles.forEach((v) => {
    const rec = v[period];
    const node = vehicleTpl.content.cloneNode(true);
    const card = node.querySelector(".vcard");
    card.dataset.status = rec.status;

    node.querySelector(".vcard__badge").textContent = v.no + "号車";
    node.querySelector(".vcard__driver").textContent = v.driver + "運転士";
    node.querySelector(".vcard__attendant").textContent = v.attendant;

    const statusEl = node.querySelector(".vcard__status");
    statusEl.textContent = STATUS_LABEL[rec.status];

    const fill = node.querySelector(".road__fill");
    fill.style.width = rec.progress + "%";

    const now = node.querySelector(".road__now");
    if (rec.status === "go" || rec.status === "alert") {
      now.style.left = rec.progress + "%";
    } else {
      now.remove();
    }

    const stopsWrap = node.querySelector(".road__stops");
    rec.stops.forEach((s) => {
      const stopNode = stopTpl.content.cloneNode(true);
      stopNode.querySelector(".stop__time").textContent = s.time;
      stopNode.querySelector(".stop__label").textContent = s.label;
      stopsWrap.appendChild(stopNode);
    });

    node.querySelector(".vcard__cap").innerHTML =
      `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16 11a4 4 0 1 0-4-4M8 11a3 3 0 1 0 0-6M2 20c0-3.3 2.7-6 6-6s6 2.7 6 6M14 14c3.3 0 6 2.7 6 6"/></svg>` +
      `乗車 ${rec.occupied}／定員 ${rec.capacity}`;

    const first = rec.stops[0].time;
    const last = rec.stops[rec.stops.length - 1].time;
    node.querySelector(".vcard__window").innerHTML =
      `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>` +
      `${first} 〜 ${last}`;

    boardEl.appendChild(node);

    if (rec.status !== "wait") active++;
    if (rec.status === "done") done++;
    if (rec.status === "alert") alertCount++;
    pax += rec.occupied;
  });

  document.getElementById("kpiActive").textContent = active + "／" + vehicles.length;
  document.getElementById("kpiDone").textContent = done;
  document.getElementById("kpiPax").textContent = pax;
  const alertWrap = document.getElementById("kpiAlertWrap");
  if (alertCount > 0) {
    alertWrap.hidden = false;
    document.getElementById("kpiAlert").textContent = alertCount;
  } else {
    alertWrap.hidden = true;
  }
}

document.querySelectorAll(".runtoggle__btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".runtoggle__btn").forEach((b) => {
      b.classList.toggle("is-active", b === btn);
      b.setAttribute("aria-pressed", b === btn ? "true" : "false");
    });
    render(btn.dataset.period);
  });
});

document.getElementById("printBtn").addEventListener("click", () => window.print());

function tickClock() {
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  document.getElementById("clock").textContent = `${hh}:${mm}`;
  document.getElementById("todayLabel").textContent =
    now.toLocaleDateString("ja-JP", { month: "long", day: "numeric", weekday: "short" });
}

tickClock();
setInterval(tickClock, 15000);
render(currentPeriod);
